import { createPublicKey, verify } from "node:crypto";
import {
  resolutionInput,
  resolutionMessage,
  type Market,
  type Resolution,
} from "@zyro/shared";
import { Fault } from "./engine.js";
import { Store } from "./store.js";
import { hash } from "./policy.js";
export async function recordOutcome(
  store: Store,
  payload: unknown,
  signature: string,
  publicKey = process.env.ORACLE_PUBLIC_KEY,
) {
  if (!publicKey)
    throw new Fault("Resolution oracle public key is not configured", 503);
  const value = resolutionInput.parse(payload);
  let valid = false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    valid =
      key.asymmetricKeyType === "ed25519" &&
      verify(
        null,
        Buffer.from(resolutionMessage(value)),
        key,
        Buffer.from(signature, "base64"),
      );
  } catch {
    /* fail closed */
  }
  if (!valid) throw new Fault("Invalid oracle signature", 403);
  return store.atomic(async (tx) => {
    const m = await tx.get<Market>(value.marketId);
    if (!m) throw new Fault("Challenge not found", 404);
    if (m.status === "RESOLVED")
      throw new Fault("Outcome already recorded", 409);
    if (m.status !== "MATCHED" || m.participants.length !== 2)
      throw new Fault("Challenge has not matched", 409);
    if (
      Date.now() < Date.parse(m.resolutionDeadline) ||
      Date.parse(value.observedAt) < Date.parse(m.resolutionDeadline) ||
      Date.parse(value.observedAt) > Date.now() + 30000
    )
      throw new Fault(
        "Outcome observation is outside the resolution window",
        409,
      );
    if (
      value.agreementHash !== m.agreementHash ||
      value.evidenceUrl !== m.source
    )
      throw new Fault("Resolution does not match accepted terms");
    const receipt = { value, signature, publicKey };
    m.status = "RESOLVED";
    m.outcome = value.outcome;
    m.evidence = hash(receipt);
    await tx.put(m.id + ":resolution", "resolution", receipt);
    await tx.put(m.id, "market", m);
    return m;
  });
}
export type OutcomeReceipt = {
  value: Resolution;
  signature: string;
  publicKey: string;
};
