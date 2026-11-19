import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  replies: {} as Record<string, any>,
  close: vi.fn(),
}));
vi.mock("@grpc/grpc-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grpc/grpc-js")>();
  class Client {
    close = mock.close;
    constructor() {
      for (const method of [
        "getLightdInfo",
        "getTransaction",
        "getLatestBlock",
        "getBlock",
      ]) {
        (this as any)[method] = (
          _payload: unknown,
          _options: unknown,
          done: (error: unknown, result?: unknown) => void,
        ) => {
          const reply = mock.replies[method];
          if (reply instanceof Error) done(reply);
          else done(null, reply);
        };
      }
    }
  }
  return {
    ...actual,
    loadPackageDefinition: () => ({
      cash: { z: { wallet: { sdk: { rpc: { CompactTxStreamer: Client } } } } },
    }),
  };
});
import { observeWalletTransaction } from "../../apps/web/lib/zcash-wallet/transaction-status";
const txid = "12".repeat(32);
beforeEach(() => {
  mock.close.mockClear();
  mock.replies = {
    getLightdInfo: { chainName: "test" },
    getTransaction: { height: "100" },
    getLatestBlock: { height: "105" },
    getBlock: {
      height: "100",
      vtx: [{ txid: Buffer.from(txid, "hex").reverse() }],
    },
  };
});
describe("public testnet transaction observation", () => {
  it("requires actual block inclusion and counts confirmations separately from submission", async () => {
    expect(await observeWalletTransaction(txid)).toMatchObject({
      state: "confirmed",
      confirmations: 6,
      minedHeight: 100,
      chainHeight: 105,
    });
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it("keeps unmined transactions pending", async () => {
    mock.replies.getTransaction.height = "0";
    expect(await observeWalletTransaction(txid)).toMatchObject({
      state: "pending",
      confirmations: 0,
    });
  });
  it("handles a transaction absent from the provider without inventing failure or success", async () => {
    mock.replies.getTransaction = Object.assign(Error("not found"), {
      code: 5,
    });
    expect(await observeWalletTransaction(txid)).toMatchObject({
      state: "not-found",
      confirmations: 0,
    });
  });
  it("rejects mainnet services and closes the connection", async () => {
    mock.replies.getLightdInfo.chainName = "main";
    await expect(observeWalletTransaction(txid)).rejects.toThrow("identity");
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it("does not retain a confirmation when a reorganization removes inclusion", async () => {
    mock.replies.getBlock.vtx = [];
    await expect(observeWalletTransaction(txid)).rejects.toThrow("inclusion");
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it("rejects malformed identifiers before opening a channel", async () => {
    await expect(observeWalletTransaction("not-a-txid")).rejects.toThrow(
      "Invalid",
    );
    expect(mock.close).not.toHaveBeenCalled();
  });
});
