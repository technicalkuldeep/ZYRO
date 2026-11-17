import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolutionMessage, type Market, type Resolution } from "@zyro/shared";
import { Store } from "../apps/api/src/store";
import { Engine } from "../apps/api/src/engine";
import { recordOutcome } from "../apps/api/src/resolution";
let store: Store, m: Market;
beforeEach(async () => {
  vi.useFakeTimers();
  store = new Store(":memory:", "");
  const engine = new Engine(store);
  m = await engine.create("alice", {
    question: "Will a verifiable source report the specified result?",
    description:
      "A precise test challenge whose outcome is attested by a configured trusted oracle.",
    category: "Zcash",
    stake: 100000,
    fundingDeadline: new Date(Date.now() + 1000).toISOString(),
    resolutionDeadline: new Date(Date.now() + 2000).toISOString(),
    source: "https://z.cash/",
    rules:
      "YES on a published official announcement, otherwise NO at the deadline.",
  });
  m.status = "MATCHED";
  m.participants = [
    {
      userId: "alice",
      side: "YES",
      publicKey: "fixture",
      signature: "fixture",
    },
    {
      userId: "bob",
      side: "NO",
      publicKey: "fixture-b",
      signature: "fixture-b",
    },
  ];
  await store.put(m.id, "market", m);
});
afterEach(async () => {
  vi.useRealTimers();
  await store.close();
});
function oracle() {
  const keys = generateKeyPairSync("ed25519");
  const value: Resolution = {
    marketId: m.id,
    agreementHash: m.agreementHash,
    outcome: "YES",
    evidenceUrl: m.source,
    evidenceHash: "a".repeat(64),
    observedAt: new Date().toISOString(),
  };
  return {
    value,
    key: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    signature: (v: Resolution) =>
      sign(null, Buffer.from(resolutionMessage(v)), keys.privateKey).toString(
        "base64",
      ),
  };
}
it("records a signed outcome and prevents duplicate resolution", async () => {
  vi.advanceTimersByTime(3000);
  const o = oracle();
  expect(
    (await recordOutcome(store, o.value, o.signature(o.value), o.key)).status,
  ).toBe("RESOLVED");
  expect(await store.get(m.id + ":resolution")).toBeDefined();
  await expect(
    recordOutcome(store, o.value, o.signature(o.value), o.key),
  ).rejects.toThrow("already");
});
it("rejects forged evidence, wrong terms, early observations and unconfigured oracle", async () => {
  const o = oracle();
  await expect(
    recordOutcome(store, o.value, o.signature(o.value), o.key),
  ).rejects.toThrow("window");
  vi.advanceTimersByTime(3000);
  o.value.observedAt = new Date().toISOString();
  await expect(recordOutcome(store, o.value, "bad", o.key)).rejects.toThrow(
    "signature",
  );
  const wrong = { ...o.value, evidenceUrl: "https://example.com/" };
  await expect(
    recordOutcome(store, wrong, o.signature(wrong), o.key),
  ).rejects.toThrow("terms");
  await expect(
    recordOutcome(store, o.value, o.signature(o.value), ""),
  ).rejects.toThrow("not configured");
});
