import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertIsolatedSignerIdentity,
  operatorAuthorizationMessage,
  operatorKeyFingerprint,
  verifyOperatorAuthorization,
} from "../apps/api/src/taz-markets/live/operator-auth.js";

const pair = () => generateKeyPairSync("ed25519");
const pem = (key: ReturnType<typeof pair>["publicKey"]) =>
  key.export({ format: "pem", type: "spki" }).toString();
const digest = "a".repeat(64);

function signature(privateKey: ReturnType<typeof pair>["privateKey"], value = digest) {
  return sign(null, operatorAuthorizationMessage(value), privateKey).toString("base64");
}

describe("independent refund operator authorization", () => {
  it("requires a distinct OS identity for the private signer", () => {
    expect(() => assertIsolatedSignerIdentity(1201, 1200, 1201)).not.toThrow();
    expect(() => assertIsolatedSignerIdentity(1200, 1200, 1200)).toThrow("dedicated OS identity");
    expect(() => assertIsolatedSignerIdentity(1201, 1200, 1200)).toThrow("dedicated OS identity");
  });

  it("verifies a detached Ed25519 signature over the exact digest", () => {
    const operator = pair();
    expect(verifyOperatorAuthorization(digest, signature(operator.privateKey), pem(operator.publicKey))).toBe(true);
  });

  it("rejects a signature for a different transaction digest", () => {
    const operator = pair();
    expect(verifyOperatorAuthorization("b".repeat(64), signature(operator.privateKey), pem(operator.publicKey))).toBe(false);
  });

  it("rejects a signature from a different operator key", () => {
    const operator = pair();
    const other = pair();
    expect(verifyOperatorAuthorization(digest, signature(operator.privateKey), pem(other.publicKey))).toBe(false);
  });

  it("rejects noncanonical signatures and non-Ed25519 public keys", () => {
    const operator = pair();
    expect(() => verifyOperatorAuthorization(digest, "not-a-signature", pem(operator.publicKey))).toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => operatorKeyFingerprint(pem(rsa.publicKey))).toThrow("Ed25519 operator key required");
  });

  it("domain separates approvals from other signatures", () => {
    expect(operatorAuthorizationMessage(digest).toString()).toBe(`ZYRO_TAZ_REFUND_AUTH_V1\n${digest}`);
    expect(() => operatorAuthorizationMessage("not-a-digest")).toThrow();
  });
});
