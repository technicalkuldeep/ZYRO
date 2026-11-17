import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { Market } from "@zyro/shared";
import { Store } from "../apps/api/src/store";
import { Engine } from "../apps/api/src/engine";
import {
  FundingService,
  type FundingIntent,
  type RecognizedNote,
} from "../apps/api/src/funding";
let store: Store, m: Market;
const txid = "c".repeat(64);
beforeEach(async () => {
  store = new Store(":memory:", "");
  const engine = new Engine(store);
  m = await engine.create("alice", {
    question: "Will a verified shielded note fund the challenge?",
    description:
      "A fixture market for independent funding-policy validation, not a real on-chain deposit.",
    category: "Zcash",
    stake: 10000000,
    fundingDeadline: new Date(Date.now() + 60000).toISOString(),
    resolutionDeadline: new Date(Date.now() + 120000).toISOString(),
    source: "https://z.cash/",
    rules: "YES if the published official result is YES; otherwise NO.",
  });
  m.status = "MATCHED";
  m.participants = [
    {
      userId: "alice",
      side: "YES",
      publicKey: "fixture-a",
      signature: "fixture-a",
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
async function setup(amount = 10000000, confirmations = 3) {
  const basic = new FundingService(store);
  const intent = await basic.claim("alice", m.id, txid);
  intent.recipient = "fixture-wallet-recipient";
  await store.put(intent.id, "funding-intent", intent);
  const note: RecognizedNote = {
    txid,
    network: "testnet",
    pool: "orchard",
    outputIndex: 0,
    amountZatoshis: amount,
    recipient: intent.recipient,
    memo: intent.reference,
  };
  const rpc = vi
    .fn()
    .mockImplementation(async (method) =>
      method === "getblockchaininfo"
        ? { chain: "test" }
        : { txid, confirmations },
    );
  const service = new FundingService(store, rpc, async () => note);
  return { service, note, intent, rpc };
}
it("creates idempotent private funding references and never trusts a submitted txid", async () => {
  const service = new FundingService(store);
  const intents = await Promise.all([
    service.intent("alice", m.id),
    service.intent("alice", m.id),
  ]);
  expect(intents[0]).toEqual(intents[1]);
  expect(intents[0].recipient).toBeNull();
  expect((await service.claim("alice", m.id, txid)).state).toBe(
    "SUBMITTED_UNVERIFIED",
  );
  await expect(service.verify("alice", m.id)).rejects.toThrow("not configured");
  expect((await service.summary("alice", m.id)).settlementEligible).toBe(false);
  await expect(service.intent("eve", m.id)).rejects.toMatchObject({
    status: 403,
  });
});
it.each([
  [9999999, 3, "INSUFFICIENT"],
  [10000001, 3, "EXCESS"],
  [10000000, 0, "PENDING"],
  [10000000, 3, "CONFIRMED"],
  [10000000, -1, "CONFLICTED"],
])(
  "checks integer amount %i and %i confirmations",
  async (amount, confirmations, state) => {
    const { service } = await setup(amount as number, confirmations as number);
    expect((await service.verify("alice", m.id)).state).toBe(state);
    await service.verify("alice", m.id);
    expect((await store.list("funding-output")).length).toBe(1);
  },
);
it("rejects wrong recipient, reference, network and unsafe amounts from the receipt source", async () => {
  for (const change of [
    { recipient: "wrong" },
    { memo: "wrong" },
    { network: "regtest" },
    { amountZatoshis: 1.1 },
  ]) {
    const { service, note } = await setup();
    Object.assign(note, change);
    await expect(service.verify("alice", m.id)).rejects.toThrow();
  }
});
it("does not reuse a shielded output for a second intent even with a conflicting wallet assertion", async () => {
  const { service, note } = await setup();
  await service.verify("alice", m.id);
  const other = await service.claim("bob", m.id, txid);
  other.recipient = "fixture-wallet-recipient";
  await store.put(other.id, "funding-intent", other);
  note.memo = other.reference;
  await expect(service.verify("bob", m.id)).rejects.toThrow(
    "already associated",
  );
});
it("tracks reorg downgrades and marks late deposits for operator-dependent refunds", async () => {
  const { service, rpc } = await setup();
  await service.verify("alice", m.id);
  rpc.mockImplementation(async (method) =>
    method === "getblockchaininfo"
      ? { chain: "test" }
      : { txid, confirmations: 0 },
  );
  expect((await service.verify("alice", m.id)).state).toBe("PENDING");
  rpc.mockImplementation(async (method) =>
    method === "getblockchaininfo"
      ? { chain: "test" }
      : { txid, confirmations: 3 },
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 61000);
  expect((await service.verify("alice", m.id)).state).toBe("REFUND_REQUIRED");
  await expect(service.intent("bob", m.id)).rejects.toThrow("not accepting");
});
it("does not turn a timely confirmed deposit into a late refund merely because time passes", async () => {
  const { service } = await setup();
  const first = await service.verify("alice", m.id);
  expect(first.confirmedBeforeDeadlineAt).toBeTruthy();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 61000);
  expect((await service.verify("alice", m.id)).state).toBe("CONFIRMED");
  m.status = "CANCELLED";
  await store.put(m.id, "market", m);
  expect((await service.verify("alice", m.id)).state).toBe("REFUND_REQUIRED");
});
it("ignores client attempts to supply receipt fields at the API boundary", async () => {
  const { createApp } = await import("../apps/api/src/app");
  const request = (await import("supertest")).default;
  const app = createApp(store).app;
  await request(app)
    .post("/api/markets/" + m.id + "/funding-claim")
    .set("Origin", "http://127.0.0.1:3000")
    .set("X-Zyro-Client", "web")
    .send({ txid, amountZatoshis: 10000000, confirmed: true })
    .expect(400);
});
// All recognized notes above are labeled test fixtures. No funded market is claimed in live evidence.
export type FundingFixture = FundingIntent;
