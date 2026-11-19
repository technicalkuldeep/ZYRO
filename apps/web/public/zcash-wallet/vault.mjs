/* global TextEncoder, TextDecoder, crypto, indexedDB, btoa, atob */
// Wallet-only storage. No plaintext mnemonic, database, password, or private key
// is written to storage. CryptoKeys are non-extractable and live in the worker.
const aad = new TextEncoder().encode("ZYRO/zcash/testnet/vault/v1");
export const ITERATIONS = 600000;
export function parseAmount(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(value)
  )
    throw Error("Invalid amount");
  const [whole, fraction = ""] = value.split(".");
  const zats = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (zats <= 0n || zats > 2100000000000000n) throw Error("Invalid amount");
  return zats;
}
export function formatAmount(value) {
  if (value === undefined || value === null) return "\u2014";
  const n = BigInt(value),
    sign = n < 0n ? "-" : "",
    v = n < 0n ? -n : n;
  return `${sign}${v / 100000000n}.${String(v % 100000000n).padStart(8, "0")}`;
}
export async function deriveKey(password, salt) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw Error("Use a password of at least 12 characters");
  const bytes = new TextEncoder().encode(password);
  try {
    const base = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, [
      "deriveKey",
    ]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}
export async function seal(key, salt, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      bytes,
    );
    return {
      version: 1,
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext,
      iterations: ITERATIONS,
    };
  } finally {
    bytes.fill(0);
  }
}
export async function unseal(password, record) {
  if (
    record?.version !== 1 ||
    record.iterations !== ITERATIONS ||
    record.salt?.length !== 16 ||
    record.iv?.length !== 12 ||
    !(record.ciphertext instanceof ArrayBuffer)
  )
    throw Error("Unsupported backup");
  const salt = new Uint8Array(record.salt),
    key = await deriveKey(password, salt);
  const bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: aad },
      key,
      record.ciphertext,
    ),
  );
  try {
    return { key, salt, data: JSON.parse(new TextDecoder().decode(bytes)) };
  } finally {
    bytes.fill(0);
  }
}
export async function storage(action, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("zyro-zcash-testnet-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vault");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("Wallet storage unavailable"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "vault",
        action === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("vault");
      const request =
        action === "get" ? store.get("wallet") : store.put(value, "wallet");
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(Error("Wallet storage failed"));
    });
  } finally {
    db.close();
  }
}
export function encodeBytes(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function decodeBytes(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
