import express from "express";
import request from "supertest";
import { MongoClient } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FixtureCustody,
  validatePlan,
} from "../apps/api/src/taz-markets/custody.js";
import {
  classify,
  digest,
  NETWORK,
  outputKey,
  resolveFixture,
  settlement,
  STAKE,
  validateScan,
  type Deposit,
  type Market,
  type Note,
  type Plan,
  type Position,
  type Scan,
} from "../apps/api/src/taz-markets/model.js";
import { tazReadRouter } from "../apps/api/src/taz-markets/routes.js";
import { TazStore } from "../apps/api/src/taz-markets/store.js";

import {
  block,
  candle,
  change,
  closesAt,
  fixtureRules,
  received,
  recipient,
  snapshot,
  token,
  walletId,
} from "./taz-fixtures.js";
const market: Market = {
  _id: "market",
  rules: fixtureRules,
  rulesHash: digest(fixtureRules),
  status: "frozen",
  close: block(8),
};
const position: Position = {
  _id: "a",
  owner: "owner-a",
  marketId: market._id,
  side: "YES",
  rulesHash: market.rulesHash,
  stake: STAKE,
  recipient,
  association: "wallet-decrypted-memo",
  addressReviewer: "fixture-operator",
  payout: "fixture-utest-payout",
  refund: "fixture-utest-refund",
  network: NETWORK,
  createdAt: 100_000,
  closesAt,
  requestId: "intent-1",
  status: "qualified",
  memo: "fixture-memo",
};
const deposit = (note: Note, positionId?: string): Deposit => ({
  _id: outputKey(note),
  note,
  positionId,
  status: positionId ? "qualified" : "reserve",
});

afterEach(() => vi.unstubAllEnvs());

describe("TAZ accounting and fixture evidence", () => {
  it.each([
    [105, "YES"],
    [95, "NO"],
    [100, "NO"],
  ] as const)("resolves %s as %s", (price, side) => {
    expect(resolveFixture(fixtureRules, [candle(price)], 180_000)?.side).toBe(
      side,
    );
  });

  it("holds early, missing and conflicting candle evidence", () => {
    expect(
      resolveFixture(fixtureRules, [candle(105)], 179_999),
    ).toBeUndefined();
    expect(
      resolveFixture(fixtureRules, [[[60, 90, 110, 100, 105, 1]]], 180_000),
    ).toBeUndefined();
    expect(
      resolveFixture(fixtureRules, [candle(105), candle(95)], 180_000),
    ).toBeUndefined();
    expect(
      resolveFixture(fixtureRules, [candle(105), candle(105)], 180_000)?.side,
    ).toBe("YES");
  });

  it("attributes exact, partial, excess, wrong destination and late deposits", () => {
    expect(classify(received(), position, market)).toBe("exact");
    expect(
      classify(received(undefined, { amount: STAKE - 1 }), position, market),
    ).toBe("incorrect amount");
    expect(
      classify(received(undefined, { amount: STAKE + 1 }), position, market),
    ).toBe("incorrect amount");
    expect(
      classify(
        received(undefined, { recipient: "different" }),
        position,
        market,
      ),
    ).toBe("unknown association");
    expect(classify(received("unregistered"), undefined, market)).toBe(
      "unknown association",
    );
    expect(
      classify(received(undefined, { block: block(9) }), position, market),
    ).toBe("late deposit");
  });

  it("rejects wrong wallet, network, stale scan, duplicates and noncanonical block identities", () => {
    const note = received();
    const scan = snapshot(100_000, 8, [note]);
    expect(validateScan(scan, walletId, 100_001, 1_000).get(7)).toBe(
      note.block.hash,
    );
    expect(() => validateScan(scan, "other", 100_001, 1_000)).toThrow(
      "Wrong custody",
    );
    expect(() =>
      validateScan(
        { ...scan, network: "mainnet" } as unknown as Scan,
        walletId,
        100_001,
        1_000,
      ),
    ).toThrow("Wrong custody");
    expect(() => validateScan(scan, walletId, 120_000, 1_000)).toThrow("Stale");
    expect(() =>
      validateScan({ ...scan, scanned: block(7) }, walletId, 100_001, 1_000),
    ).toThrow("incomplete");
    expect(() =>
      validateScan(
        { ...scan, notes: [note, { ...note, commitment: digest("other") }] },
        walletId,
        100_001,
        1_000,
      ),
    ).toThrow("inventory");
    expect(() =>
      validateScan(
        { ...scan, notes: [{ ...note, block: block(7, "fork") }] },
        walletId,
        100_001,
        1_000,
      ),
    ).toThrow("inventory");
  });

  it("produces one exact winner obligation or two independent cancellation refunds", () => {
    const other = {
      ...position,
      _id: "b",
      owner: "owner-b",
      side: "NO" as const,
    };
    const funds = [
      deposit(received(), position._id),
      deposit(received("other"), other._id),
    ];
    expect(settlement(market, funds, [position, other], "YES")).toMatchObject([
      { owner: position.owner, amount: 2_000_000, kind: "payout" },
    ]);
    expect(settlement(market, funds, [position, other], "NO")).toMatchObject([
      { owner: other.owner, amount: 2_000_000 },
    ]);
    expect(settlement(market, funds, [position, other])).toMatchObject([
      { amount: 1_000_000, kind: "refund" },
      { amount: 1_000_000, kind: "refund" },
    ]);
    expect(() =>
      settlement(market, funds.slice(0, 1), [position], "YES"),
    ).toThrow("Opposing");
    expect(() =>
      settlement(market, funds, [position, { ...other, side: "YES" }], "YES"),
    ).toThrow("Opposing");
    expect(() =>
      settlement(
        market,
        [funds[0], { ...funds[0], positionId: other._id }],
        [position, other],
        "YES",
      ),
    ).toThrow("Repeated");
  });

  it("validates exact amounts and will sign only an authenticated fixture plan", async () => {
    const notes = [
      deposit(received(), position._id),
      deposit(received("fee", { role: "fee", amount: 15_000 })),
    ];
    const [refund] = settlement(market, notes.slice(0, 1), [position]);
    const plan: Plan = {
      obligationId: refund._id,
      network: NETWORK,
      walletId,
      inputs: notes.map((n) => n._id),
      recipient: refund.destination,
      amount: STAKE,
      fee: 10_000,
      change: { recipient: change, amount: 5_000 },
    };
    const validate = (p: Plan, funds = notes) =>
      validatePlan(p, refund, funds, walletId, change, 12_000);
    expect(() => validate(plan)).not.toThrow();
    expect(() => validate({ ...plan, recipient: "other" })).toThrow("payment");
    expect(() => validate({ ...plan, fee: 13_000 })).toThrow("fee");
    expect(() =>
      validate({ ...plan, change: { recipient: "other", amount: 5_000 } }),
    ).toThrow("change");
    expect(() =>
      validate({ ...plan, inputs: [notes[0]._id, notes[0]._id] }),
    ).toThrow("inputs");
    expect(() => validate(plan, notes.slice(0, 1))).toThrow("inputs");
    const custody = new FixtureCustody(walletId, recipient, change, token, {
      scan: async () => snapshot(0, 0, []),
      submit: async () => {},
      observe: async () => ({ state: "unknown" }),
    });
    const approval = custody.approve(digest(plan), token);
    await expect(
      custody.sign(plan, { ...approval, receipt: "0".repeat(64) }),
    ).rejects.toThrow("Unapproved");
    await expect(
      custody.sign({ ...plan, recipient: "forged" }, approval),
    ).rejects.toThrow("Unapproved");
    expect(await custody.sign(plan, approval)).toEqual(
      await custody.sign(plan, approval),
    );
  });

  it("fences fixture addresses and independent operator credentials", () => {
    const custody = new FixtureCustody(walletId, recipient, change, token, {
      scan: async () => snapshot(0, 0, []),
      submit: async () => {},
      observe: async () => ({ state: "unknown" }),
    });
    expect(custody.assertOperator(token)).toBe("fixture-operator");
    expect(() => custody.assertOperator("arena-admin")).toThrow(
      "operator authorization",
    );
    expect(() => custody.reviewAddress("utest1example")).toThrow(
      "fixture destination",
    );
  });
});

