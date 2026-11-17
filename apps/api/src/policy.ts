import { createHash } from "node:crypto";
import { agreement, canonical, payout, type Market } from "@zyro/shared";
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
export type Proposal = {
  agreementHash: string;
  network: "testnet" | "regtest";
  recipient: string;
  amount: number;
  fee: number;
  change: number;
  outputs: number;
  resolutionEvidence: string;
};
export function validateSettlement(
  m: Market,
  p: Proposal,
  context: {
    settled: boolean;
    funded: boolean;
    winnerAddress: string;
    resolutionVerified: boolean;
  },
) {
  if (
    m.status !== "RESOLVED" ||
    !m.outcome ||
    !context.resolutionVerified ||
    !m.evidence ||
    p.resolutionEvidence !== m.evidence
  )
    throw new Error("Unauthorized settlement state or invalid resolution data");
  if (context.settled) throw new Error("Duplicate settlement");
  if (!context.funded) throw new Error("Funding has not been verified");
  if (
    !["testnet", "regtest"].includes(p.network) ||
    p.network !== (m.network || "testnet") ||
    p.agreementHash !== m.agreementHash ||
    m.agreementHash !== hash(agreement(m))
  )
    throw new Error("Incorrect market agreement or network");
  if (p.recipient !== context.winnerAddress || !context.winnerAddress)
    throw new Error("Incorrect payout recipient");
  if (
    p.amount !== payout(m.stake) ||
    p.fee !== 10000 ||
    p.change !== 0 ||
    p.outputs !== 1
  )
    throw new Error("Incorrect payout amount, fee, change or outputs");
  return { allowed: true as const, amount: p.amount };
}
