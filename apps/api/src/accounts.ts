import { MongoClient, type ClientSession, type Db } from "mongodb";
import { randomBytes, randomUUID } from "node:crypto";
import { botSide, type Round, type Side } from "@zyro/shared";
import { Fault } from "./engine.js";
import { hash } from "./policy.js";
import { z } from "zod";

export type User = {
  _id: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatar?: string;
  createdAt: Date;
  lastLogin: Date;
  lastActivity: Date;
};
export type Account = {
  _id: string;
  available: number;
  committed: number;
  played: number;
  wins: number;
  net: number;
  streak: number;
  grants: number;
  ties?: number;
  earned?: number;
  lost?: number;
};
export type Identity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatar?: string;
};
type Ledger = {
  _id: string;
  userId: string;
  kind: string;
  amount: number;
  before: number;
  after: number;
  createdAt: Date;
  operation: string;
};
export class Accounts {
  client: MongoClient;
  db: Db;
  constructor(
    uri = process.env.MONGODB_URI,
    name = process.env.MONGODB_DB_NAME || "zyro",
  ) {
    if (!uri) throw new Fault("MongoDB is not configured", 503);
    if (name !== "zyro" && !name.startsWith("zyro_test_"))
      throw new Error(
        "Arena database must be zyro or an isolated zyro_test_ database",
      );
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
    });
    this.db = this.client.db(name);
  }
  users() {
    return this.db.collection<User>("users");
  }
  accounts() {
    return this.db.collection<Account>("arena_accounts");
  }
  rounds() {
    return this.db.collection<Round & { _id: string; operation: string }>(
      "arena_predictions",
    );
  }
  ledger() {
    return this.db.collection<Ledger>("arena_ledger");
  }
  sessions() {
    return this.db.collection<{
      _id: string;
      userId?: string;
      expiresAt: Date;
      kind: string;
      nonce?: string;
      verifier?: string;
      returnTo?: string;
    }>("sessions");
  }
  audits() {
    return this.db.collection<{
      _id: string;
      actorId: string;
      actorSub: string;
      actorEmail: string;
      userId: string;
      amount: number;
      reason: string;
      before: number;
      after: number;
      createdAt: Date;
      result: string;
    }>("admin_audit_logs");
  }
  async init() {
    await this.client.connect();
    const hello = await this.db.command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid")
      throw new Error("MongoDB replica set transactions are required");
    for (const collection of [
      "users",
      "sessions",
      "arena_accounts",
      "arena_ledger",
      "arena_games",
      "arena_predictions",
      "arena_results",
      "admin_audit_logs",
      "admin_identity",
    ]) {
      if (
        !(await this.db.listCollections({ name: collection }).toArray()).length
      )
        await this.db.createCollection(collection);
    }
    await Promise.all([
      this.users().createIndex({ sub: 1 }, { unique: true }),
      this.users().createIndex({ email: 1 }),
      this.users().createIndex({ name: 1 }),
      this.users().createIndex({ lastActivity: -1 }),
      this.users().createIndex({ createdAt: -1 }),
      this.sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.accounts().createIndex({ net: -1, wins: -1 }),
      this.rounds().createIndex({ userId: 1, createdAt: -1 }),
      this.rounds().createIndex({ userId: 1, operation: 1 }, { unique: true }),
      this.rounds().createIndex({ status: 1, resolveAt: 1 }),
      this.ledger().createIndex({ userId: 1, createdAt: -1 }),
      this.ledger().createIndex({ operation: 1 }, { unique: true }),
      this.audits().createIndex({ userId: 1, createdAt: -1 }),
      this.audits().createIndex({ createdAt: -1 }),
    ]);
    // Replace Round 4's one-pending-round constraint: scheduled markets must not block short games.
    const oldIndex = (await this.rounds().indexes()).find(
      (i) => i.name === "userId_1",
    );
    if (oldIndex) await this.rounds().dropIndex("userId_1");
    await this.rounds().createIndex(
      { userId: 1, gameKind: 1 },
      {
        unique: true,
        partialFilterExpression: { status: "PENDING", gameKind: "quick" },
        name: "one_pending_quick",
      },
    );
    await this.db.collection("arena_games").updateOne(
      { key: "committed-draw" },
      {
        $setOnInsert: {
          key: "committed-draw",
          question: "Will the next draw land at 50 or above?",
          type: "random-practice",
          minStake: 10,
          maxStake: 100,
          revealDelayMs: 5000,
        },
      },
      { upsert: true },
    );
    // Prove transaction support before accepting any account mutation.
    await this.atomic(async (session) => {
      await this.users().findOne({}, { session });
    });
  }
  async atomic<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => fn(session), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
    } finally {
      await session.endSession();
    }
  }
  async login(identity: Identity) {
    // Concurrent first logins can collide on the sub unique index. Retry the complete transaction.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.atomic(async (session) => {
          let user = await this.users().findOne(
            { sub: identity.sub },
            { session },
          );
          const fresh = !user;
          const now = new Date();
          if (!user) {
            user = {
              _id: randomUUID(),
              ...identity,
              createdAt: now,
              lastLogin: now,
              lastActivity: now,
            };
            await this.users().insertOne(user, { session });
            await this.accounts().insertOne(
              {
                _id: user._id,
                available: 100,
                committed: 0,
                played: 0,
                wins: 0,
                net: 0,
                streak: 0,
                grants: 0,
              },
              { session },
            );
            await this.ledger().insertOne(
              {
                _id: randomUUID(),
                userId: user._id,
                kind: "INITIAL_GRANT",
                amount: 100,
                before: 0,
                after: 100,
                createdAt: now,
                operation: `initial:${user._id}`,
              },
              { session },
            );
          } else {
            await this.users().updateOne(
              { _id: user._id },
              { $set: { ...identity, lastLogin: now, lastActivity: now } },
              { session },
            );
            user = { ...user, ...identity, lastLogin: now, lastActivity: now };
          }
          if (
            identity.emailVerified &&
            identity.email.toLowerCase() ===
              (
                process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com"
              ).toLowerCase()
          ) {
            await this.db
              .collection<{ _id: string; sub: string; boundAt: Date }>(
                "admin_identity",
              )
              .updateOne(
                { _id: "owner" },
                { $setOnInsert: { sub: identity.sub, boundAt: now } },
                { upsert: true, session },
              );
          }
          return { user, fresh };
        });
      } catch (e) {
        if (attempt < 2 && (e as { code?: number }).code === 11000) continue;
        throw e;
      }
    }
  }
  async isAdmin(user: User) {
    if (
      !user.emailVerified ||
      user.email.toLowerCase() !==
        (
          process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com"
        ).toLowerCase()
    )
      return false;
    return (
      (
        await this.db
          .collection<{ _id: string; sub: string }>("admin_identity")
          .findOne({ _id: "owner" })
      )?.sub === user.sub
    );
  }
  async newSession(userId: string) {
    const token = randomBytes(32).toString("hex");
    await this.sessions().insertOne({
      _id: hash(token),
      userId,
      kind: "account",
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    return token;
  }
  async current(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.sessions().findOne({
      _id: hash(token),
      kind: "account",
      expiresAt: { $gt: new Date() },
    });
    return session?.userId
      ? this.users().findOne({ _id: session.userId })
      : null;
  }
  publicRound(r: Round) {
    const { secret: _secret, draw: _draw, ...visible } = r;
    return r.status === "PENDING" ? visible : r;
  }
  async arena(userId: string) {
    const [account, rounds, ledger, totals, pending] = await Promise.all([
      this.accounts().findOne({ _id: userId }),
      this.rounds()
        .find({ userId, status: { $ne: "PENDING" } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray(),
      this.ledger()
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray(),
      this.rounds()
        .aggregate<{ earned: number; lost: number; ties: number }>([
          { $match: { userId, status: "RESOLVED" } },
          {
            $group: {
              _id: null,
              earned: {
                $sum: {
                  $max: [
                    0,
                    { $subtract: [{ $ifNull: ["$payout", 0] }, "$stake"] },
                  ],
                },
              },
              lost: { $sum: { $cond: [{ $eq: ["$payout", 0] }, "$stake", 0] } },
              ties: { $sum: { $cond: [{ $eq: ["$payout", "$stake"] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
      this.rounds()
        .find({ userId, status: "PENDING" })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    return {
      account: account
        ? {
            ...account,
            earned: totals[0]?.earned || 0,
            lost: totals[0]?.lost || 0,
            ties: totals[0]?.ties || 0,
            pending: pending.length,
          }
        : null,
      rounds: [...pending, ...rounds].map((r) => this.publicRound(r)),
      ledger,
    };
  }
  async predict(userId: string, side: Side, stake: number, operation: string) {
    z.object({
      side: z.enum(["YES", "NO"]),
      stake: z.number().int().min(10).max(100),
      operation: z.string().uuid(),
    })
      .strict()
      .parse({ side, stake, operation });
    return this.atomic(async (session) => {
      const existing = await this.rounds().findOne(
        { userId, operation },
        { session },
      );
      if (existing) {
        if (existing.side !== side || existing.stake !== stake)
          throw new Fault("Operation already used with different terms", 409);
        return this.publicRound(existing);
      }
      if (
        await this.rounds().findOne({ userId, status: "PENDING" }, { session })
      )
        throw new Fault("Reveal your pending round first", 409);
      const account = await this.accounts().findOneAndUpdate(
        { _id: userId, available: { $gte: stake } },
        { $inc: { available: -stake, committed: stake } },
        { session, returnDocument: "before" },
      );
      if (!account) throw new Fault("Insufficient ZYRO Points", 409);
      const history = await this.rounds()
        .find({ userId, status: "RESOLVED" }, { session })
        .toArray();
      const secret = randomBytes(32).toString("hex");
      const id = randomUUID();
      const round = {
        _id: id,
        id,
        userId,
        operation,
        side,
        stake,
        botSide: botSide(history.map((r) => r.draw)) as Side,
        secret,
        commitment: hash(secret),
        draw: parseInt(hash(secret).slice(0, 8), 16) % 100,
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
        resolveAt: new Date(Date.now() + 5000).toISOString(),
      };
      await this.rounds().insertOne(round, { session });
      await this.ledger().insertOne(
        {
          _id: randomUUID(),
          userId,
          kind: "STAKE",
          amount: -stake,
          before: account.available,
          after: account.available - stake,
          createdAt: new Date(),
          operation: `stake:${id}`,
        },
        { session },
      );
      await this.users().updateOne(
        { _id: userId },
        { $set: { lastActivity: new Date() } },
        { session },
      );
      return this.publicRound(round);
    });
  }
  async resolve(userId: string, id: string) {
    return this.atomic(async (session) => {
      const r = await this.rounds().findOne({ _id: id, userId }, { session });
      if (!r) throw new Fault("Round not found", 404);
      if (r.gameKey) throw new Fault("Use the versioned Arena resolver", 409);
      if (r.status !== "PENDING") return r;
      if (Date.now() < Date.parse(r.resolveAt))
        throw new Fault("Round is still running", 409);
      const outcome: Side = r.draw >= 50 ? "YES" : "NO";
      const win = r.side === outcome;
      const payout = win ? r.stake * 2 : 0;
      const account = await this.accounts().findOneAndUpdate(
        { _id: userId, committed: { $gte: r.stake } },
        {
          $inc: {
            available: payout,
            committed: -r.stake,
            played: 1,
            wins: win ? 1 : 0,
            net: payout - r.stake,
            ...(win ? { streak: 1 } : {}),
          },
          ...(!win ? { $set: { streak: 0 } } : {}),
        },
        { session, returnDocument: "before" },
      );
      if (!account) throw new Fault("Account reconciliation required", 409);
      const result = { ...r, outcome, payout, status: "RESOLVED" as const };
      await this.rounds().replaceOne({ _id: id }, result, { session });
      await this.db
        .collection<{
          _id: string;
          userId: string;
          outcome: Side;
          payout: number;
          resolvedAt: Date;
        }>("arena_results")
        .insertOne(
          { _id: id, userId, outcome, payout, resolvedAt: new Date() },
          { session },
        );
      await this.ledger().insertOne(
        {
          _id: randomUUID(),
          userId,
          kind: win ? "WIN" : "LOSS",
          amount: payout,
          before: account.available,
          after: account.available + payout,
          createdAt: new Date(),
          operation: `settle:${id}`,
        },
        { session },
      );
      await this.users().updateOne(
        { _id: userId },
        { $set: { lastActivity: new Date() } },
        { session },
      );
      return result;
    });
  }
  async cancel(userId: string, id: string) {
    return this.atomic(async (session) => {
      const round = await this.rounds().findOne(
        { _id: id, userId },
        { session },
      );
      if (!round) throw new Fault("Round not found", 404);
      if (round.gameKind === "market")
        throw new Fault(
          "Scheduled predictions follow their published refund policy",
          409,
        );
      if (round.status === "CANCELLED") return round;
      if (round.status !== "PENDING")
        throw new Fault("Settled rounds cannot be cancelled", 409);
      const account = await this.accounts().findOneAndUpdate(
        { _id: userId, committed: { $gte: round.stake } },
        { $inc: { available: round.stake, committed: -round.stake } },
        { session, returnDocument: "before" },
      );
      if (!account) throw new Fault("Account reconciliation required", 409);
      await this.rounds().updateOne(
        { _id: id },
        { $set: { status: "CANCELLED", payout: round.stake } },
        { session },
      );
      await this.ledger().insertOne(
        {
          _id: randomUUID(),
          userId,
          kind: "CANCEL_REFUND",
          amount: round.stake,
          before: account.available,
          after: account.available + round.stake,
          createdAt: new Date(),
          operation: `cancel:${id}`,
        },
        { session },
      );
      return { ...round, status: "CANCELLED", payout: round.stake };
    });
  }
  async grant(
    actor: User,
    userId: string,
    amount: number,
    reason: string,
    operation: string,
  ) {
    if (!(await this.isAdmin(actor)))
      throw new Fault("Administrator access required", 403);
    z.object({
      userId: z.string().uuid(),
      amount: z
        .number()
        .int()
        .positive()
        .max(Math.min(1000000, Number(process.env.ADMIN_GRANT_LIMIT) || 10000)),
      reason: z.string().trim().min(5).max(500),
      operation: z.string().uuid(),
    }).parse({ userId, amount, reason, operation });
    return this.atomic(async (session) => {
      const prior = await this.audits().findOne(
        { _id: operation },
        { session },
      );
      if (prior) {
        if (
          prior.actorId !== actor._id ||
          prior.userId !== userId ||
          prior.amount !== amount ||
          prior.reason !== reason
        )
          throw new Fault("Operation already used with different terms", 409);
        return prior;
      }
      const account = await this.accounts().findOneAndUpdate(
        { _id: userId, available: { $lte: Number.MAX_SAFE_INTEGER - amount } },
        { $inc: { available: amount, grants: amount } },
        { session, returnDocument: "before" },
      );
      if (!account)
        throw new Fault("User not found or points limit reached", 404);
      const audit = {
        _id: operation,
        actorId: actor._id,
        actorSub: actor.sub,
        actorEmail: actor.email,
        userId,
        amount,
        reason,
        before: account.available,
        after: account.available + amount,
        createdAt: new Date(),
        result: "APPLIED",
      };
      await this.ledger().insertOne(
        {
          _id: operation,
          operation: `admin:${operation}`,
          userId,
          kind: "ADMIN_GRANT",
          amount,
          before: audit.before,
          after: audit.after,
          createdAt: audit.createdAt,
        },
        { session },
      );
      await this.audits().insertOne(audit, { session });
      return audit;
    });
  }
  async leaderboard() {
    return this.accounts()
      .aggregate([
        { $match: { played: { $gt: 0 } } },
        { $sort: { net: -1, wins: -1, _id: 1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $project: {
            _id: 0,
            name: { $concat: ["Player ", { $substrCP: ["$_id", 0, 8] }] },
            played: 1,
            wins: 1,
            net: 1,
          },
        },
      ])
      .toArray();
  }
  async overview() {
    const since = new Date(Date.now() - 7 * 86400000);
    const [users, registrations, active, pending, totals, recent] =
      await Promise.all([
        this.users().countDocuments(),
        this.users().countDocuments({ createdAt: { $gte: since } }),
        this.users().countDocuments({ lastActivity: { $gte: since } }),
        this.rounds().countDocuments({ status: "PENDING" }),
        this.accounts()
          .aggregate([
            {
              $group: {
                _id: null,
                available: { $sum: "$available" },
                committed: { $sum: "$committed" },
                played: { $sum: "$played" },
              },
            },
          ])
          .toArray(),
        this.audits().find().sort({ createdAt: -1 }).limit(30).toArray(),
      ]);
    return {
      users,
      registrations,
      active,
      pending,
      totals: totals[0] || { available: 0, committed: 0, played: 0 },
      recent,
    };
  }
  async directory(search: string, page: number, sort: string) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = search
      ? {
          $or: [
            { email: { $regex: escaped, $options: "i" } },
            { name: { $regex: escaped, $options: "i" } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      this.users().countDocuments(filter),
      this.users()
        .find(filter)
        .sort(sort === "name" ? { name: 1, _id: 1 } : { createdAt: -1, _id: 1 })
        .skip((page - 1) * 20)
        .limit(20)
        .toArray(),
    ]);
    const accounts = await this.accounts()
      .find({ _id: { $in: users.map((u) => u._id) } })
      .toArray();
    return {
      total,
      page,
      users: users.map((u) => ({
        ...u,
        account: accounts.find((a) => a._id === u._id),
      })),
    };
  }
}
