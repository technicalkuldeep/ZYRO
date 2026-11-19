import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type * as Engine from "../../apps/web/public/zcash-wallet/engine/zcash_wallet_wasm";
let engine: typeof Engine;
// Published BIP-39 test vector only. Never fund this public fixture.
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
beforeAll(async () => {
  vi.stubGlobal("self", { addEventListener() {}, crypto: globalThis.crypto });
  engine =
    await import("../../apps/web/public/zcash-wallet/engine/zcash_wallet_wasm.js");
  const bytes = readFileSync(
    "apps/web/public/zcash-wallet/engine/zcash_wallet_wasm_bg.wasm",
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "0b83c3963486310a881a1ebdd24d241c0e595496b60aa1b154c853ad47f71a8e",
  );
  engine.initSync({ module: bytes });
}, 30000);
afterAll(() => vi.unstubAllGlobals());
describe("actual pinned Zcash WASM address and network rules", () => {
  it.each([
    [12, "about"],
    [15, "address"],
    [18, "agent"],
    [21, "admit"],
    [24, "art"],
  ])(
    "validates %i-word BIP-39 checksum vectors and rejects corruption",
    (count, finalWord) => {
      // Public all-zero entropy vectors. Never fund these identities.
      const words = [
        ...Array(Number(count) - 1).fill("abandon"),
        String(finalWord),
      ];
      expect(() => engine.validate_mnemonic(words.join(" "))).not.toThrow();
      words[words.length - 1] = "abandon";
      expect(() => engine.validate_mnemonic(words.join(" "))).toThrow();
    },
  );
  it("derives and fully decodes the same testnet account after restoration", () => {
    const a = engine.mnemonic_to_addresses("test", phrase, "", 0);
    const b = engine.mnemonic_to_addresses("test", phrase, "", 0);
    expect(a.unified).toBe(b.unified);
    expect(a.unified.startsWith("utest1")).toBe(true);
    const decoded = engine.parse_unified_address("test", a.unified);
    expect(!!decoded.orchard || !!decoded.sapling).toBe(true);
    expect(() => engine.parse_unified_address("main", a.unified)).toThrow();
    expect(() =>
      engine.parse_unified_address(
        "test",
        a.unified.slice(0, -1) + (a.unified.endsWith("q") ? "p" : "q"),
      ),
    ).toThrow();
  });
  it("rejects invalid phrases with the engine's BIP-39 validator", () => {
    expect(() => engine.validate_mnemonic(phrase)).not.toThrow();
    expect(() =>
      engine.validate_mnemonic("this is not a valid recovery phrase"),
    ).toThrow();
    expect(engine.generate_mnemonic(24).split(" ")).toHaveLength(24);
  });
  it("contains current testnet Ironwood activation and shielded transaction APIs", () => {
    const wallet = new engine.WebWallet(
      "test",
      "https://zcash-wallet-grpc-testnet.deltarpc.com",
    );
    expect(wallet.get_ironwood_activation_height()).toBe(4134000);
    expect(typeof wallet.estimate_transfer).toBe("function");
    expect(typeof wallet.oneclick_transfer).toBe("function");
    expect(typeof wallet.sync_next_batch).toBe("function");
    wallet.free();
  });
});