it("exposes only authenticated and owner-scoped redacted fixture reads", async () => {
  const store = {
    positions: {
      findOne: async ({ _id, owner }: { _id: string; owner: string }) =>
        _id === position._id && owner === position.owner ? position : null,
    },
  } as unknown as TazStore;
  const host = express().use(
    "/api/taz",
    tazReadRouter(store, async (req) => req.get("test-account")),
  );
  vi.stubEnv("ZYRO_TAZ_FIXTURES", "0");
  vi.stubEnv("ZCASH_NETWORK", "testnet");
  const path = "/api/taz/positions/a";
  expect((await request(host).get(path)).status).toBe(404);
  vi.stubEnv("ZYRO_TAZ_FIXTURES", "1");
  expect((await request(host).get(path)).status).toBe(401);
  expect(
    (await request(host).get(path).set("test-account", "other")).status,
  ).toBe(404);
  const result = await request(host)
    .get(path)
    .set("test-account", position.owner);
  expect(result.body).toEqual({
    id: "a",
    marketId: "market",
    side: "YES",
    status: "qualified",
    stake: STAKE,
  });
  expect(
    (
      await request(host).post(path).set("test-account", position.owner).send({
        confirmed: true,
        payoutAuthorized: true,
        payout: "elsewhere",
      })
    ).status,
  ).toBe(404);
  vi.stubEnv("NODE_ENV", "production");
  expect((await request(host).get(path)).status).toBe(404);
});

it("rate-limits the fixture namespace before hitting account storage", async () => {
  vi.stubEnv("ZYRO_TAZ_FIXTURES", "1");
  vi.stubEnv("ZCASH_NETWORK", "testnet");
  const account = vi.fn(async () => undefined);
  const host = express().use(
    "/api/taz",
    tazReadRouter({} as TazStore, account),
  );
  for (let i = 0; i < 60; i++) {
    expect((await request(host).get("/api/taz/markets")).status).toBe(401);
  }
  expect((await request(host).get("/api/taz/markets")).status).toBe(429);
  expect(account).toHaveBeenCalledTimes(60);
});

it("requires a dedicated Mongo database for Testnet TAZ state", async () => {
  const client = new MongoClient("mongodb://127.0.0.1:27187");
  expect(
    () => new TazStore(client, client.db("zyro"), "testnet"),
  ).toThrow("dedicated database");
  expect(
    () => new TazStore(client, client.db("zyro_taz_testnet"), "testnet"),
  ).not.toThrow();
  await client.close();
});
