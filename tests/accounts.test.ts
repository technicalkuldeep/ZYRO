import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import express from "express";
import { Accounts } from "../apps/api/src/accounts.js";
import { accountRoutes } from "../apps/api/src/account-routes.js";
import { createApp } from "../apps/api/src/app.js";
import { Store } from "../apps/api/src/store.js";
import { hash } from "../apps/api/src/policy.js";
import { Fault } from "../apps/api/src/engine.js";
it("returns an explicit service failure when account storage is unavailable", async () => {
  const local = new Store(":memory:", "");
  await local.init();
  try {
    const { app } = createApp(local, async () => {
      throw new Fault("Arena database unavailable", 503);
    });
    await request(app).get("/api/auth/me").expect(503);
    await request(app).get("/api/account/arena").expect(503);
    expect(await local.list("round")).toEqual([]);
  } finally {
    await local.close();
  }
});
const live = process.env.ZYRO_TEST_MONGO === "1";
describe.skipIf(!live)("Atlas account integration (isolated database)", () => {
  let db: Accounts;
  let store: Store;
  let app: ReturnType<typeof createApp>["app"];
  let regular: Awaited<ReturnType<Accounts["login"]>>["user"];
  let admin: typeof regular;
  let regularToken: string;
  let adminToken: string;
  const name =
    "zyro_test_round4_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const identity = (
    sub: string,
    email = "player@example.invalid",
    emailVerified = true,
  ) => ({ sub, email, emailVerified, name: "Integration Player" });
  const post = (path: string, token?: string) =>
    request(app)
      .post(path)
      .set("Origin", "http://127.0.0.1:3000")
      .set("X-Zyro-Client", "web")
      .set("Cookie", `zyro_account=${token || ""}`);
  beforeAll(async () => {
    db = new Accounts(process.env.MONGODB_URI, name);
    await db.init();
    regular = (await db.login(identity("regular"))).user;
    admin = (
      await db.login(
        identity(
          "admin",
          process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com",
        ),
      )
    ).user;
    regularToken = await db.newSession(regular._id);
    adminToken = await db.newSession(admin._id);
    store = new Store(":memory:", "");
    await store.init();
    app = createApp(store, async () => db).app;
  }, 30000);
  afterAll(async () => {
    if (db) {
      if (db.db.databaseName === name && name.startsWith("zyro_test_round4_"))
        await db.db.dropDatabase();
      await db.client.close();
    }
    if (store) await store.close();
  }, 30000);
  it("creates one 100-point grant under concurrent login and separates identities", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () => db.login(identity("new-concurrent"))),
    );
    const u = await db.users().findOne({ sub: "new-concurrent" });
    expect((await db.accounts().findOne({ _id: u!._id }))?.available).toBe(100);
    expect(
      await db
        .ledger()
        .countDocuments({ userId: u!._id, kind: "INITIAL_GRANT" }),
    ).toBe(1);
    expect(u!._id).not.toBe(regular._id);
  });
  it("recognizes returning identity across sessions and connection restart", async () => {
    const again = await db.login(identity("regular"));
    expect(again.fresh).toBe(false);
    expect(again.user._id).toBe(regular._id);
    const second = await db.newSession(regular._id);
    expect((await db.current(second))?._id).toBe(regular._id);
    const reconnect = new Accounts(process.env.MONGODB_URI, name);
    await reconnect.init();
    expect(
      (await reconnect.accounts().findOne({ _id: regular._id }))?.available,
    ).toBe(100);
    await reconnect.client.close();
  });
  it("stores token hashes, expires sessions, and revokes on logout", async () => {
    const token = await db.newSession(regular._id);
    expect(await db.sessions().findOne({ _id: token })).toBeNull();
    await db
      .sessions()
      .updateOne({ _id: hash(token) }, { $set: { expiresAt: new Date(0) } });
    expect(await db.current(token)).toBeNull();
    const fresh = await db.newSession(regular._id);
    await post("/api/auth/logout", fresh).send({}).expect(200);
    expect(await db.current(fresh)).toBeNull();
  });
  it("rejects public directory, spoofed identities, and self-grants without balance changes", async () => {
    const before = await db.accounts().findOne({ _id: regular._id });
    await request(app).get("/api/admin/users").expect(401);
    await request(app).get("/api/account/arena").expect(401);
    await request(app)
      .get("/api/admin/users")
      .set(
        "Cookie",
        `zyro_account=${regularToken}; email=web3kuldeep@gmail.com; role=admin`,
      )
      .set("X-User-Email", "web3kuldeep@gmail.com")
      .set("X-Role", "admin")
      .expect(403);
    await post(`/api/admin/users/${regular._id}/grants`, regularToken)
      .send({
        amount: 100,
        reason: "Self grant rejected",
        operation: randomUUID(),
        role: "admin",
      })
      .expect(403);
    expect(await db.accounts().findOne({ _id: regular._id })).toEqual(before);
  });
  it("does not bind unverified admin emails or another sub to owner", async () => {
    const fake = (
      await db.login(
        identity(
          "unverified",
          process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com",
          false,
        ),
      )
    ).user;
    expect(await db.isAdmin(fake)).toBe(false);
    const alternate = (await db.login(identity("alternate-owner", admin.email)))
      .user;
    expect(await db.isAdmin(alternate)).toBe(false);
    expect(await db.isAdmin(admin)).toBe(true);
  });
  it("rejects cross-origin grants and invalid amounts", async () => {
    await request(app)
      .post(`/api/admin/users/${regular._id}/grants`)
      .set("Cookie", `zyro_account=${adminToken}`)
      .send({ amount: 10, reason: "Bad origin", operation: randomUUID() })
      .expect(403);
    for (const amount of [-1, 0, 1.5, 1000001])
      await post(`/api/admin/users/${regular._id}/grants`, adminToken)
        .send({ amount, reason: "Invalid amount", operation: randomUUID() })
        .expect(400);
  });
  it("applies one audited admin grant despite concurrent duplicates", async () => {
    const b = {
      amount: 100,
      reason: "Integration grant",
      operation: randomUUID(),
    };
    const replies = await Promise.all([
      post(`/api/admin/users/${regular._id}/grants`, adminToken).send(b),
      post(`/api/admin/users/${regular._id}/grants`, adminToken).send(b),
    ]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect((await db.accounts().findOne({ _id: regular._id }))?.available).toBe(
      200,
    );
    expect(await db.audits().countDocuments({ _id: b.operation })).toBe(1);
    expect(await db.ledger().countDocuments({ _id: b.operation })).toBe(1);
    expect((await db.audits().findOne({ _id: b.operation }))?.before).toBe(100);
    await post(`/api/admin/users/${regular._id}/grants`, adminToken)
      .send({ ...b, amount: 200 })
      .expect(409);
  });
  it("debits a stake once and excludes admin grants from rankings", async () => {
    const op = randomUUID();
    const a = await db.predict(regular._id, "YES", 10, op);
    const b = await db.predict(regular._id, "YES", 10, op);
    expect(a.id).toBe(b.id);
    expect("secret" in a).toBe(false);
    expect("draw" in a).toBe(false);
    expect((await db.accounts().findOne({ _id: regular._id }))?.available).toBe(
      190,
    );
    await db
      .rounds()
      .updateOne(
        { _id: a.id },
        { $set: { resolveAt: new Date(0).toISOString(), draw: 75 } },
      );
    await Promise.all([
      db.resolve(regular._id, a.id),
      db.resolve(regular._id, a.id),
    ]);
    const account = await db.accounts().findOne({ _id: regular._id });
    expect(account?.available).toBe(210);
    expect(account?.committed).toBe(0);
    expect(account?.net).toBe(10);
    expect(
      await db.ledger().countDocuments({ operation: `settle:${a.id}` }),
    ).toBe(1);
    expect((await db.leaderboard()).find((r) => r.net === 10)?.name).toMatch(
      /^Player /,
    );
  });
  it("accounts for a loss and cancellation without duplicate refunds", async () => {
    const loss = await db.predict(regular._id, "NO", 10, randomUUID());
    await db
      .rounds()
      .updateOne(
        { _id: loss.id },
        { $set: { resolveAt: new Date(0).toISOString(), draw: 75 } },
      );
    await db.resolve(regular._id, loss.id);
    expect((await db.accounts().findOne({ _id: regular._id }))?.available).toBe(
      200,
    );
    const cancel = await db.predict(regular._id, "YES", 10, randomUUID());
    await Promise.all([
      db.cancel(regular._id, cancel.id),
      db.cancel(regular._id, cancel.id),
    ]);
    await db.resolve(regular._id, cancel.id);
    expect((await db.accounts().findOne({ _id: regular._id }))?.available).toBe(
      200,
    );
    expect(
      await db.ledger().countDocuments({ operation: `cancel:${cancel.id}` }),
    ).toBe(1);
  });
  it("prevents concurrent overspending and rejects early/foreign reveals", async () => {
    const u = (await db.login(identity("overspend"))).user;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        db.predict(u._id, "YES", 100, randomUUID()),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await db.accounts().findOne({ _id: u._id });
    expect(a?.available).toBe(0);
    expect(a?.committed).toBe(100);
    const r = await db.rounds().findOne({ userId: u._id });
    await expect(db.resolve(u._id, r!.id)).rejects.toThrow("still running");
    await expect(db.resolve(regular._id, r!.id)).rejects.toThrow("not found");
  });
  it("supports admin directory search and stored details", async () => {
    const r = await request(app)
      .get("/api/admin/users?search=player%40example.invalid&sort=name")
      .set("Cookie", `zyro_account=${adminToken}`)
      .expect(200);
    expect(r.body.users.length).toBeGreaterThan(0);
    await request(app)
      .get(`/api/admin/users/${regular._id}`)
      .set("Cookie", `zyro_account=${adminToken}`)
      .expect(200);
  });
  it("handles OAuth state, one-time callback, verified identity and first/returning redirects", async () => {
    const auth = express();
    auth.use(express.json());
    auth.use(
      "/api",
      accountRoutes(
        async () => db,
        async () => identity("oauth-test"),
      ),
    );
    auth.use(
      (
        e: Error & { status?: number },
        _q: express.Request,
        s: express.Response,
        _n: express.NextFunction,
      ) => s.status(e.status || 500).json({ error: e.message }),
    );
    const agent = request.agent(auth);
    const start = await agent
      .get("/api/auth/google?returnTo=/arena/history")
      .expect(302);
    const url = new URL(start.headers.location);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await agent
      .get("/api/auth/google/callback?state=wrong&code=test")
      .expect(400);
    const state = url.searchParams.get("state");
    await agent
      .get(`/api/auth/google/callback?state=${state}&code=test`)
      .expect(302)
      .expect("Location", "/choose");
    await agent
      .get(`/api/auth/google/callback?state=${state}&code=test`)
      .expect(400);
    const again = await agent.get("/api/auth/google?returnTo=/arena/history");
    const second = new URL(again.headers.location).searchParams.get("state");
    await agent
      .get(`/api/auth/google/callback?state=${second}&code=test`)
      .expect(302)
      .expect("Location", "/arena/history");
  });
});
