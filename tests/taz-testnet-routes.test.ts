import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Market, Obligation, Position } from "../apps/api/src/taz-markets/model.js";
import { testnetTazReadRouter } from "../apps/api/src/taz-markets/testnet-routes.js";
import type { TazStore } from "../apps/api/src/taz-markets/store.js";

const market: Market = {
  _id: "testnet-market-1",
  rules: {
    version: 1,
    network: "testnet",
    pair: "BTC-USD",
    provider: "Coinbase Exchange",
    comparison: "GT",
    equality: "NO",
    candleStart: 1_900_000_020,
    thresholdUnits: "1000000000000",
    stake: 1_000_000,
    closesAt: 1_900_000_000_000,
    cutoffGraceMs: 30_000,
    confirmations: 3,
  },
  rulesHash: "a".repeat(64),
  status: "open",
};

function fakeStore() {
  const row: Position = {
    _id: "position-1",
    owner: "participant-a",
    marketId: market._id,
    side: "YES",
    rulesHash: market.rulesHash,
    network: "testnet",
    stake: 1_000_000,
    recipient: "utest1receiver",
    association: "wallet-decrypted-memo",
    memo: "zyro-taz-v1:" + "b".repeat(64),
    payout: "utest1payout",
    refund: "utest1refund",
    createdAt: 1,
    closesAt: market.rules.closesAt,
    requestId: "request-1",
    addressReviewer: "reviewer",
    status: "qualified",
  };
  const obligation: Obligation = {
    _id: "obligation-1",
    kind: "payout",
    marketId: market._id,
    owner: row.owner,
    destination: row.payout,
    amount: 1_000_000,
    sources: ["note"],
    status: "confirmed",
    signed: { txid: "c".repeat(64), artifact: "must-not-be-returned" },
  };
  const positions = {
    find(filter: { owner?: string }) {
      const rows = filter.owner ? [row].filter((p) => p.owner === filter.owner) : [row];
      return {
        sort() { return this; },
        limit() { return this; },
        async toArray() { return rows; },
      };
    },
  };
  const store = {
    scope: "testnet",
    controls: { async findOne() { return { _id: "testnet", paused: true }; } },
    markets: {
      find() {
        return {
          sort() { return this; },
          limit() { return this; },
          async toArray() { return [market]; },
        };
      },
      async findOne({ _id }: { _id: string }) { return _id === market._id ? market : null; },
    },
    positions,
    obligations: {
      find(filter: { owner?: string }) {
        return {
          sort() { return this; },
          limit() { return this; },
          async toArray() { return filter.owner === row.owner ? [obligation] : []; },
        };
      },
    },
  } as unknown as TazStore;
  return store;
}

function app(owner?: string) {
  const server = express();
  server.use("/api/testnet/taz", testnetTazReadRouter(fakeStore(), async () => owner));
  return server;
}

describe("dedicated Testnet TAZ read API", () => {
  it("refuses a fixture or Regtest ledger instance", async () => {
    const fixtureStore = { ...fakeStore(), scope: "fixture" } as unknown as TazStore;
    expect(() => testnetTazReadRouter(fixtureStore, async () => "owner")).toThrow(
      "Testnet API requires the isolated Testnet ledger scope",
    );
  });

  it("requires a participant session", async () => {
    const response = await request(app()).get("/api/testnet/taz/readiness");
    expect(response.status).toBe(401);
  });

  it("reports Testnet ledger state while keeping funding and payouts disabled", async () => {
    const response = await request(app("participant-a")).get("/api/testnet/taz/readiness");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      network: "testnet",
      ledger: "connected",
      paused: true,
      fundingEnabled: false,
      payoutEnabled: false,
    });
  });

  it("returns only records from the injected Testnet store", async () => {
    const response = await request(app("participant-a")).get("/api/testnet/taz/markets");
    expect(response.status).toBe(200);
    expect(response.body.network).toBe("testnet");
    expect(response.body.markets).toHaveLength(1);
    expect(response.body.markets[0]).toMatchObject({
      id: market._id,
      simulated: false,
      confirmedPositions: 1,
      prizePoolZatoshis: "1000000",
    });
  });

  it("scopes history to the session and never exposes signed artifacts or destinations", async () => {
    const response = await request(app("participant-a")).get("/api/testnet/taz/history");
    expect(response.status).toBe(200);
    expect(response.body.positions).toHaveLength(1);
    expect(response.body.settlements).toEqual([
      expect.objectContaining({ id: "obligation-1", txid: "c".repeat(64) }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain("must-not-be-returned");
    expect(JSON.stringify(response.body)).not.toContain("utest1payout");
  });

  it("rejects any mutation with a fail-closed response", async () => {
    const response = await request(app("participant-a")).post("/api/testnet/taz/intents");
    expect(response.status).toBe(503);
    expect(response.body.readiness.fundingEnabled).toBe(false);
  });
});
