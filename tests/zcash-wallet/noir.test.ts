import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverNoir, readNoir } from "../../apps/web/lib/zcash-wallet/noir";
afterEach(() => vi.unstubAllGlobals());
function injected(
  options: {
    locked?: boolean;
    wrongNetwork?: boolean;
    synced?: boolean;
    rejected?: boolean;
  } = {},
) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (options.rejected) throw Error("User rejected connection");
    if (method === "zcash_getAccounts" && options.locked) return null;
    if (method === "zcash_getBalance")
      return {
        shielded: "2",
        transparent: "0",
        spendable: "1.00000001",
        accounts: [{ id: "account", synced: options.synced !== false }],
      };
    return {
      shielded: options.wrongNetwork ? "u1wrong" : "utest1authorized",
      transparent: "test",
      accounts: [
        {
          id: "account",
          addresses: {
            shielded: options.wrongNetwork ? "u1wrong" : "utest1authorized",
            transparent: "test",
          },
        },
      ],
    };
  });
  vi.stubGlobal("window", {
    noirwallet: {
      isNoirWallet: true,
      version: "1.0.27",
      zcash: { request, on: vi.fn(), removeListener: vi.fn() },
    },
  });
  return request;
}
const validate = async (address: string) => {
  if (!address.startsWith("utest1")) throw Error("Wrong network");
};
describe("official Noir SDK adapter", () => {
  it("detects unavailable provider without requesting authorization", () => {
    vi.stubGlobal("window", {});
    expect(discoverNoir()).toBeNull();
  });
  it("requests approval only through connect and keeps unknown confirmed balance unknown", async () => {
    const request = injected();
    const result = await readNoir(discoverNoir()!, true, validate);
    expect(request.mock.calls[0][0].method).toBe("zcash_requestAccounts");
    expect(result?.spendable).toBe("100000001");
    expect(result?.confirmed).toBeUndefined();
  });
  it("handles locked/disconnected accounts", async () => {
    injected({ locked: true });
    expect(await readNoir(discoverNoir()!, false, validate)).toBeNull();
  });
  it("does not use the provider's unsynced zero fallback", async () => {
    injected({ synced: false });
    expect(
      (await readNoir(discoverNoir()!, false, validate))?.spendable,
    ).toBeUndefined();
  });
  it("rejects wrong network", async () => {
    injected({ wrongNetwork: true });
    await expect(readNoir(discoverNoir()!, true, validate)).rejects.toThrow(
      "Wrong network",
    );
  });
  it("handles rejected approval", async () => {
    injected({ rejected: true });
    await expect(readNoir(discoverNoir()!, true, validate)).rejects.toThrow(
      "rejected",
    );
  });
  it("refreshes authorization instead of trusting cached account-change payloads", async () => {
    const request = injected();
    await readNoir(discoverNoir()!, false, validate);
    await readNoir(discoverNoir()!, false, validate);
    expect(
      request.mock.calls.filter((c) => c[0].method === "zcash_getAccounts"),
    ).toHaveLength(2);
  });
});
