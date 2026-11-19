import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Accounts } from "./accounts.js";
import { ArenaGames } from "./arena-games.js";
import { digest } from "./game-random.js";
import { Fault } from "./engine.js";
import {
  PriceProvider,
  pairs,
  priceUnits,
  type Pair,
  type Candle,
} from "./price-provider.js";
import { livePrices, type LivePrices } from "./live-prices.js";
export function fastSpec(pair: Pair, start: number) {
  if (!pairs.includes(pair) || start % 180000)
    throw Error("Round must align to three UTC minutes");
  return {
    version: 1,
    pair,
    provider: "Coinbase Exchange",
    entryOpens: start - 60000,
    cutoff: start - 5000,
    start,
    end: start + 120000,
    startingCandle: start / 1000 - 60,
    endingCandle: start / 1000 + 60,
    granularity: 60,
    operator: "STRICT_GT_LT_8_DECIMAL_UNITS",
    tie: "REFUND",
    payout: "WIN_2X_LOSS_0",
    unavailable: "RETRY_30_SECONDS_REFUND_AFTER_1_HOUR",
    timezone: "UTC",
  } as const;
}
export type FastRound = {
  _id: string;
  spec: ReturnType<typeof fastSpec>;
  specHash: string;
  createdAt: Date;
  status: string;
  nextAttempt: Date;
  attempts: number;
  revision?: number;
  lease?: string;
  leaseUntil?: Date;
  opening?: Candle;
  openingVerifiedAt?: string;
  evidence?: {
    opening: Candle;
    closing: Candle;
    product: Pair;
    provider: string;
    fetchedAt: string;
    openingVerifiedAt: string;
    closingVerifiedAt: string;
    specHash: string;
    urls: string[];
    responseFormat: string;
  };
  outcome?: "UP" | "DOWN" | "EQUAL";
  lastError?: string;
};
export function fastOutcome(open: number, close: number) {
  const a = BigInt(priceUnits(open)),
    b = BigInt(priceUnits(close));
  return b > a ? "UP" : b < a ? "DOWN" : "EQUAL";
}
export function fastPhase(r: FastRound, now = Date.now()) {
  if (
    [
      "SETTLED",
      "RESULT_VERIFIED",
      "CANCELLED",
      "DATA_DELAYED",
      "DISPUTED",
    ].includes(r.status)
  )
    return r.status;
  return now < r.spec.entryOpens
    ? "UPCOMING"
    : now < r.spec.cutoff
      ? "ENTRY_OPEN"
      : now < r.spec.start
        ? "ENTRY_LOCKED"
        : now < r.spec.end
          ? "LIVE"
          : "AWAITING_PRICE_EVIDENCE";
}
export class FastCrypto {
  games: ArenaGames;
  private generatedUntil = 0;
  constructor(
    public accounts: Accounts,
    public provider = new PriceProvider(),
    public feed: LivePrices = livePrices,
  ) {
    this.games = new ArenaGames(accounts);
  }
  rounds() {
    return this.accounts.db.collection<FastRound>("arena_fast_rounds");
  }
  attempts() {
    return this.accounts.db.collection("arena_fast_evidence_attempts");
  }
  async init() {
    await this.rounds().createIndex(
      { "spec.pair": 1, "spec.start": 1 },
      { unique: true },
    );
    await this.rounds().createIndex({
      status: 1,
      nextAttempt: 1,
      leaseUntil: 1,
    });
    await this.accounts
      .rounds()
      .createIndex(
        { userId: 1, marketId: 1 },
        {
          unique: true,
          partialFilterExpression: { gameKey: "crypto-fast" },
          name: "one_fast_position",
        },
      );
    await this.attempts().createIndex({ roundId: 1, at: -1 });
    await this.attempts().createIndex(
      { at: 1 },
      { expireAfterSeconds: 30 * 86400 },
    );
  }
  async generate(now = Date.now()) {
    const base = Math.ceil((now + 5000) / 180000) * 180000;
    const writes = [];
    for (const pair of pairs)
      for (let i = 0; i < 3; i++) {
        const spec = fastSpec(pair, base + i * 180000),
          _id = `fast:${pair}:${spec.start}`;
        writes.push({
          updateOne: {
            filter: { _id },
            update: {
              $setOnInsert: {
                _id,
                spec,
                specHash: digest(JSON.stringify(spec)),
                createdAt: new Date(),
                status: "UPCOMING",
                nextAttempt: new Date(spec.start + 10000),
                attempts: 0,
              },
            },
            upsert: true,
          },
        });
      }
    await this.rounds().bulkWrite(writes, { ordered: false });
  }
  async list(userId: string) {
    const rounds = await this.rounds()
      .find({ "spec.end": { $gte: Date.now() - 3600000 } })
      .sort({ "spec.start": -1 })
      .limit(90)
      .toArray();
    const positions = await this.accounts
      .rounds()
      .find({ userId, gameKey: "crypto-fast" })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const pending = await this.accounts
      .rounds()
      .find({ userId, gameKey: "crypto-fast", status: "PENDING" })
      .toArray();
    const missing = pending
      .map((p) => p.marketId!)
      .filter((id) => !rounds.some((r) => r._id === id));
    if (missing.length)
      rounds.push(
        ...(await this.rounds()
          .find({ _id: { $in: missing } })
          .toArray()),
      );
    return {
      serverTime: Date.now(),
      rounds: rounds.map((r) => ({ ...r, phase: fastPhase(r) })),
      positions: [
        ...pending,
        ...positions.filter((p) => p.status !== "PENDING"),
      ].map((p) => this.accounts.publicRound(p)),
      account: await this.accounts.accounts().findOne({ _id: userId }),
    };
  }
  async enter(userId: string, id: string, input: unknown) {
    const b = z
      .object({
        direction: z.enum(["UP", "DOWN"]),
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
          prior.choice !== b.direction ||
          prior.stake !== b.stake ||
          prior.rulesHash !== b.specHash
        )
          throw new Fault("Operation terms mismatch", 409);
        return this.accounts.publicRound(prior);
      }
      const r = await this.rounds().findOne({ _id: id }, { session });
      if (!r || fastPhase(r) !== "ENTRY_OPEN")
        throw new Fault("Entry window is closed", 409);
      if (
        r.specHash !== b.specHash ||
        digest(JSON.stringify(r.spec)) !== r.specHash
      )
        throw new Fault("Specification mismatch", 409);
      if (!this.feed.fresh(r.spec.pair))
        throw new Fault("Coinbase feed is delayed. Entry paused.", 503);
      if (
        await this.accounts
          .rounds()
          .findOne({ userId, marketId: id }, { session })
      )
        throw new Fault("Position already accepted for this round", 409);
      const lock = await this.rounds().updateOne(
        {
          _id: id,
          status: r.status,
          "spec.cutoff": { $gt: Date.now() },
          "spec.entryOpens": { $lte: Date.now() },
        },
        { $inc: { revision: 1 } },
        { session },
      );
      if (!lock.matchedCount) throw new Fault("Entry window closed", 409);
      const a = await this.accounts
        .accounts()
        .findOneAndUpdate(
          { _id: userId, available: { $gte: b.stake } },
          { $inc: { available: -b.stake, committed: b.stake } },
          { session, returnDocument: "before" },
        );
      if (!a) throw new Fault("Insufficient ZYRO Points", 409);
      const pid = randomUUID(),
        p = {
          _id: pid,
          id: pid,
          userId,
          operation: b.operation,
          marketId: id,
          gameKey: "crypto-fast",
          gameKind: "market" as const,
          side: b.direction === "UP" ? ("YES" as const) : ("NO" as const),
          choice: b.direction,
          botSide: "NO" as const,
          stake: b.stake,
          draw: 0,
          commitment: r.specHash,
          rulesHash: r.specHash,
          status: "PENDING" as const,
          createdAt: new Date().toISOString(),
          resolveAt: new Date(r.spec.end).toISOString(),
        };
      await this.accounts.rounds().insertOne(p, { session });
      await this.accounts
        .ledger()
        .insertOne(
          {
            _id: randomUUID(),
            userId,
            kind: "STAKE",
            amount: -b.stake,
            before: a.available,
            after: a.available - b.stake,
            operation: `stake:${pid}`,
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
      return this.accounts.publicRound(p);
    });
  }
  async process(id: string) {
    const now = Date.now(),
      token = randomUUID();
    const r = await this.rounds().findOneAndUpdate(
      {
        _id: id,
        status: {
          $nin: ["RESULT_VERIFIED", "SETTLED", "CANCELLED", "DISPUTED"],
        },
        nextAttempt: { $lte: new Date(now) },
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lt: new Date(now) } },
        ],
      },
      {
        $set: { lease: token, leaseUntil: new Date(now + 45000) },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (r) {
      try {
        if (digest(JSON.stringify(r.spec)) !== r.specHash)
          throw new Error("Specification integrity failure");
        if (now < r.spec.start + 10000)
          throw new Error("Awaiting completed starting candle");
        const opening =
          r.opening ||
          (
            await this.provider.candles(r.spec.pair, r.spec.startingCandle)
          ).find((c) => c.time === r.spec.startingCandle);
        if (!opening) throw new Error("Exact starting candle unavailable");
        if (Date.now() < r.spec.end + 10000) {
          await this.rounds().updateOne(
            { _id: id, lease: token },
            {
              $set: {
                opening,
                openingVerifiedAt: new Date().toISOString(),
                status: "LIVE",
                nextAttempt: new Date(r.spec.end + 10000),
              },
              $unset: { lease: "", leaseUntil: "", lastError: "" },
            },
          );
        } else {
          const closing = (
            await this.provider.candles(r.spec.pair, r.spec.endingCandle)
          ).find((c) => c.time === r.spec.endingCandle);
          if (!closing) throw new Error("Exact ending candle unavailable");
          const evidence = {
            opening,
            closing,
            product: r.spec.pair,
            provider: r.spec.provider,
            fetchedAt: new Date().toISOString(),
            openingVerifiedAt: r.openingVerifiedAt || new Date().toISOString(),
            closingVerifiedAt: new Date().toISOString(),
            specHash: r.specHash,
            urls: [r.spec.startingCandle, r.spec.endingCandle].map(
              (t) =>
                `https://api.exchange.coinbase.com/products/${r.spec.pair}/candles?granularity=60&start=${new Date(t * 1000).toISOString()}&end=${new Date((t + 60) * 1000).toISOString()}`,
            ),
            responseFormat:
              "Coinbase [time,low,high,open,close,volume]; HTTP 200; completed exact timestamps",
          };
          await this.rounds().updateOne(
            { _id: id, lease: token },
            {
              $set: {
                opening,
                evidence,
                outcome: fastOutcome(opening.close, closing.close),
                status: "RESULT_VERIFIED",
              },
              $unset: { lease: "", leaseUntil: "", lastError: "" },
            },
          );
          await this.attempts().insertOne({
            roundId: id,
            at: new Date(),
            result: "VERIFIED",
            specHash: r.specHash,
          });
        }
      } catch {
        const integrity = digest(JSON.stringify(r.spec)) !== r.specHash;
        await this.rounds().updateOne(
          { _id: id, lease: token },
          {
            $set: {
              status: integrity
                ? "DISPUTED"
                : now >= r.spec.end + 3600000
                  ? "CANCELLED"
                  : "DATA_DELAYED",
              lastError: integrity
                ? "Specification integrity failure; operator review required"
                : "Exact Coinbase candle unavailable; retrying. Stakes remain committed.",
              nextAttempt: new Date(now + 30000),
            },
            $unset: { lease: "", leaseUntil: "" },
          },
        );
        await this.attempts().insertOne({
          roundId: id,
          at: new Date(),
          result: integrity
            ? "DISPUTED"
            : now >= r.spec.end + 3600000
              ? "CANCELLED"
              : "RETRY",
          specHash: r.specHash,
        });
      }
    }
    const final = await this.rounds().findOne({
      _id: id,
      status: { $in: ["RESULT_VERIFIED", "CANCELLED", "SETTLED"] },
    });
    if (!final) return;
    if (
      final.status !== "CANCELLED" &&
      (!final.evidence ||
        !final.outcome ||
        digest(JSON.stringify(final.spec)) !== final.specHash ||
        final.evidence.specHash !== final.specHash)
    )
      throw Error("Missing verified evidence");
    const predictions = await this.accounts
      .rounds()
      .find({ marketId: id, status: "PENDING" })
      .limit(200)
      .toArray();
    for (const p of predictions)
      await this.games.settle(p.id, {
        values: [],
        label: final.outcome || "CANCELLED",
        verdict:
          final.status === "CANCELLED" || final.outcome === "EQUAL"
            ? "REFUND"
            : p.choice === final.outcome
              ? "WIN"
              : "LOSS",
      });
    if (
      final.status === "RESULT_VERIFIED" &&
      !(await this.accounts
        .rounds()
        .countDocuments({ marketId: id, status: "PENDING" }))
    )
      await this.rounds().updateOne(
        { _id: id, status: "RESULT_VERIFIED" },
        { $set: { status: "SETTLED" } },
      );
  }
  async tick() {
    if (Date.now() >= this.generatedUntil) {
      await this.generate();
      this.generatedUntil = Date.now() + 30000;
    }
    const due = await this.rounds()
      .find({
        status: { $nin: ["SETTLED", "CANCELLED", "DISPUTED"] },
        nextAttempt: { $lte: new Date() },
      })
      .sort({ nextAttempt: 1 })
      .limit(30)
      .toArray();
    const pending = await this.accounts
      .rounds()
      .distinct("marketId", { gameKey: "crypto-fast", status: "PENDING" });
    for (const id of new Set([
      ...due.map((r) => r._id),
      ...pending.filter((id): id is string => !!id),
    ])) {
      try {
        await this.process(id);
      } catch {
        await this.attempts().insertOne({
          roundId: id,
          at: new Date(),
          result: "WORKER_DELAYED",
        });
      }
    }
  }
}
