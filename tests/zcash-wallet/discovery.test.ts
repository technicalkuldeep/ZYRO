import { afterEach, describe, expect, it, vi } from "vitest";
import {
  waitForNoir,
  supportedNoirVersion,
  noirErrorStatus,
  noirLocalhostUrl,
} from "../../apps/web/lib/zcash-wallet/noir";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function browser() {
  const target = Object.assign(new EventTarget(), {
    location: new URL("http://127.0.0.1:3000/wallet/testnet"),
    noirwallet: undefined as unknown,
  });
  vi.stubGlobal("window", target);
  return target;
}
describe("bounded browser-only Noir discovery", () => {
  it("does not access a provider during SSR", async () => {
    vi.stubGlobal("window", undefined);
    expect(await waitForNoir()).toBeNull();
  });
  it("waits for real injection notification without requesting authorization", async () => {
    vi.useFakeTimers();
    const target = browser();
    const result = waitForNoir();
    target.noirwallet = {
      isNoirWallet: true,
      version: "1.0.41",
      zcash: { request: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
    };
    target.dispatchEvent(new Event("noirwallet#initialized"));
    expect(await result).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("also recognizes delayed injection without notification", async () => {
    vi.useFakeTimers();
    const target = browser();
    const result = waitForNoir();
    target.noirwallet = {
      isNoirWallet: true,
      version: "2.0.0",
      zcash: { request: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
    };
    await vi.advanceTimersByTimeAsync(150);
    expect(await result).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops searching when disposed", async () => {
    vi.useFakeTimers();
    browser();
    const abort = new AbortController();
    const result = waitForNoir(abort.signal);
    abort.abort();
    expect(await result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops absent-provider polling after its deadline", async () => {
    vi.useFakeTimers();
    browser();
    const result = waitForNoir(undefined, 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("provides an explicit localhost alternative without copying wallet storage", () => {
    browser();
    expect(noirLocalhostUrl()).toBe("http://localhost:3000/wallet/testnet");
  });
  it("gates versions with explicit shielded funding support", () => {
    for (const version of ["1.0.27", "1.0.41", "2.0.0"])
      expect(supportedNoirVersion(version)).toBe(true);
    for (const version of [undefined, "1.0.26", "0.9.1", "3.0.0", "unknown"])
      expect(supportedNoirVersion(version)).toBe(false);
  });
  it("distinguishes rejection, locking, network, authorization and incompatible methods", () => {
    expect(noirErrorStatus({ code: 4001 })).toBe("rejected");
    expect(noirErrorStatus({ code: 4100 })).toBe("unauthorized");
    expect(noirErrorStatus({ code: 4200 })).toBe("unsupported");
    expect(noirErrorStatus(Error("Wallet locked"))).toBe("locked");
    expect(noirErrorStatus(Error("Wrong network"))).toBe("wrong-network");
  });
});
