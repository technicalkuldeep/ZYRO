import { afterEach, expect, it, vi } from "vitest";
import { submitClaim, claimKey } from "../../apps/web/lib/zcash-wallet/faucet";
afterEach(() => vi.unstubAllGlobals());
it("persists an idempotent request ID before submission and never creates another after timeout", async () => {
  const records = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => records.get(key),
    setItem: (key: string, value: string) => records.set(key, value),
  });
  let postedId = "";
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    postedId = body.request_id;
    expect(JSON.parse(records.get(claimKey("utest1fixture"))!).request_id).toBe(
      postedId,
    );
    expect(Object.keys(body).sort()).toEqual([
      "address",
      "network",
      "request_id",
    ]);
    expect(init.credentials).toBe("omit");
    throw Error("timeout");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(submitClaim("utest1fixture", () => {})).rejects.toThrow(
    "timeout",
  );
  expect(postedId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(submitClaim("utest1fixture", () => {})).rejects.toThrow(
    "earlier faucet request",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(records.get(claimKey("utest1fixture"))!).request_id).toBe(
    postedId,
  );
});
