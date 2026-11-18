import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Accounts } from "./accounts.js";
import { Fault } from "./engine.js";
import { commitment, outcome, rulesHash } from "./game-random.js";
import {
  gameDefinition,
  gameDefinitions,
  type GameKey,
} from "../../../packages/shared/src/arena-games.js";
type Prepared = {
  _id: string;
  userId: string;
  gameKey: GameKey;
  operation: string;
  secret: string;
  commitment: string;
  rulesHash: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
};
export class ArenaGames {
  constructor(public accounts: Accounts) {}
  preparations() {
    return this.accounts.db.collection<Prepared>("arena_commitments", {
      writeConcern: { w: "majority" },
    });
  }
  async init() {
    await this.preparations().createIndex(
      { expiresAt: 1 },
      {
        expireAfterSeconds: 0,
        partialFilterExpression: { used: false },
        name: "expire_unused_commitments",
      },
    );
    await this.accounts.db
      .collection("arena_game_errors")
      .createIndex({ at: 1 }, { expireAfterSeconds: 30 * 86400 });
    await this.preparations().createIndex(
      { userId: 1, operation: 1 },
      { unique: true },
    );
    await this.accounts
      .rounds()
      .createIndex({ gameKey: 1, status: 1, createdAt: -1 });
    for (const g of gameDefinitions)
      await this.accounts.db.collection("arena_games").updateOne(
        { key: g.key },
        {
          $setOnInsert: {
            ...g,
            version: 2,
            rulesHash: rulesHash(g.key),
            minStake: 10,
            maxStake: 100,
          },
        },
        { upsert: true },
      );
  }
  async prepare(userId: string, key: string, operation: string) {
    const g = gameDefinition(key);
    if (!g) throw new Fault("Unknown game", 404);
    z.string().uuid().parse(operation);
    const id = randomUUID(),
      secret = randomBytes(32).toString("hex");
    const existing = await this.preparations().findOneAndUpdate(
      { userId, operation },
      {
        $setOnInsert: {
          _id: id,
          userId,
          operation,
          gameKey: g.key,
          secret,
          commitment: commitment(id, g.key, secret),
          rulesHash: rulesHash(g.key),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60000),
          used: false,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!existing || existing.gameKey !== key)
      throw new Fault("Preparation operation mismatch", 409);
    return {
      id: existing._id,
      gameKey: existing.gameKey,
      commitment: existing.commitment,
      rulesHash: existing.rulesHash,
      preparedAt: existing.createdAt,
      expiresAt: existing.expiresAt,
    };
  }
  async enter(userId: string, input: unknown) {
    const b = z
      .object({
        preparationId: z.string().uuid(),
        choice: z.string().max(20),
        stake: z.number().int().min(10).max(100),
        operation: z.string().uuid(),
      })
      .strict()
      .parse(input);
    return this.accounts.atomic(async (session) => {
      const prior = await this.accounts
        .rounds()
        .findOne({ userId, operation: b.operation }, { session });
      if (prior) {
        if (
          prior._id !== b.preparationId ||
          prior.choice !== b.choice ||
          prior.stake !== b.stake
        )
          throw new Fault("Operation terms mismatch", 409);
        return this.accounts.publicRound(prior);
      }
      const p = await this.preparations().findOne(
        {
          _id: b.preparationId,
          userId,
          used: false,
          expiresAt: { $gt: new Date() },
        },
        { session },
      );
      if (!p)
        throw new Fault(
          "Commitment expired or already used. Prepare a new round.",
          409,
        );
      const g = gameDefinition(p.gameKey)!;
      if (!(g.choices as readonly string[]).includes(b.choice))
        throw new Fault("Invalid choice");
      if (
        await this.accounts
          .rounds()
          .findOne(
            { userId, status: "PENDING", gameKind: { $ne: "market" } },
            { session },
          )
      )
        throw new Fault("Reveal your pending quick round first", 409);
      const a = await this.accounts
        .accounts()
        .findOneAndUpdate(
          { _id: userId, available: { $gte: b.stake } },
          { $inc: { available: -b.stake, committed: b.stake } },
          { session, returnDocument: "before" },
        );
      if (!a) throw new Fault("Insufficient ZYRO Points", 409);
      const r = {
        _id: p._id,
        id: p._id,
        userId,
        operation: b.operation,
        side: "YES" as const,
        botSide: "NO" as const,
        stake: b.stake,
        draw: 0,
        gameKey: p.gameKey,
        gameKind: "quick" as const,
        choice: b.choice,
        commitment: p.commitment,
        rulesHash: p.rulesHash,
        secret: p.secret,
        preparedAt: p.createdAt.toISOString(),
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
        resolveAt: new Date(Date.now() + 3000).toISOString(),
      };
      await this.preparations().updateOne(
        { _id: p._id, used: false },
        { $set: { used: true } },
        { session },
      );
      await this.accounts.rounds().insertOne(r, { session });
      await this.accounts.ledger().insertOne(
        {
          _id: randomUUID(),
          userId,
          kind: "STAKE",
          amount: -b.stake,
          before: a.available,
          after: a.available - b.stake,
          operation: `stake:${r.id}`,
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
  async reveal(userId: string, id: string) {
    const r = await this.accounts.rounds().findOne({ _id: id, userId });
    if (!r) throw new Fault("Round not found", 404);
    if (r.gameKind === "market")
      throw new Fault(
        "Scheduled markets are resolved by their data worker",
        409,
      );
    if (!r.gameKey) return this.accounts.resolve(userId, id); // Preserve Round 4 commitments verbatim.
    if (r.status !== "PENDING") return r;
    if (Date.now() < Date.parse(r.resolveAt))
      throw new Fault("Round is still running", 409);
    const key = r.gameKey as GameKey;
    if (
      r.commitment !== commitment(r.id, key, r.secret!) ||
      r.rulesHash !== rulesHash(key)
    )
      throw new Fault("Commitment verification failed", 409);
    return this.settle(id, outcome(key, r.secret!, r.choice!));
  }
  async settle(
    id: string,
    result: {
      values: number[];
      label: string;
      bot?: string;
      verdict: "WIN" | "LOSS" | "TIE" | "REFUND";
    },
  ) {
    return this.accounts.atomic(async (session) => {
      const r = await this.accounts.rounds().findOne({ _id: id }, { session });
      if (!r) throw new Fault("Round not found", 404);
      if (r.status !== "PENDING") return r;
      const payout =
        result.verdict === "WIN"
          ? r.stake * 2
          : result.verdict === "LOSS"
            ? 0
            : r.stake;
      const counted = result.verdict !== "REFUND",
        win = result.verdict === "WIN",
        loss = result.verdict === "LOSS";
      const a = await this.accounts.accounts().findOneAndUpdate(
        {
          _id: r.userId,
          committed: { $gte: r.stake },
          available: { $lte: Number.MAX_SAFE_INTEGER - payout },
        },
        {
          $inc: {
            available: payout,
            committed: -r.stake,
            played: counted ? 1 : 0,
            wins: win ? 1 : 0,
            net: payout - r.stake,
            earned: win ? r.stake : 0,
            lost: loss ? r.stake : 0,
            ties: result.verdict === "TIE" ? 1 : 0,
            ...(win ? { streak: 1 } : {}),
          },
          ...(loss ? { $set: { streak: 0 } } : {}),
        },
        { session, returnDocument: "before" },
      );
      if (!a) throw new Fault("Account reconciliation required", 409);
      const settled = {
        ...r,
        result,
        payout,
        status:
          result.verdict === "REFUND"
            ? ("CANCELLED" as const)
            : ("RESOLVED" as const),
        draw: result.values[0] || 0,
      };
      await this.accounts
        .rounds()
        .replaceOne({ _id: id }, settled, { session });
      await this.accounts.db
        .collection<{ _id: string; [key: string]: unknown }>("arena_results")
        .insertOne(
          {
            _id: id,
            userId: r.userId,
            gameKey: r.gameKey,
            marketId: r.marketId,
            result,
            payout,
            resolvedAt: new Date(),
          },
          { session },
        );
      await this.accounts.ledger().insertOne(
        {
          _id: randomUUID(),
          userId: r.userId,
          kind: result.verdict,
          amount: payout,
          before: a.available,
          after: a.available + payout,
          operation: `settle:${id}`,
          createdAt: new Date(),
        },
        { session },
      );
      await this.accounts
        .users()
        .updateOne(
          { _id: r.userId },
          { $set: { lastActivity: new Date() } },
          { session },
        );
      return settled;
    });
  }
}
