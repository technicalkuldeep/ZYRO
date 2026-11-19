import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeHistory } from "../../apps/web/public/zcash-wallet/history.mjs";
// Mock engine failures to verify authorization/persistence ordering. These tests
// are not evidence of real cryptography, scanning, or testnet spending.
async function harness(options: { sendFails?: boolean; lag?: boolean } = {}) {
  const messages: any[] = [],
    records: any[] = [];
  let scanned = options.lag ? 90 : 100;
  const send = vi.fn(async () => {
    if (options.sendFails) throw Error("transport failed");
    return { status: "success", txIds: ["a".repeat(64)] };
  });
  const wallet = {
    db_to_bytes: async () => new Uint8Array([1]),
    get_wallet_summary: async () => ({
      chain_tip_height: 100,
      fully_scanned_height: scanned,
      account_balances: [
        [
          1,
          {
            sapling_balance: 0,
            orchard_balance: 0,
            ironwood_balance: 2000000,
            spendable_balance: 2000000,
            pending_balance: 0,
          },
        ],
      ],
      free() {},
    }),
    get_transaction_history: async () => [],
    sync_session_setup: async () => {},
    sync_next_batch: async () => {
      if (!options.lag) scanned = 100;
      return false;
    },
    estimate_transfer: async () => ({ feeZats: "10000" }),
    oneclick_transfer: send,
  };
  const context = createContext({
    self: {
      postMessage: (message: unknown) => messages.push(message),
      crossOriginIsolated: true,
      fetch: vi.fn(),
    },
    console: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    Date,
    BigInt,
    engine: {
      parse_unified_address: () => ({ orchard: "shielded" }),
      mnemonic_to_spending_key: () => ({ free() {} }),
    },
    persistMock: async (value: unknown) => {
      records.push(structuredClone(value));
    },
    storage: async () => {},
    encodeBytes: () => "encrypted-db",
    seal: async (_k: unknown, _s: unknown, value: unknown) => {
      records.push(structuredClone(value));
      return {};
    },
    parseAmount: (value: string) =>
      BigInt(value.replace(".", "").padEnd(9, "0")),
    navigator: {},
    normalizeHistory,
  });
  const source = readFileSync(
    "apps/web/public/zcash-wallet/wallet.worker.mjs",
    "utf8",
  )
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, "")
    .replaceAll(
      "import.meta.url",
      "'https://wallet.example/wallet.worker.mjs'",
    );
  runInContext(source + "\ninitialized=Promise.resolve();", context);
  context.fakeWallet = wallet;
  runInContext(
    'wallet=fakeWallet;account=1;key={};salt=new Uint8Array(16);data={address:"utest1test",backedUp:true,phrase:"private test fixture"};lastSync=Date.now();',
    context,
  );
  const request = async (method: string, args: unknown = {}) => {
    const id = webcrypto.randomUUID();
    context.self.onmessage({ data: { id, method, args } });
    await runInContext("queue", context);
    return messages.find((m) => m.id === id);
  };
  return { request, records, send };
}
describe("wallet-specific transaction safety", () => {
  it("persists intent before signing and blocks duplicate sends after an ambiguous broadcast", async () => {
    const h = await harness({ sendFails: true });
    const quote = await h.request("estimate", {
      to: "utest1test",
      amount: "0.01",
      memo: "",
    });
    expect(quote.error).toBeUndefined();
    const sent = await h.request("send", { id: quote.result.id });
    expect(sent.error).toBe("SUBMISSION_UNKNOWN");
    expect(h.records.some((r) => r.submission?.status === "Preparing")).toBe(
      true,
    );
    expect(h.records.at(-1).submission.status).toBe("Submission unknown");
    expect(
      (await h.request("estimate", { to: "utest1test", amount: "0.01" })).error,
    ).toBe("RECONCILE_REQUIRED");
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("requires the exact approved quote and never treats broadcast as confirmation", async () => {
    const h = await harness();
    const quote = await h.request("estimate", {
      to: "utest1test",
      amount: "0.01",
      memo: "",
    });
    expect((await h.request("send", { id: "wrong" })).error).toBe(
      "QUOTE_EXPIRED",
    );
    const sent = await h.request("send", { id: quote.result.id });
    expect(sent.result.submission.status).toBe("Submitted");
    expect(sent.result.synced).toBe(false);
    expect(sent.result.spendable).toBeUndefined();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("keeps synchronization lag distinguishable from a known zero balance", async () => {
    const h = await harness({ lag: true });
    const result = await h.request("sync");
    expect(result.result.synced).toBe(false);
    expect(result.result.tip).not.toBe(result.result.scanned);
    expect(result.result.spendable).toBeUndefined();
  });
});
