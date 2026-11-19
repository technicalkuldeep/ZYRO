import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let proxy: typeof import("../../apps/web/lib/zcash-wallet/faucet-server").faucetProxy;
const id = "a0620d25-699e-4af1-8a5d-839a598403d9";
const address = "utest1" + "q".repeat(180);
function request(
  body: unknown = { network: "testnet", address, request_id: id },
) {
  return new Request("https://zyro.example/api/zcash/testnet/faucet/claim", {
    method: "POST",
    headers: {
      origin: "https://zyro.example",
      "content-type": "application/json",
      "x-zyro-wallet": "testnet",
    },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  vi.resetModules();
  proxy = (await import("../../apps/web/lib/zcash-wallet/faucet-server"))
    .faucetProxy;
});
afterEach(() => vi.unstubAllGlobals());
describe("isolated Fauzec public proxy", () => {
  it.each(["pending", "broadcasting", "confirmed", "failed"])(
    "preserves authoritative %s without inventing a wallet balance",
    async (state) => {
      const fetcher = vi.fn(async () =>
        Response.json({
          network: "testnet",
          request_id: id,
          state,
          memo: "never disclose",
          balance: 999,
        }),
      );
      const r = await proxy(request(), ["claim"], fetcher);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({
        network: "testnet",
        request_id: id,
        state,
      });
      expect(fetcher.mock.calls).toHaveLength(1);
    },
  );
  it.each([
    "address_on_cooldown",
    "ip_on_cooldown",
    "captcha_required",
    "faucet_dry",
    "wallet_catching_up",
    "submission_ambiguous",
  ])("passes %s without a retry", async (error_code) => {
    const fetcher = vi.fn(async () =>
      Response.json({ error_code, request_id: id }, { status: 409 }),
    );
    const r = await proxy(request(), ["claim"], fetcher);
    expect(r.status).toBe(409);
    expect((await r.json()).error_code).toBe(error_code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { network: "mainnet", address, request_id: id },
    { network: "testnet", address: "u1mainnet", request_id: id },
    {
      network: "testnet",
      address,
      request_id: id,
      seed: "must not reach server",
    },
  ])(
    "rejects network, malformed address, and secret payloads",
    async (body) => {
      const fetcher = vi.fn();
      expect((await proxy(request(body), ["claim"], fetcher)).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin submission and limits repeated address requests", async () => {
    const bad = request();
    bad.headers.set("origin", "https://attacker.example");
    expect((await proxy(bad, ["claim"], vi.fn())).status).toBe(403);
    const fetcher = vi.fn(async () =>
      Response.json({ network: "testnet", request_id: id, state: "pending" }),
    );
    expect((await proxy(request(), ["claim"], fetcher)).status).toBe(200);
    expect((await proxy(request(), ["claim"], fetcher)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("resumes only the original request ID and strips private memo details", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        network: "testnet",
        request_id: id,
        state: "confirmed",
        txid: "a".repeat(64),
        memo: "private",
      }),
    );
    const r = await proxy(
      new Request(`https://zyro.example/api/zcash/testnet/faucet/status/${id}`),
      ["status", id],
      fetcher,
    );
    expect((await r.json()).memo).toBeUndefined();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      `status/testnet/${id}`,
    );
  });
  it("reports timeout as ambiguous without resubmission", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(
      (await (await proxy(request(), ["claim"], fetcher)).json()).error_code,
    ).toBe("submission_ambiguous");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched receipts and upstream mainnet configuration", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        network: "testnet",
        request_id: "wrong",
        state: "pending",
      }),
    );
    expect(
      (await (await proxy(request(), ["claim"], fetcher)).json()).error_code,
    ).toBe("request_identity_mismatch");
    const network = await proxy(
      new Request("https://zyro.example/network"),
      ["network"],
      async () => Response.json({ network: "mainnet" }),
    );
    expect(network.status).toBe(502);
  });
});
