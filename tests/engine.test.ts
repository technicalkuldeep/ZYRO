import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  agreement,
  acceptanceMessage,
  canonical,
  marketInput,
  payout,
  botSide,
  type Market,
} from "@zyro/shared";
import { Store } from "../apps/api/src/store";
import { Engine } from "../apps/api/src/engine";
import {
  hash,
  validateSettlement,
  type Proposal,
} from "../apps/api/src/policy";
import { createApp } from "../apps/api/src/app";
import request from "supertest";
let store: Store, engine: Engine;
const input = () => ({
  question: "Will this test resolve to YES on its deadline?",
  description:
    "An explicit test challenge with precise resolution criteria and an official source.",
  category: "Zcash",
  stake: 10000000,
  fundingDeadline: new Date(Date.now() + 60000).toISOString(),
  resolutionDeadline: new Date(Date.now() + 120000).toISOString(),
  source: "https://z.cash/",
  rules: "YES if the official announcement says YES; otherwise NO.",
});
beforeEach(async () => {
  store = new Store(":memory:", "");
  await store.init();
  engine = new Engine(store);
});
afterEach(async () => {
  vi.useRealTimers();
  await store.close();
});
describe("market engine", () => {
  it("creates persistent validated challenges and deterministic agreements", async () => {
    const m = await engine.create("alice", input());
    expect(await store.get(m.id)).toEqual(m);
    expect(hash(agreement(m))).toBe(m.agreementHash);
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
    for (const change of [
      { stake: m.stake + 1 },
      { question: "A changed question that is clear?" },
      { rules: "Changed resolution rules" },
      { source: "https://example.org/" },
      { description: "Changed description" },
      { fundingDeadline: "2027-01-01T00:00:00.000Z" },
    ])
      expect(hash(agreement({ ...m, ...change }))).not.toBe(m.agreementHash);
  });
  it("rejects invalid amounts, ambiguous rules, missing fields and reversed deadlines", () => {
    for (const change of [
      { stake: 1.5 },
      { stake: 100000001 },
      { question: "Short" },
      { rules: "vague" },
      { source: "http://z.cash" },
      { fundingDeadline: "2000-01-01T00:00:00.000Z" },
      { resolutionDeadline: new Date(Date.now() + 1).toISOString() },
    ])
      expect(marketInput.safeParse({ ...input(), ...change }).success).toBe(
        false,
      );
  });
  it("verifies acceptance, prevents duplicate sides and transitions to MATCHED", async () => {
    const m = await engine.create("alice", input());
    async function join(user: string, side: "YES" | "NO") {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      return engine.join(
        user,
        m.id,
        side,
        publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        sign(
          null,
          Buffer.from(acceptanceMessage(m.agreementHash, user, side)),
          privateKey,
        ).toString("base64"),
      );
    }
    await expect(engine.join("eve", m.id, "YES", "bad", "bad")).rejects.toThrow(
      "signature",
    );
    expect((await join("alice", "YES")).status).toBe("OPEN");
    await expect(join("alice", "NO")).rejects.toThrow("Already");
    await expect(join("bob", "YES")).rejects.toThrow("Already");
    expect((await join("bob", "NO")).status).toBe("MATCHED");
    await expect(join("charlie", "YES")).rejects.toThrow("closed");
  });
  it("cancels unmatched expired challenges and prevents late acceptance", async () => {
    vi.useFakeTimers();
    const m = await engine.create("alice", input());
    vi.advanceTimersByTime(61000);
    expect((await engine.markets())[0].status).toBe("CANCELLED");
    await expect(engine.join("bob", m.id, "NO", "bad", "bad")).rejects.toThrow(
      "closed",
    );
  });
});
describe("Arena ledger", () => {
  it("reserves credits, hides draw, resolves fairly and is idempotent", async () => {
    vi.useFakeTimers();
    const s = await engine.session();
    const r = await engine.predict(s.id, "YES", 50);
    expect(r).not.toHaveProperty("secret");
    expect(r).not.toHaveProperty("draw");
    expect((await engine.arena(s.id)).session?.credits).toBe(950);
    await expect(engine.resolve(s.id, r.id)).rejects.toThrow("still running");
    await expect(engine.predict(s.id, "NO", 50)).rejects.toThrow(
      "current round",
    );
    vi.advanceTimersByTime(6000);
    const result = await engine.resolve(s.id, r.id);
    expect(hash(result.secret!)).toBe(result.commitment);
    expect(result.draw).toBe(
      parseInt(hash(result.secret!).slice(0, 8), 16) % 100,
    );
    expect(result.outcome).toBe(result.draw >= 50 ? "YES" : "NO");
    expect((await engine.arena(s.id)).session?.credits).toBe(
      950 + (result.side === result.outcome ? 100 : 0),
    );
    await engine.resolve(s.id, r.id);
    expect((await engine.arena(s.id)).stats.played).toBe(1);
  });
  it("serializes concurrent debit and resolution, rejects insufficient funds and other users", async () => {
    vi.useFakeTimers();
    const s = await engine.session();
    const outcomes = await Promise.allSettled([
      engine.predict(s.id, "YES", 100),
      engine.predict(s.id, "NO", 100),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const round = (await engine.arena(s.id)).rounds[0];
    await expect(engine.resolve("other", round.id)).rejects.toThrow(
      "not found",
    );
    vi.advanceTimersByTime(6000);
    await Promise.all([
      engine.resolve(s.id, round.id),
      engine.resolve(s.id, round.id),
    ]);
    expect((await engine.arena(s.id)).session?.credits).toBeGreaterThanOrEqual(
      900,
    );
    s.credits = 0;
    await store.put(s.id, "session", s);
    await expect(engine.predict(s.id, "NO", 10)).rejects.toThrow("Not enough");
  });
  it("bot follows its documented rule", () => {
    expect(botSide([])).toBe("YES");
    expect(botSide([10, 20, 40])).toBe("NO");
    expect(botSide([70, 80])).toBe("YES");
    expect(botSide([50])).toBe("YES");
  });
});
describe("settlement policy: independent of transaction signing", () => {
  let m: Market, p: Proposal;
  const context = {
    settled: false,
    funded: true,
    winnerAddress: "testnet-winner",
    resolutionVerified: true,
  };
  beforeEach(async () => {
    m = await engine.create("alice", input());
    m.status = "RESOLVED";
    m.outcome = "YES";
    m.evidence = "official-evidence-hash";
    p = {
      agreementHash: m.agreementHash,
      network: "testnet",
      recipient: context.winnerAddress,
      amount: payout(m.stake),
      fee: 10000,
      change: 0,
      outputs: 1,
      resolutionEvidence: m.evidence,
    };
  });
  it("calculates integer distributions and accepts only the exact proposal", () => {
    expect(payout(10000000)).toBe(19990000);
    expect(() => payout(1.1)).toThrow();
    expect(validateSettlement(m, p, context).allowed).toBe(true);
    const altered = { ...m, stake: m.stake + 10000 };
    expect(() =>
      validateSettlement(
        altered,
        {
          ...p,
          agreementHash: hash(agreement(altered)),
          amount: payout(altered.stake),
        },
        context,
      ),
    ).toThrow("agreement");
  });
  it.each([
    { recipient: "attacker" },
    { amount: 2 },
    { amount: 19990000.5 },
    { amount: Number.NaN },
    { fee: 0 },
    { fee: 10001 },
    { change: 1 },
    { outputs: 2 },
    { agreementHash: "wrong" },
    { network: "mainnet" },
    { resolutionEvidence: "forged" },
  ])("rejects malformed payout %j", (change) => {
    expect(() =>
      validateSettlement(m, { ...p, ...change } as Proposal, context),
    ).toThrow();
  });
  it("rejects unauthorized states, duplicate settlement, unverified funding and outcome", () => {
    for (const c of [
      { settled: true },
      { funded: false },
      { resolutionVerified: false },
    ])
      expect(() => validateSettlement(m, p, { ...context, ...c })).toThrow();
    expect(() =>
      validateSettlement({ ...m, status: "MATCHED" }, p, context),
    ).toThrow();
  });
  it("fails closed on untyped coordinator flags, unknown fields and invalid outcomes", () => {
    for (const change of [
      { funded: "true" },
      { settled: 0 },
      { resolutionVerified: "yes" },
    ])
      expect(() =>
        validateSettlement(m, p, { ...context, ...change } as typeof context),
      ).toThrow();
    expect(() =>
      validateSettlement(m, { ...p, allowed: true } as Proposal, context),
    ).toThrow();
    expect(() =>
      validateSettlement(
        { ...m, outcome: "INVALID" } as unknown as Market,
        p,
        context,
      ),
    ).toThrow();
  });
});
describe("HTTP boundary", () => {
  it("rejects invalid input and cross-origin writes; retains private bearer cookie", async () => {
    const { app } = createApp(store);
    const client = request.agent(app);
    const session = await client.get("/api/session").expect(200);
    expect(session.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(session.headers["set-cookie"][0]).not.toContain(session.body.id);
    await client.post("/api/markets").send(input()).expect(403);
    await client
      .post("/api/markets")
      .set("Origin", "http://127.0.0.1:3000")
      .set("X-Zyro-Client", "web")
      .send({})
      .expect(400);
    await client
      .post("/api/arena/predict")
      .set("Origin", "http://127.0.0.1:3000")
      .set("X-Zyro-Client", "web")
      .send({ side: "YES", stake: -100 })
      .expect(400);
    await client
      .post("/api/markets")
      .set("Origin", "http://127.0.0.1:3000")
      .set("X-Zyro-Client", "web")
      .send(input())
      .expect(201);
    expect((await client.get("/api/dashboard")).body.markets).toHaveLength(1);
  });
});
