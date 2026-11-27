import { createHash, createPublicKey, verify } from "node:crypto";
import { requireThat } from "../model.js";

const digestPattern = /^[0-9a-f]{64}$/;

export function operatorAuthorizationMessage(digest: string) {
  requireThat(digestPattern.test(digest), "Invalid operator authorization digest");
  return Buffer.from(`ZYRO_TAZ_REFUND_AUTH_V1\n${digest}`, "utf8");
}

function ed25519PublicKey(pem: string) {
  const key = createPublicKey(pem);
  requireThat(key.asymmetricKeyType === "ed25519", "Ed25519 operator key required");
  return key;
}

export function operatorKeyFingerprint(pem: string) {
  const der = ed25519PublicKey(pem).export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

export function assertIsolatedSignerIdentity(
  operatorUid: number,
  apiUid: number,
  processUid: number | undefined,
) {
  requireThat(
    Number.isSafeInteger(operatorUid) && operatorUid >= 0 &&
      Number.isSafeInteger(apiUid) && apiUid >= 0 &&
      operatorUid !== apiUid && processUid === operatorUid,
    "Signer must run as a dedicated OS identity, separate from the API",
  );
}

export function verifyOperatorAuthorization(
  digest: string,
  signatureBase64: string,
  publicKeyPem: string,
) {
  const key = ed25519PublicKey(publicKeyPem);
  const signature = Buffer.from(signatureBase64, "base64");
  requireThat(
    signature.length === 64 && signature.toString("base64") === signatureBase64,
    "Canonical Ed25519 operator signature required",
  );
  return verify(null, operatorAuthorizationMessage(digest), key, signature);
}
