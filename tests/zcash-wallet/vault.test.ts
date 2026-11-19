import { describe, expect, it } from "vitest";
import {
  deriveKey,
  seal,
  unseal,
  parseAmount,
  formatAmount,
  encodeBytes,
  decodeBytes,
} from "../../apps/web/public/zcash-wallet/vault.mjs";
describe("wallet vault cryptography and exact amounts", () => {
  it("encrypts secrets, authenticates ciphertext and rejects incorrect passwords", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey("correct-test-password", salt);
    expect(key.extractable).toBe(false);
    const data = {
      phrase: "unit test secret phrase",
      db: "unit test private notes",
      network: "test",
    };
    const sealed = await seal(key, salt, data);
    expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain(
      data.phrase,
    );
    expect((await unseal("correct-test-password", sealed)).data).toEqual(data);
    await expect(unseal("incorrect-test-password", sealed)).rejects.toThrow();
    const altered = { ...sealed, ciphertext: sealed.ciphertext.slice(0) };
    new Uint8Array(altered.ciphertext)[0] ^= 1;
    await expect(unseal("correct-test-password", altered)).rejects.toThrow();
    await expect(
      unseal("correct-test-password", { ...sealed, version: 2 }),
    ).rejects.toThrow();
  });
  it("uses independent IVs for each persisted checkpoint", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey("correct-test-password", salt);
    const a = await seal(key, salt, { seed: "test" }),
      b = await seal(key, salt, { seed: "test" });
    expect(a.iv).not.toEqual(b.iv);
    expect(Array.from(new Uint8Array(a.ciphertext))).not.toEqual(
      Array.from(new Uint8Array(b.ciphertext)),
    );
    await expect(deriveKey("short", salt)).rejects.toThrow();
  });
  it.each(["0", "-1", "0.000000001", "NaN", "1e2", "1,000", "01", "21000001"])(
    "rejects invalid payment %s",
    (amount) => expect(() => parseAmount(amount)).toThrow(),
  );
  it("accounts in zatoshis without floating point loss", () => {
    expect(parseAmount("0.00000001")).toBe(1n);
    expect(parseAmount("0.01")).toBe(1000000n);
    expect(formatAmount(1000001n)).toBe("0.01000001");
    expect(formatAmount(-1n)).toBe("-0.00000001");
    expect(formatAmount(undefined)).toBe("—");
    const bytes = crypto.getRandomValues(new Uint8Array(20000));
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
  });
});
