import { it, expect, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { acceptanceMessage } from "@zyro/shared";
import request from "supertest";
import { Store } from "../apps/api/src/store";
import { Engine } from "../apps/api/src/engine";
import { createApp } from "../apps/api/src/app";
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL persists and serializes concurrent ledger mutations",
  async () => {
    const store = new Store(":memory:", process.env.TEST_DATABASE_URL);
    await store.init();
    try {
      const engine = new Engine(store);
      const session = await engine.session();
      const results = await Promise.allSettled([
        engine.predict(session.id, "YES", 100),
        engine.predict(session.id, "NO", 100),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await engine.arena(session.id)).session?.credits).toBe(900);
    } finally {
      await store.close();
    }
  },
);
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL survives API recreation, preserves market/history/balance, and serializes across two connections",
  async () => {
    const url = process.env.TEST_DATABASE_URL;
    let first = new Store(":memory:", url);
    await first.init();
    let second: Store | undefined;
    try {
      const { app } = createApp(first);
      const client = request.agent(app);
      const session = await client.get("/api/session").expect(200);
      const cookie = (
        session.headers["set-cookie"] as unknown as string[]
      )[0].split(";")[0];
      const input = {
        question: "Will this persistent PostgreSQL integration pass?",
        description:
          "A database integration challenge that must persist after the API and database pool are recreated.",
        category: "Zcash",
        stake: 10000000,
        fundingDeadline: new Date(Date.now() + 60000).toISOString(),
        resolutionDeadline: new Date(Date.now() + 120000).toISOString(),
        source: "https://z.cash/",
        rules: "YES if the database test passes all checks, otherwise NO.",
      };
      const created = await client
        .post("/api/markets")
        .set("Origin", "http://127.0.0.1:3000")
        .set("X-Zyro-Client", "web")
        .send(input)
        .expect(201);
      const pending = await client
        .post("/api/arena/predict")
        .set("Origin", "http://127.0.0.1:3000")
        .set("X-Zyro-Client", "web")
        .send({ side: "YES", stake: 50 })
        .expect(201);
      await first.close();
      first = new Store(":memory:", url);
      await first.init();
      const restarted = createApp(first).app;
      expect(
        (
          await request(restarted)
            .get("/api/markets/" + created.body.id)
            .set("Cookie", cookie)
            .expect(200)
        ).body.question,
      ).toBe(input.question);
      const state = (
        await request(restarted)
          .get("/api/arena")
          .set("Cookie", cookie)
          .expect(200)
      ).body;
      expect(state.session.credits).toBe(950);
      expect(state.rounds[0].id).toBe(pending.body.id);
      second = new Store(":memory:", url);
      await second.init();
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const key = publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64");
      const signature = sign(
        null,
        Buffer.from(
          acceptanceMessage(created.body.agreementHash, session.body.id, "YES"),
        ),
        privateKey,
      ).toString("base64");
      const joins = await Promise.allSettled([
        new Engine(first).join(
          session.body.id,
          created.body.id,
          "YES",
          key,
          signature,
        ),
        new Engine(second).join(
          session.body.id,
          created.body.id,
          "YES",
          key,
          signature,
        ),
      ]);
      expect(joins.filter((j) => j.status === "fulfilled")).toHaveLength(1);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 6000);
      const resolved = await Promise.all([
        new Engine(first).resolve(session.body.id, pending.body.id),
        new Engine(second).resolve(session.body.id, pending.body.id),
      ]);
      expect(resolved[0].payout).toBe(resolved[1].payout);
      const ledger = await new Engine(first).arena(session.body.id);
      expect(ledger.session?.credits).toBe(950 + (resolved[0].payout || 0));
      expect(ledger.stats.played).toBe(1);
    } finally {
      vi.useRealTimers();
      await first.close();
      await second?.close();
    }
  },
  30000,
);
