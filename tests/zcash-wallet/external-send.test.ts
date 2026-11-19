import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  quoteNoirPayment,
  sendNoirPayment,
  restoredExternalSubmission,
} from "../../apps/web/lib/zcash-wallet/external-send";
import type { discoverNoir } from "../../apps/web/lib/zcash-wallet/noir";
import type { WalletState } from "../../apps/web/lib/zcash-wallet/client";
const address = "utest1testfixture",
  txid = "b".repeat(64);
const state: WalletState = {
  kind: "noir",
  address,
  synced: true,
  spendable: "100000000",
  history: [],
};
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => unknown,
      ) => callback({}),
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
function provider() {
  const zcash = {
    getMaxTransfer: vi.fn(async () => ({ maxAmount: "0.9999", fee: "0.0001" })),
    getAccounts: vi.fn(async () => ({ shielded: address })),
    sendTransaction: vi.fn(async () => txid),
  };
  return {
    wallet: { version: "1.0.41", zcash } as unknown as NonNullable<
      ReturnType<typeof discoverNoir>
    >,
    zcash,
  };
}
describe("Noir shielded fixed-amount payments", () => {
  it("forwards the approved fixed amount instead of replacing it with Send Max", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    expect(quote.feeSource).toBe("noir-approval");
    expect(await sendNoirPayment(wallet, address, quote)).toBe(txid);
    expect(zcash.sendTransaction).toHaveBeenCalledWith({
      to: address,
      amount: "0.01000000",
      memo: "",
      fundingSource: "shielded",
    });
    expect(restoredExternalSubmission(address)?.txids).toEqual([txid]);
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "reconciliation",
    );
    expect(zcash.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("retains exact maximum quotes", async () => {
    const { wallet } = provider();
    expect(
      (await quoteNoirPayment(wallet, state, address, "0.9999", "")).feeSource,
    ).toBe("exact");
  });
  it("supports an explicit Send Max action without changing fixed payments", async () => {
    const { wallet } = provider();
    expect(
      (await quoteNoirPayment(wallet, state, address, "max", "")).amount,
    ).toBe("99990000");
  });
  it("reconciles legacy receipts which did not record a timestamp", () => {
    storage.set(
      `zyro:testnet:noir-send:${address}`,
      JSON.stringify({ status: "Submitted", txid }),
    );
    expect(restoredExternalSubmission(address)).toMatchObject({
      status: "Submitted",
      txids: [txid],
      at: 0,
    });
  });
  it("recognizes V1 explicit rejection even when its bridge omits a numeric code", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    zcash.sendTransaction.mockRejectedValueOnce(
      Error("User rejected the transaction"),
    );
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "User rejected",
    );
    expect(restoredExternalSubmission(address)).toBeUndefined();
  });
  it("prevents a simultaneous authorization in another tab", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: null) => unknown,
        ) => callback(null),
      },
    });
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "Another tab",
    );
    expect(zcash.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects insufficient funds including the fee", async () => {
    const { wallet } = provider();
    await expect(
      quoteNoirPayment(wallet, state, address, "1", ""),
    ).rejects.toThrow("fee");
  });
  it("clears an explicit rejection but retains ambiguous submissions", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    zcash.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toEqual({
      code: 4001,
    });
    expect(restoredExternalSubmission(address)).toBeUndefined();
    zcash.sendTransaction.mockRejectedValueOnce(Error("timeout"));
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "timeout",
    );
    expect(restoredExternalSubmission(address)?.status).toBe(
      "Submission unknown",
    );
  });
  it("rejects stale account authorization before requesting signing", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    zcash.getAccounts.mockResolvedValueOnce({ shielded: "utest1another" });
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "account changed",
    );
    expect(zcash.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects an expired review before signing", async () => {
    const { wallet, zcash } = provider(),
      quote = await quoteNoirPayment(wallet, state, address, "0.01", "");
    quote.expires = 0;
    await expect(sendNoirPayment(wallet, address, quote)).rejects.toThrow(
      "expired",
    );
    expect(zcash.sendTransaction).not.toHaveBeenCalled();
  });
});
