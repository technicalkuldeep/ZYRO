import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Accounts, type User } from "./accounts.js";
import { ArenaGames } from "./arena-games.js";
import { digest } from "./game-random.js";
import {
  PriceProvider,
  pairs,
  priceUnits,
  type Pair,
  type Candle,
} from "./price-provider.js";
import { Fault } from "./engine.js";
export type CryptoSpec = {
  version: 1;
  pair: Pair;
  provider: "Coinbase Exchange";
  threshold: number;
  thresholdUnits: string;
  operator: "GT";
  candleStart: number;
  observationTime: number;
  cutoff: number;
  timezone: "UTC";
  granularity: 60;
  method: "CLOSE_LAST_TRADE";
  equality: "NO";
  unavailable: "RETRY_60_SECONDS_REFUND_AFTER_24_HOURS";
  reference: Candle;
  referenceFetchedAt: string;
};
export type CryptoMarket = {
  _id: string;
  spec: CryptoSpec;
  specHash: string;
  createdAt: Date;
  status: "OPEN" | "PENDING_VERIFICATION" | "RESOLVED" | "CANCELLED";
  disabled: boolean;
  nextAttempt: Date;
  leaseUntil?: Date;
  leaseToken?: string;
  attempts: number;
  entryRevision?: number;
  outcome?: "YES" | "NO";
  evidence?: {
    candle: Candle;
    fetchedAt: string;
    pair: Pair;
    provider: string;
    url: string;
  };
  lastError?: string;
};
export class CryptoMarkets {
  games: ArenaGames;
  constructor(
    public accounts: Accounts,
    public provider = new PriceProvider(),
  ) {
    this.games = new ArenaGames(accounts);
  }
  markets() {
    return this.accounts.db.collection<CryptoMarket>("arena_crypto_markets", {
      writeConcern: { w: "majority" },
    });
  }
  attempts() {
    return this.accounts.db.collection<{
      _id: string;
      marketId: string;
      at: Date;
      result: string;
      error?: string;
      specHash: string;
    }>("arena_resolution_attempts");
  }
  async init() {
    await this.markets().createIndex(
      { "spec.pair": 1, "spec.candleStart": 1 },
      { unique: true },
    );
    await this.markets().createIndex({
      status: 1,
      nextAttempt: 1,
      leaseUntil: 1,
    });
    await this.accounts.rounds().createIndex({ marketId: 1, status: 1 });
    await this.attempts().createIndex({ marketId: 1, at: -1 });
  }
  async publish(pair: Pair, candleStart: number) {
    if (
      !pairs.includes(pair) ||
      candleStart % 60 ||
      candleStart * 1000 < Date.now() + 10000
    )
      throw new Fault("Observation must be an upcoming whole UTC minute");
    const id = `${pair}:${candleStart}`;
    const prior = await this.markets().findOne({ _id: id });
    if (prior) return prior;
    const candles = await this.provider.candles(pair);
    const reference = candles.at(-1)!;
    if (Date.now() - reference.time * 1000 > 10 * 60000)
      throw new Fault("Reference price is stale", 503);
    const spec: CryptoSpec = {
      version: 1,
      pair,
      provider: "Coinbase Exchange",
      threshold: reference.close,
      thresholdUnits: priceUnits(reference.close),
      operator: "GT",
      candleStart,
      observationTime: (candleStart + 60) * 1000,
      cutoff: candleStart * 1000 - 5000,
      timezone: "UTC",
      granularity: 60,
      method: "CLOSE_LAST_TRADE",
      equality: "NO",
      unavailable: "RETRY_60_SECONDS_REFUND_AFTER_24_HOURS",
      reference,
      referenceFetchedAt: new Date().toISOString(),
    };
    const market: CryptoMarket = {
      _id: id,
      spec,
      specHash: digest(JSON.stringify(spec)),
      createdAt: new Date(),
      status: "OPEN",
      disabled: false,
      nextAttempt: new Date(spec.observationTime + 10000),
      attempts: 0,
    };
    await this.markets().updateOne(
      { _id: id },
      { $setOnInsert: market },
      { upsert: true },
    );
    return (await this.markets().findOne({ _id: id }))!;
  }
  async seed() {
    const base = Math.ceil((Date.now() + 15 * 60000) / (15 * 60000)) * 15 * 60;
    for (const pair of pairs) {
      let active = await this.markets().countDocuments({
        "spec.pair": pair,
        "spec.cutoff": { $gt: Date.now() },
        status: "OPEN",
      });
      for (let i = 0; active < 2 && i < 6; i++) {
        try {
          await this.publish(pair, base + i * 3600);
          active = await this.markets().countDocuments({
            "spec.pair": pair,
            "spec.cutoff": { $gt: Date.now() },
            status: "OPEN",
          });
        } catch (e) {
          await this.attempts().insertOne({
            _id: randomUUID(),
            marketId: `publication:${pair}`,
            at: new Date(),
            result: "PUBLICATION_DELAYED",
            error:
              e instanceof Error
                ? e.message.slice(0, 150)
                : "Provider unavailable",
            specHash: "unpublished",
          });
          break;
        }
      }
    }
  }
  async list() {
    return this.markets()
      .find()
      .sort({ "spec.observationTime": -1 })
      .limit(100)
      .toArray();
  }
  async enter(userId: string, id: string, input: unknown) {
    const b = z
      .object({
        side: z.enum(["YES", "NO"]),
        stake: z.number().int().min(10).max(100),
        operation: z.string().uuid(),
        specHash: z.string().length(64),
      })
      .strict()
      .parse(input);
    return this.accounts.atomic(async (session) => {
      const prior = await this.accounts
        .rounds()
        .findOne({ userId, operation: b.operation }, { session });
      if (prior) {
        if (
          prior.marketId !== id ||
          prior.side !== b.side ||
          prior.stake !== b.stake ||
          prior.rulesHash !== b.specHash
        )
          throw new Fault("Operation terms mismatch", 409);
        return this.accounts.publicRound(prior);
      }
      const market = await this.markets().findOne({ _id: id }, { session });
      if (!market) throw new Fault("Market not found", 404);
      if (
        market.disabled ||
        market.status !== "OPEN" ||
        Date.now() >= market.spec.cutoff
      )
        throw new Fault("Market entry is closed", 409);
      if (
        b.specHash !== market.specHash ||
        digest(JSON.stringify(market.spec)) !== market.specHash
      )
        throw new Fault("Market specification mismatch", 409);
      if (
        (await this.accounts
          .rounds()
          .countDocuments(
            { userId, gameKind: "market", status: "PENDING" },
            { session },
          )) >= 20
      )
        throw new Fault("Maximum 20 pending market predictions", 409);
      // This write serializes entries against disable/resolution without changing agreed terms.
      const lock = await this.markets().updateOne(
        {
          _id: id,
          status: "OPEN",
          disabled: false,
          "spec.cutoff": { $gt: Date.now() },
        },
        { $inc: { entryRevision: 1 } },
        { session },
      );
      if (!lock.matchedCount) throw new Fault("Market entry closed", 409);
      const a = await this.accounts
        .accounts()
        .findOneAndUpdate(
          { _id: userId, available: { $gte: b.stake } },
          { $inc: { available: -b.stake, committed: b.stake } },
          { session, returnDocument: "before" },
        );
      if (!a) throw new Fault("Insufficient ZYRO Points", 409);
      const roundId = randomUUID();
      const r = {
        _id: roundId,
        id: roundId,
        userId,
        operation: b.operation,
        marketId: id,
        gameKey: "crypto",
        gameKind: "market" as const,
        side: b.side,
        choice: b.side,
        botSide: "NO" as const,
        draw: 0,
        stake: b.stake,
        commitment: market.specHash,
        rulesHash: market.specHash,
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
        resolveAt: new Date(market.spec.observationTime).toISOString(),
      };
      await this.accounts.rounds().insertOne(r, { session });
      await this.accounts.ledger().insertOne(
        {
          _id: randomUUID(),
          userId,
          kind: "STAKE",
          amount: -b.stake,
          before: a.available,
          after: a.available - b.stake,
          operation: `stake:${roundId}`,
          createdAt: new Date(),
        },
        { session },
      );
      await this.accounts
        .users()
        .updateOne(
          { _id: userId },
          { $set: { lastActivity: new Date() } },
          { session },
        );
      return this.accounts.publicRound(r);
    });
  }
  async process(id: string) {
    const token = randomUUID();
    const m = await this.markets().findOneAndUpdate(
      {
        _id: id,
        status: { $in: ["OPEN", "PENDING_VERIFICATION"] },
        "spec.observationTime": { $lte: Date.now() - 10000 },
        nextAttempt: { $lte: new Date() },
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lt: new Date() } },
        ],
      },
      {
        $set: {
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 30000),
          status: "PENDING_VERIFICATION",
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (m) {
      try {
        if (digest(JSON.stringify(m.spec)) !== m.specHash)
          throw new Error("Immutable specification hash mismatch");
        const candles = await this.provider.candles(
          m.spec.pair,
          m.spec.candleStart,
        );
        const candle = candles.find((c) => c.time === m.spec.candleStart);
        if (!candle || Date.now() < m.spec.observationTime + 10000)
          throw new Error("Exact completed observation candle unavailable");
        const outcome =
          BigInt(priceUnits(candle.close)) > BigInt(m.spec.thresholdUnits)
            ? "YES"
            : "NO";
        const evidence = {
          pair: m.spec.pair,
          provider: m.spec.provider,
          candle,
          fetchedAt: new Date().toISOString(),
          url: `https://api.exchange.coinbase.com/products/${m.spec.pair}/candles?granularity=60&start=${new Date(m.spec.candleStart * 1000).toISOString()}&end=${new Date(m.spec.observationTime).toISOString()}`,
        };
        await this.markets().updateOne(
          { _id: id, leaseToken: token, status: "PENDING_VERIFICATION" },
          {
            $set: { status: "RESOLVED", outcome, evidence },
            $unset: { leaseUntil: "", leaseToken: "", lastError: "" },
          },
        );
        await this.attempts().insertOne({
          _id: randomUUID(),
          marketId: id,
          at: new Date(),
          result: "VERIFIED",
          specHash: m.specHash,
        });
      } catch (e) {
        const error =
          e instanceof Error ? e.message.slice(0, 150) : "Provider unavailable";
        const expired = Date.now() >= m.spec.observationTime + 86400000;
        await this.markets().updateOne(
          { _id: id, leaseToken: token },
          {
            $set: {
              status: expired ? "CANCELLED" : "PENDING_VERIFICATION",
              lastError: error,
              nextAttempt: new Date(Date.now() + 60000),
            },
            $unset: { leaseUntil: "", leaseToken: "" },
          },
        );
        await this.attempts().insertOne({
          _id: randomUUID(),
          marketId: id,
          at: new Date(),
          result: expired ? "REFUND_POLICY" : "RETRY",
          error,
          specHash: m.specHash,
        });
      }
    }
    // Recovery also runs for finalized markets: a crash after recording evidence cannot lose payouts.
    const final = await this.markets().findOne({
      _id: id,
      status: { $in: ["RESOLVED", "CANCELLED"] },
    });
    if (!final) return;
    if (final.status === "RESOLVED" && (!final.evidence || !final.outcome))
      throw new Error("Missing source evidence");
    const predictions = await this.accounts
      .rounds()
      .find({ marketId: id, status: "PENDING" })
      .limit(200)
      .toArray();
    for (const r of predictions)
      await this.games.settle(r.id, {
        values: [],
        label: final.outcome || "REFUND",
        verdict:
          final.status === "CANCELLED"
            ? "REFUND"
            : r.side === final.outcome
              ? "WIN"
              : "LOSS",
      });
  }
  async tick() {
    const due = await this.markets()
      .find({
        status: { $in: ["OPEN", "PENDING_VERIFICATION"] },
        nextAttempt: { $lte: new Date() },
      })
      .sort({ nextAttempt: 1 })
      .limit(20)
      .toArray();
    const processSafely = async (id: string) => {
      try {
        await this.process(id);
      } catch (e) {
        await this.attempts().insertOne({
          _id: randomUUID(),
          marketId: id,
          at: new Date(),
          result: "SETTLEMENT_DELAYED",
          error:
            e instanceof Fault
              ? e.message
              : "Worker storage or settlement failure; job retained",
          specHash:
            (await this.markets().findOne({ _id: id }))?.specHash || "unknown",
        });
      }
    };
    for (const m of due) await processSafely(m._id);
    const pending = await this.accounts
      .rounds()
      .distinct("marketId", { gameKind: "market", status: "PENDING" });
    for (const id of pending.slice(0, 100)) if (id) await processSafely(id);
  }
  async disable(actor: User, id: string, reason: string, operation: string) {
    if (!(await this.accounts.isAdmin(actor)))
      throw new Fault("Administrator access required", 403);
    z.object({
      reason: z.string().trim().min(5).max(500),
      operation: z.string().uuid(),
    }).parse({ reason, operation });
    return this.accounts.atomic(async (session) => {
      const audits = this.accounts.db.collection<{
        _id: string;
        [key: string]: unknown;
      }>("arena_content_audit");
      const prior = await audits.findOne({ _id: operation }, { session });
      if (prior) {
        if (prior.marketId !== id || prior.reason !== reason)
          throw new Fault("Operation mismatch", 409);
        return prior;
      }
      const market = await this.markets().findOne({ _id: id }, { session });
      if (!market) throw new Fault("Market not found", 404);
      await this.markets().updateOne(
        { _id: id },
        { $set: { disabled: true } },
        { session },
      );
      const event = {
        _id: operation,
        marketId: id,
        actorId: actor._id,
        actorSub: actor.sub,
        actorEmail: actor.email,
        action: "DISABLE_ENTRY",
        reason,
        at: new Date(),
        specHash: market.specHash,
      };
      await audits.insertOne(event, { session });
      return event;
    });
  }
}
