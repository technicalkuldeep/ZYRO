import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
import { randomUUID } from "node:crypto";
import request from "supertest";
import { LivePrices } from "../apps/api/src/live-prices.js";
import {
  FastCrypto,
  fastSpec,
  fastOutcome,
  fastPhase,
} from "../apps/api/src/fast-crypto.js";
import { Accounts } from "../apps/api/src/accounts.js";
import { PriceProvider, parseCandles } from "../apps/api/src/price-provider.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
const start = Math.ceil(Date.now() / 180000) * 180000;
afterEach(() => vi.restoreAllMocks());
const message = (fields = {}) =>
  JSON.stringify({
    type: "ticker",
    product_id: "BTC-USD",
    price: "100.12",
    sequence: 1,
    trade_id: 1,
    time: new Date().toISOString(),
    ...fields,
  });
describe("Coinbase live message validation", () => {
  it("preserves extrema across coalesced ticker snapshots", () => {
    const feed = new LivePrices();
    const timestamp = new Date(
        Math.floor(Date.now() / 60000) * 60000 + 30000,
      ).toISOString(),
      received = Date.parse(timestamp);
    feed.ingest(
      message({ time: timestamp, price: "100", sequence: 1, trade_id: 1 }),
      received,
    );
    feed.ingest(
      message({ time: timestamp, price: "110", sequence: 2, trade_id: 2 }),
      received,
    );
    feed.ingest(
      message({ time: timestamp, price: "90", sequence: 3, trade_id: 3 }),
      received,
    );
    expect(feed.ticks.get("BTC-USD")?.bars?.[60]).toMatchObject({
      open: 100,
      high: 110,
      low: 90,
      close: 90,
    });
  });
  it("accepts real-format ticker and requires a fresh heartbeat before Live", () => {
    const f = new LivePrices();
    f.state = "Connected";
    expect(f.ingest(message())).toBe(true);
    expect(f.fresh("BTC-USD")).toBe(false);
    f.ingest(message({ type: "heartbeat" }));
    expect(f.fresh("BTC-USD")).toBe(true);
    f.state = "Reconnecting";
    expect(f.fresh("BTC-USD")).toBe(false);
  });
  it.each(["0", "-1", "NaN", "Infinity", "10000001", "0.000000001", "1e2"])(
    "rejects price %s",
    (price) => expect(new LivePrices().ingest(message({ price }))).toBe(false),
  );
  it("rejects malformed, stale, future and unsupported data", () => {
    const f = new LivePrices();
    expect(f.ingest("{")).toBe(false);
    expect(
      f.ingest(message({ time: new Date(Date.now() - 16000).toISOString() })),
    ).toBe(false);
    expect(
      f.ingest(message({ time: new Date(Date.now() + 10000).toISOString() })),
    ).toBe(false);
    expect(f.ingest(message({ product_id: "UNKNOWN" }))).toBe(false);
  });
  it("rejects duplicates and out-of-order updates", () => {
    const f = new LivePrices();
    expect(f.ingest(message({ sequence: 4, trade_id: 4 }))).toBe(true);
    expect(f.ingest(message({ sequence: 4, trade_id: 4 }))).toBe(false);
    expect(f.ingest(message({ sequence: 3, trade_id: 3 }))).toBe(false);
  });
  it("detects trade gaps but does not mistake sparse ticker sequence for missing trades", () => {
    const f = new LivePrices();
    f.ingest(message());
    f.ingest(message({ sequence: 100, trade_id: 2 }));
    expect(f.metrics.gaps).toBe(0);
    f.ingest(message({ sequence: 101, trade_id: 4 }));
    expect(f.metrics.gaps).toBe(1);
    expect(f.generation).toBe(1);
  });
  it("reconnects and cleans up timers after interruption", () => {
    vi.useFakeTimers();
    const sockets: Record<string, any>[] = [];
    const f = new LivePrices(() => {
      const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };
      sockets.push(ws);
      return ws as unknown as WebSocket;
    });
    try {
      f.start();
      sockets[0].onopen();
      expect(sockets[0].send).toHaveBeenCalled();
      sockets[0].onclose();
      expect(f.state).toBe("Reconnecting");
      vi.advanceTimersByTime(1000);
      expect(sockets.length).toBe(2);
      sockets[1].onopen();
      expect(f.generation).toBe(2);
      vi.advanceTimersByTime(13000);
      expect(sockets[1].close).toHaveBeenCalled();
      f.stop();
      expect(f.state).toBe("Data unavailable");
    } finally {
      f.stop();
      vi.useRealTimers();
    }
  });
});
describe("UTC specs and completed historical evidence", () => {
  it("uses exact two-minute boundaries, cutoff and deterministic rules", () => {
    const s = fastSpec("BTC-USD", start);
    expect(s.end - s.start).toBe(120000);
    expect(s.start - s.cutoff).toBe(5000);
    expect(s.startingCandle).toBe(start / 1000 - 60);
    expect(s.endingCandle).toBe(start / 1000 + 60);
    expect(() => fastSpec("BTC-USD", start + 60000)).toThrow();
  });
  it.each([
    [100, 101, "UP"],
    [100, 99, "DOWN"],
    [100, 100, "EQUAL"],
    [100.00000001, 100.00000002, "UP"],
  ])("compares %s and %s precisely", (a, b, result) =>
    expect(fastOutcome(Number(a), Number(b))).toBe(result),
  );
  it("sorts completed candles and leaves gaps absent", () => {
    const now = start + 120000,
      t = start / 1000;
    const c = parseCandles(
      [
        [t, 99, 101, 100, 100, 1],
        [t - 120, 99, 101, 100, 101, 1],
      ],
      now,
    );
    expect(c.map((v) => v.time)).toEqual([t - 120, t]);
    expect(c.find((v) => v.time === t - 60)).toBeUndefined();
  });
  it("rejects inconsistent candle values", () =>
    expect(() =>
      parseCandles([[start / 1000, 101, 100, 100, 100, 1]], start + 120000),
    ).toThrow());
});
describe.skipIf(process.env.ZYRO_TEST_MONGO !== "1")(
  "Fast crypto isolated Atlas transactions",
  () => {
    const name = "zyro_test_r6_" + randomUUID().slice(0, 8);
    let a: Accounts, s: FastCrypto, feed: LivePrices, store: Store;
    const now = () => vi.spyOn(Date, "now");
    const user = async () =>
      (
        await a.login({
          sub: randomUUID(),
          email: "r6@example.invalid",
          emailVerified: true,
          name: "Round 6 QA",
        })
      ).user;
    async function market() {
      await s.generate(start - 45000);
      const r = await s
        .rounds()
        .findOne({ "spec.pair": "BTC-USD", "spec.start": start });
      if (!r) throw Error("Missing round");
      return r;
    }
    async function enter(uid: string, id: string, hash: string, extra = {}) {
      return s.enter(uid, id, {
        direction: "UP",
        stake: 10,
        operation: randomUUID(),
        specHash: hash,
        ...extra,
      });
    }
    beforeAll(async () => {
      a = new Accounts(process.env.MONGODB_URI, name);
      await a.init();
      feed = new LivePrices();
      vi.spyOn(feed, "fresh").mockReturnValue(true);
      s = new FastCrypto(a, new PriceProvider(), feed);
      await s.init();
      store = new Store(":memory:", "");
      await store.init();
    }, 30000);
    beforeEach(() => {
      vi.spyOn(feed, "fresh").mockReturnValue(true);
    });
    afterAll(async () => {
      if (a) {
        if (a.db.databaseName === name && name.startsWith("zyro_test_r6_"))
          await a.db.dropDatabase();
        await a.client.close();
      }
      await store?.close();
    });
    it("generates deterministic rounds without duplication", async () => {
      await s.generate(start - 45000);
      const count = await s.rounds().countDocuments();
      await s.generate(start - 45000);
      expect(await s.rounds().countDocuments()).toBe(count);
      expect(count).toBe(9);
    });
    it("deducts once, keeps existing balance, rejects conflicting duplicate positions", async () => {
      now().mockReturnValue(start - 30000);
      const u = await user(),
        r = await market(),
        operation = randomUUID();
      const p = await enter(u._id, r._id, r.specHash, { operation });
      await enter(u._id, r._id, r.specHash, { operation });
      expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(90);
      expect(
        await a.ledger().countDocuments({ operation: `stake:${p.id}` }),
      ).toBe(1);
      await expect(enter(u._id, r._id, r.specHash)).rejects.toThrow(
        /already accepted/,
      );
    });
    it("enforces entry cutoff and no reopening after restart", async () => {
      const u = await user(),
        r = await market();
      now().mockReturnValue(start - 5000);
      await expect(enter(u._id, r._id, r.specHash)).rejects.toThrow(/closed/);
      const restored = new FastCrypto(a, s.provider, feed);
      await restored.generate();
      expect(
        fastPhase((await restored.rounds().findOne({ _id: r._id }))!),
      ).toBe("ENTRY_LOCKED");
    });
    it("rejects stale feed, altered specifications and invalid stake", async () => {
      const u = await user(),
        r = await market();
      now().mockReturnValue(start - 30000);
      vi.spyOn(feed, "fresh").mockReturnValue(false);
      await expect(enter(u._id, r._id, r.specHash)).rejects.toThrow(/delayed/);
      vi.spyOn(feed, "fresh").mockReturnValue(true);
      await expect(enter(u._id, r._id, "0".repeat(64))).rejects.toThrow(
        /Specification/,
      );
      await expect(
        enter(u._id, r._id, r.specHash, { stake: -1 }),
      ).rejects.toThrow();
    });
    it("prevents concurrent overspending and duplicate positions", async () => {
      now().mockReturnValue(start - 30000);
      const u = await user();
      await s.generate(start - 45000);
      const rs = await s.rounds().find({ "spec.start": start }).toArray();
      const results = await Promise.allSettled(
        rs.map((r) => enter(u._id, r._id, r.specHash, { stake: 100 })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const balance = await a.accounts().findOne({ _id: u._id });
      expect(balance?.available).toBe(0);
      expect(balance?.committed).toBe(100);
    });
    it.each([
      [101, "UP", 110],
      [99, "DOWN", 90],
      [100, "EQUAL", 100],
    ])(
      "settles %s once with restart recovery",
      async (close, outcome, balance) => {
        const u = await user();
        now().mockReturnValue(start - 30000);
        const r = await market();
        await s.rounds().updateOne(
          { _id: r._id },
          {
            $set: {
              status: "UPCOMING",
              nextAttempt: new Date(start + 10000),
            },
            $unset: {
              opening: "",
              evidence: "",
              outcome: "",
              lease: "",
              leaseUntil: "",
            },
          },
        );
        const p = await enter(u._id, r._id, r.specHash);
        vi.spyOn(s.provider, "candles").mockImplementation(async (_pair, t) => [
          {
            time: t!,
            open: 100,
            high: 101,
            low: 99,
            close: t === r.spec.startingCandle ? 100 : Number(close),
            volume: 1,
            raw: [
              t!,
              99,
              101,
              100,
              t === r.spec.startingCandle ? 100 : Number(close),
              1,
            ],
          },
        ]);
        now().mockReturnValue(start + 1000);
        await s.process(r._id);
        expect((await a.rounds().findOne({ _id: p.id }))?.status).toBe(
          "PENDING",
        );
        now().mockReturnValue(start + 11000);
        await s.process(r._id);
        expect((await s.rounds().findOne({ _id: r._id }))?.opening?.time).toBe(
          r.spec.startingCandle,
        );
        now().mockReturnValue(start + 131000);
        await s.process(r._id);
        const restored = new FastCrypto(a, s.provider, feed);
        await Promise.all([restored.process(r._id), restored.process(r._id)]);
        expect((await restored.rounds().findOne({ _id: r._id }))?.outcome).toBe(
          outcome,
        );
        expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(
          balance,
        );
        expect((await a.accounts().findOne({ _id: u._id }))?.committed).toBe(0);
        expect(
          await a.ledger().countDocuments({ operation: `settle:${p.id}` }),
        ).toBe(1);
      },
    );
    it("keeps missing evidence pending then refunds after the predefined deadline", async () => {
      now().mockReturnValue(start - 30000);
      const r = await market(),
        u = await user();
      await s.rounds().updateOne(
        { _id: r._id },
        {
          $set: { status: "UPCOMING", nextAttempt: new Date(start + 10000) },
          $unset: { opening: "", evidence: "", outcome: "" },
        },
      );
      const p = await enter(u._id, r._id, r.specHash);
      vi.spyOn(s.provider, "candles").mockResolvedValue([]);
      now().mockReturnValue(start + 131000);
      await s.process(r._id);
      expect((await s.rounds().findOne({ _id: r._id }))?.status).toBe(
        "DATA_DELAYED",
      );
      expect((await a.rounds().findOne({ _id: p.id }))?.status).toBe("PENDING");
      now().mockReturnValue(start + 3720001);
      await s.process(r._id);
      expect((await a.rounds().findOne({ _id: p.id }))?.result?.verdict).toBe(
        "REFUND",
      );
      expect((await a.accounts().findOne({ _id: u._id }))?.available).toBe(100);
    });
    it("protects APIs from unauthenticated or client-authoritative outcomes", async () => {
      const app = createApp(store, async () => a).app;
      await request(app).get("/api/account/fast").expect(401);
      await request(app)
        .post("/api/account/fast/anything/predict")
        .set("Origin", "http://127.0.0.1:3000")
        .set("X-Zyro-Client", "web")
        .send({ outcome: "WIN", price: 1 })
        .expect(401);
    });
  },
);
