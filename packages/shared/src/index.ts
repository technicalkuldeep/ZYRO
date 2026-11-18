import { z } from "zod";
export const sideSchema = z.enum(["YES", "NO"]);
export const marketInput = z
  .object({
    question: z.string().trim().min(15).max(180),
    description: z.string().trim().min(30).max(3000),
    category: z.enum(["Zcash", "Technology", "Science", "Culture"]),
    stake: z.number().int().min(10000).max(100000000),
    fundingDeadline: z.iso.datetime(),
    resolutionDeadline: z.iso.datetime(),
    source: z
      .url()
      .refine(
        (s) => s.startsWith("https://"),
        "Use an HTTPS resolution source",
      ),
    rules: z.string().trim().min(25).max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (Date.parse(v.fundingDeadline) <= Date.now())
      c.addIssue({
        code: "custom",
        path: ["fundingDeadline"],
        message: "Funding deadline must be in the future",
      });
    if (Date.parse(v.resolutionDeadline) <= Date.parse(v.fundingDeadline))
      c.addIssue({
        code: "custom",
        path: ["resolutionDeadline"],
        message: "Resolution must follow funding",
      });
  });
export type MarketInput = z.infer<typeof marketInput>;
export type Side = z.infer<typeof sideSchema>;
export type Market = MarketInput & {
  network?: "testnet" | "regtest";
  id: string;
  creator: string;
  createdAt: string;
  status: "OPEN" | "MATCHED" | "CANCELLED" | "RESOLVED";
  participants: {
    userId: string;
    side: Side;
    publicKey: string;
    signature: string;
  }[];
  outcome?: Side;
  evidence?: string;
  agreementHash: string;
  example?: boolean;
};
export type Agreement = {
  version: 1;
  network: "testnet" | "regtest";
  marketId: string;
  question: string;
  description: string;
  category: string;
  outcomes: ["YES", "NO"];
  stake: number;
  fundingDeadline: string;
  resolutionDeadline: string;
  source: string;
  rules: string;
  feePolicy: { platformFee: 0; networkFee: 10000 };
  payoutRules: string;
  cancellation: string;
};
export function agreement(m: Market): Agreement {
  return {
    version: 1,
    network: m.network || "testnet",
    marketId: m.id,
    question: m.question,
    description: m.description,
    category: m.category,
    outcomes: ["YES", "NO"],
    stake: m.stake,
    fundingDeadline: m.fundingDeadline,
    resolutionDeadline: m.resolutionDeadline,
    source: m.source,
    rules: m.rules,
    feePolicy: { platformFee: 0, networkFee: 10000 },
    payoutRules:
      "Winner receives twice the stake minus the fixed network fee. No other outputs.",
    cancellation:
      "Unmatched challenges cancel at funding deadline. Refund requires verified funding and available signers.",
  };
}
// Sorted-key JSON, no floats or optional fields in agreements. UTF-8 is the hash input.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function acceptanceMessage(hash: string, userId: string, side: Side) {
  return `ZYRO acceptance v1\n${hash}\n${userId}\n${side}`;
}
export function payout(stake: number, fee = 10000) {
  if (
    !Number.isSafeInteger(stake) ||
    stake < 10000 ||
    stake > 100000000 ||
    fee !== 10000
  )
    throw new Error("Invalid financial units or fee");
  return stake * 2 - fee;
}
export type Session = { id: string; credits: number; createdAt: string };
export type Round = {
  gameKey?: string;
  gameKind?: "quick" | "market";
  choice?: string;
  rulesHash?: string;
  preparedAt?: string;
  marketId?: string;
  result?: {
    values: number[];
    label: string;
    bot?: string;
    verdict: "WIN" | "LOSS" | "TIE" | "REFUND";
  };
  id: string;
  userId: string;
  side: Side;
  botSide: Side;
  stake: number;
  draw: number;
  commitment: string;
  secret?: string;
  status: "PENDING" | "RESOLVED" | "CANCELLED";
  outcome?: Side;
  createdAt: string;
  resolveAt: string;
  payout?: number;
};
export function botSide(draws: number[]) {
  return draws.length === 0 ||
    draws.reduce((a, b) => a + b, 0) / draws.length >= 50
    ? "YES"
    : "NO";
}
export const resolutionInput = z
  .object({
    marketId: z.uuid(),
    agreementHash: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: sideSchema,
    evidenceUrl: z.url(),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.iso.datetime(),
  })
  .strict();
export type Resolution = z.infer<typeof resolutionInput>;
export function resolutionMessage(value: Resolution) {
  return "ZYRO resolution v1\n" + canonical(value);
}
