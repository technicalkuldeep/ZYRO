import { afterEach, describe, it, expect, vi } from "vitest";
import { rpcClient, chainStatus, assertNetwork } from "../apps/api/src/zcash";
import { TransactionMonitor } from "../apps/api/src/transaction-monitor";
import { Store } from "../apps/api/src/store";
const txid = "a".repeat(64);
afterEach(() => vi.unstubAllEnvs());
describe("RPC transport and network boundary", () => {
  it("retries transient failures and matches JSON-RPC IDs", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("secret endpoint must not leak"))
      .mockImplementationOnce(async (_url, init) => {
        const b = JSON.parse(init.body);
        return new Response(
          JSON.stringify({ id: b.id, result: { chain: "test" } }),
        );
      });
    const rpc = rpcClient("http://127.0.0.1:18232", {
      fetch: transport,
      retryDelayMs: 0,
    });
    expect(await rpc("getblockchaininfo", [])).toEqual({ chain: "test" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("bounds connection retries and redacts low-level errors", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("password=secret"));
    await expect(
      rpcClient("http://localhost", {
        fetch: transport,
        attempts: 2,
        retryDelayMs: 0,
      })("getblockchaininfo", []),
    ).rejects.toThrow("Node connection failed");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed/mismatched responses, URL credentials and write RPC methods", async () => {
    for (const body of [{ id: "wrong", result: {} }, {}])
      await expect(
        rpcClient("http://localhost", {
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
        })("getblockchaininfo", []),
      ).rejects.toThrow("invalid RPC");
    await expect(
      rpcClient("http://user:secret@localhost")("getblockchaininfo", []),
    ).rejects.toThrow("Invalid RPC URL");
    await expect(
      rpcClient("http://localhost")("sendrawtransaction", []),
    ).rejects.toThrow("not permitted");
  });
  it("distinguishes missing transactions from node errors without retrying invalid IDs", async () => {
    const transport = vi
      .fn()
      .mockImplementation(
        async (_url, init) =>
          new Response(
            JSON.stringify({
              id: JSON.parse(init.body).id,
              error: { code: -5, message: "raw message not exposed" },
            }),
            { status: 500 },
          ),
      );
    await expect(
      rpcClient("http://localhost", { fetch: transport })("getrawtransaction", [
        txid,
        1,
      ]),
    ).rejects.toMatchObject({ status: 404 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("returns live height and fails closed on network mismatch and unknown chains", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        chain: "test",
        blocks: 123,
        headers: 124,
        verificationprogress: 0.9,
      })
      .mockResolvedValueOnce({ version: 1, subversion: "/fixture/" });
    expect(await chainStatus(rpc)).toMatchObject({
      height: 123,
      network: "testnet",
      syncComplete: null,
    });
    await expect(
      assertNetwork(vi.fn().mockResolvedValue({ chain: "regtest" }), "testnet"),
    ).rejects.toThrow("does not match");
    await expect(
      assertNetwork(vi.fn().mockResolvedValue({ chain: "unknown" })),
    ).rejects.toThrow("does not match");
  });
  it("requires a pinned genesis when Zebra labels regtest as test", async () => {
    await expect(
      assertNetwork(vi.fn().mockResolvedValue({ chain: "test" }), "regtest"),
    ).rejects.toThrow("does not match");
    vi.stubEnv("ZCASH_GENESIS_HASH", "b".repeat(64));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ chain: "test" })
      .mockResolvedValueOnce("b".repeat(64));
    expect((await assertNetwork(rpc, "regtest")).network).toBe("regtest");
  });
  it("preserves last successful observation and records failed refresh separately", async () => {
    const store = new Store(":memory:", "");
    try {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ chain: "test" })
        .mockResolvedValueOnce({ txid, confirmations: 3 })
        .mockRejectedValueOnce(new Error("offline"));
      const monitor = new TransactionMonitor(store, rpc);
      const first = await monitor.refresh("alice", txid);
      await expect(monitor.refresh("alice", txid)).rejects.toThrow();
      const [record] = await monitor.list("alice");
      expect(record.checkedAt).toBe(first.checkedAt);
      expect(record.lastError).toBeTruthy();
      expect(await monitor.list("bob")).toEqual([]);
      expect((await store.list("transaction")).length).toBe(1);
    } finally {
      await store.close();
    }
  });
});
