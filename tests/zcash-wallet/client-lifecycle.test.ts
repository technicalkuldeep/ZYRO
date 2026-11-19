import { afterEach, expect, it, vi } from "vitest";
import { EmbeddedWallet } from "../../apps/web/lib/zcash-wallet/client";
afterEach(() => vi.unstubAllGlobals());
it("locking terminates sync, rejects pending work, and ignores late wallet progress", async () => {
  const instances: any[] = [];
  class WorkerStub {
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("Worker", WorkerStub);
  const progress = vi.fn(),
    stage = vi.fn(),
    wallet = new EmbeddedWallet(progress, stage);
  const instance = instances[0];
  const request = wallet.request("sync");
  const rejected = expect(request).rejects.toThrow("locked");
  const delayed = instance.onmessage;
  wallet.dispose();
  await rejected;
  delayed({ data: { progress: { address: "utest1old" }, stage: "Syncing" } });
  expect(progress).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
  expect(instance.terminate).toHaveBeenCalledOnce();
  await expect(wallet.request("sync")).rejects.toThrow("stopped");
});
