import { describe, it, expect, vi } from "vitest";
import { observeTransaction, rpcClient } from "../apps/api/src/zcash";
const txid = "a".repeat(64);
describe("testnet chain observation", () => {
  it("refuses mainnet before looking up a transaction", async () => {
    const rpc = vi.fn().mockResolvedValue({ chain: "main" });
    await expect(observeTransaction(txid, rpc)).rejects.toThrow("Mainnet");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    [0, "MEMPOOL"],
    [1, "CONFIRMING"],
    [3, "CONFIRMED"],
    [-1, "CONFLICTED"],
  ])(
    "maps %i confirmations to %s without claiming funding",
    async (n, state) => {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ chain: "test" })
        .mockResolvedValueOnce({ txid, confirmations: n });
      expect(await observeTransaction(txid, rpc)).toMatchObject({
        state,
        fundingVerified: false,
      });
    },
  );
  it("rejects invalid IDs, mismatched responses and missing configuration", async () => {
    await expect(observeTransaction("invalid")).rejects.toThrow();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ chain: "test" })
      .mockResolvedValueOnce({ txid: "b".repeat(64) });
    await expect(observeTransaction(txid, rpc)).rejects.toThrow("different");
    await expect(rpcClient("")("getblockchaininfo", [])).rejects.toThrow(
      "not configured",
    );
  });
  it("does not cache chain confirmation so reorgs downgrade status", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ chain: "test" })
      .mockResolvedValueOnce({ txid, confirmations: 3 })
      .mockResolvedValueOnce({ chain: "test" })
      .mockResolvedValueOnce({ txid, confirmations: 0 });
    expect((await observeTransaction(txid, rpc)).state).toBe("CONFIRMED");
    expect((await observeTransaction(txid, rpc)).state).toBe("MEMPOOL");
  });
});
