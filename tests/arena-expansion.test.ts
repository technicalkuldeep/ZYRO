import { beforeAll, afterAll, it, describe, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Accounts } from "../apps/api/src/accounts.js";
import { ArenaGames } from "../apps/api/src/arena-games.js";
import {
  CryptoMarkets,
  type CryptoMarket,
} from "../apps/api/src/crypto-markets.js";
import { PriceProvider } from "../apps/api/src/price-provider.js";
import { gameDefinitions } from "../packages/shared/src/arena-games.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { digest, outcome } from "../apps/api/src/game-random.js";
const live = process.env.ZYRO_TEST_MONGO === "1";
describe.skipIf(!live)(
  "Round 5 Atlas integrity (fixture prices, isolated database)",
  () => {
    const name = "zyro_test_r5_" + randomUUID().slice(0, 8);
    let a: Accounts,
      g: ArenaGames,
      store: Store,
      app: ReturnType<typeof createApp>["app"];
    const user = async () =>
      (
        await a.login({
          sub: randomUUID(),
          email: "round5@example.invalid",
          emailVerified: true,
          name: "Round 5 Test",
        })
      ).user;
    beforeAll(async () => {
      a = new Accounts(process.env.MONGODB_URI, name);
      await a.init();
      g = new ArenaGames(a);
      await g.init();
      store = new Store(":memory:", "");
      await store.init();
      app = createApp(store, async () => a).app;
    }, 30000);
    afterAll(async () => {
      vi.useRealTimers();
      if (a) {
        if (a.db.databaseName === name && name.startsWith("zyro_test_r5_"))
          await a.db.dropDatabase();
        await a.client.close();
      }
      await store?.close();
    }, 30000);
    for (const def of gameDefinitions)
      it(`${def.name}: persistent commitment, single debit and single payout`, async () => {
        const u = await user(),
          p = await g.prepare(u._id, def.key, randomUUID()),
          op = randomUUID();
        expect(p).not.toHaveProperty("secret");
        const r = await g.enter(u._id, {
          preparationId: p.id,
          choice: def.choices[0],
          stake: 10,
          operation: op,
        });
        await g.enter(u._id, {
          preparationId: p.id,
          choice: def.choices[0],
          stake: 10,
          operation: op,
        });
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          90,
        );
        const saved = await a.rounds().findOne({ _id: r.id });
        expect(saved!.preparedAt! <= saved!.createdAt).toBe(true);
        await expect(g.reveal(u._id, r.id)).rejects.toThrow("still running");
        await a
          .rounds()
          .updateOne(
            { _id: r.id },
            { $set: { resolveAt: new Date(0).toISOString() } },
          );
        const replies = await Promise.all([
          g.reveal(u._id, r.id),
          g.reveal(u._id, r.id),
        ]);
        expect(replies[0]).toEqual(replies[1]);
        expect(
          await a.ledger().countDocuments({ operation: `settle:${r.id}` }),
        ).toBe(1);
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          90 + (replies[0].payout || 0),
        );
        const reconnect = new Accounts(process.env.MONGODB_URI, name);
        await reconnect.init();
        expect(
          (await reconnect.rounds().findOne({ _id: r.id }))?.result,
        ).toEqual(replies[0].result);
        await reconnect.client.close();
      }, 30000);
    it("refunds a genuine committed RPS tie exactly once", async () => {
      const u = await user(),
        p = await g.prepare(u._id, "rock-paper-scissors", randomUUID()),
        secret = (await g.preparations().findOne({ _id: p.id }))!.secret;
      const choice = outcome("rock-paper-scissors", secret, "ROCK").bot!;
      const r = await g.enter(u._id, {
        preparationId: p.id,
        choice,
        stake: 10,
        operation: randomUUID(),
      });
      await a
        .rounds()
        .updateOne(
          { _id: r.id },
          { $set: { resolveAt: new Date(0).toISOString() } },
        );
      const result = await g.reveal(u._id, r.id);
      expect(result.result?.verdict).toBe("TIE");
      expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(100);
    });
    it("rejects own outcomes, reused secrets, choice changes and concurrent overspending", async () => {
      const u = await user(),
        p = await g.prepare(u._id, "coin-flip", randomUUID());
      const body = {
        preparationId: p.id,
        choice: "HEADS",
        stake: 100,
        operation: randomUUID(),
      };
      await expect(
        g.enter(u._id, { ...body, outcome: "HEADS" }),
      ).rejects.toThrow();
      const results = await Promise.allSettled([
        g.enter(u._id, body),
        g.enter(u._id, { ...body, operation: randomUUID() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(
        g.enter(u._id, { ...body, choice: "TAILS" }),
      ).rejects.toThrow(/mismatch|already used/);
      expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(0);
    });
    it("unauthenticated/spoofed users cannot invoke new game/admin APIs", async () => {
      await request(app).get("/api/account/discovery").expect(401);
      const u = await user(),
        token = await a.newSession(u._id);
      await request(app)
        .get("/api/admin/arena")
        .set("Cookie", `zyro_account=${token};role=admin`)
        .set("X-Role", "admin")
        .expect(403);
      await request(app)
        .post("/api/account/games/enter")
        .set("Cookie", `zyro_account=${token}`)
        .send({})
        .expect(403);
    });
    const provider = (close = 101, fail = false) =>
      new PriceProvider((async (url: URL | string | Request) => {
        if (fail) throw new Error("Fixture provider outage");
        const source = new URL(String(url)),
          t = source.searchParams.has("start")
            ? Date.parse(source.searchParams.get("start")!) / 1000
            : Math.floor(Date.now() / 60000) * 60 - 120;
        return new Response(JSON.stringify([[t, 99, 105, 100, close, 1000]]), {
          status: 200,
        });
      }) as typeof fetch);
    async function market(c: CryptoMarkets) {
      await c.init();
      return c.publish(
        "BTC-USD",
        Math.ceil((Date.now() + 120000) / 60000) * 60,
      );
    }
    function afterClose(m: CryptoMarket) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(m.spec.observationTime + 11000);
    }
    it("seeds six valid future BTC/ETH/SOL markets without duplicates", async () => {
      const c = new CryptoMarkets(a, provider());
      await c.init();
      await c.seed();
      await c.seed();
      const list = await c.list();
      expect(list).toHaveLength(6);
      expect(new Set(list.map((m) => m.spec.pair)).size).toBe(3);
      for (const m of list) {
        expect(digest(JSON.stringify(m.spec))).toBe(m.specHash);
        expect(m.spec.cutoff).toBeGreaterThan(Date.now());
      }
    });
    it("no early outcome, no player cancellation, no blocked quick games while crypto pending", async () => {
      const c = new CryptoMarkets(a, provider()),
        m = await market(c),
        u = await user();
      const b = {
        side: "YES",
        stake: 10,
        operation: randomUUID(),
        specHash: m.specHash,
      };
      await c.enter(u._id, m._id, b);
      await c.process(m._id);
      expect((await c.markets().findOne({ _id: m._id }))?.status).toBe("OPEN");
      const r = await a.rounds().findOne({ userId: u._id });
      await expect(a.cancel(u._id, r!.id)).rejects.toThrow("policy");
      await expect(g.reveal(u._id, r!.id)).rejects.toThrow("worker");
      const p = await g.prepare(u._id, "coin-flip", randomUUID());
      await g.enter(u._id, {
        preparationId: p.id,
        choice: "HEADS",
        stake: 10,
        operation: randomUUID(),
      });
      expect((await a.accounts().findOne({ _id: u._id }))?.committed).toBe(20);
    });
    it("settles exact completed evidence once across concurrent workers and restart recovery", async () => {
      const c = new CryptoMarkets(a, provider()),
        m = await market(c),
        u = await user();
      await c.enter(u._id, m._id, {
        side: "NO",
        stake: 10,
        operation: randomUUID(),
        specHash: m.specHash,
      });
      afterClose(m);
      try {
        await Promise.all([
          c.process(m._id),
          new CryptoMarkets(a, provider()).process(m._id),
        ]);
        const final = await c.markets().findOne({ _id: m._id });
        expect(final?.status).toBe("RESOLVED");
        expect(final?.outcome).toBe("NO");
        expect(final?.evidence?.candle.time).toBe(m.spec.candleStart);
        const r = await a.rounds().findOne({ userId: u._id });
        expect(
          await a.ledger().countDocuments({ operation: `settle:${r!.id}` }),
        ).toBe(1);
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          110,
        );
        await new CryptoMarkets(a, provider()).tick();
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          110,
        );
      } finally {
        vi.useRealTimers();
      }
    });
    it("provider failure preserves pending points, retries, and applies only the agreed 24h refund", async () => {
      const c = new CryptoMarkets(a, provider()),
        m = await c.publish(
          "SOL-USD",
          Math.ceil((Date.now() + 180000) / 60000) * 60,
        ),
        u = await user();
      await c.enter(u._id, m._id, {
        side: "YES",
        stake: 10,
        operation: randomUUID(),
        specHash: m.specHash,
      });
      afterClose(m);
      try {
        const broken = new CryptoMarkets(a, provider(101, true));
        await broken.process(m._id);
        expect((await c.markets().findOne({ _id: m._id }))?.status).toBe(
          "PENDING_VERIFICATION",
        );
        expect((await a.accounts().findOne({ _id: u._id }))?.committed).toBe(
          10,
        );
        vi.setSystemTime(m.spec.observationTime + 86400001);
        await broken.process(m._id);
        await broken.process(m._id);
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          100,
        );
        expect((await c.markets().findOne({ _id: m._id }))?.status).toBe(
          "CANCELLED",
        );
      } finally {
        vi.useRealTimers();
      }
    });
    it("only the verified owner can pause entries, with immutable terms and audit idempotency", async () => {
      const c = new CryptoMarkets(a, provider()),
        m = await c.publish(
          "BTC-USD",
          Math.ceil((Date.now() + 360000) / 60000) * 60,
        ),
        u = await user();
      await expect(
        c.disable(u, m._id, "Untrusted pause attempt", randomUUID()),
      ).rejects.toThrow("Administrator");
      const admin = (
        await a.login({
          sub: "round5-owner",
          email: process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com",
          emailVerified: true,
          name: "Test owner",
        })
      ).user;
      const op = randomUUID();
      await c.disable(admin, m._id, "Fixture operational pause", op);
      await c.disable(admin, m._id, "Fixture operational pause", op);
      const saved = await c.markets().findOne({ _id: m._id });
      expect(saved?.disabled).toBe(true);
      expect(saved?.specHash).toBe(m.specHash);
      expect(saved?.spec).toEqual(m.spec);
      expect(
        await a.db
          .collection("arena_content_audit")
          .countDocuments({ _id: op }),
      ).toBe(1);
      await expect(
        c.enter(u._id, m._id, {
          side: "YES",
          stake: 10,
          operation: randomUUID(),
          specHash: m.specHash,
        }),
      ).rejects.toThrow("closed");
    });
    it("cutoff and specification hash prevent changed or late predictions", async () => {
      const c = new CryptoMarkets(a, provider()),
        m = await c.publish(
          "ETH-USD",
          Math.ceil((Date.now() + 240000) / 60000) * 60,
        ),
        u = await user();
      await expect(
        c.enter(u._id, m._id, {
          side: "YES",
          stake: 10,
          operation: randomUUID(),
          specHash: "a".repeat(64),
        }),
      ).rejects.toThrow("mismatch");
      afterClose(m);
      try {
        await expect(
          c.enter(u._id, m._id, {
            side: "YES",
            stake: 10,
            operation: randomUUID(),
            specHash: m.specHash,
          }),
        ).rejects.toThrow("closed");
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          100,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  },
);
