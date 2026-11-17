import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Market, Side } from "@zyro/shared";
import { Store } from "./store.js";
import { Fault } from "./engine.js";
import { observeTransaction, type ChainNetwork, type Rpc } from "./zcash.js";
import { observeLightwalletTransaction } from "./lightwallet.js";
export type FundingIntent = {
  id: string;
  marketId: string;
  userId: string;
  side: Side;
  network: ChainNetwork;
  agreementHash: string;
  reference: string;
  expectedZatoshis: number;
  recipient: string | null;
  state:
    | "AWAITING_WALLET_SETUP"
    | "AWAITING_DEPOSIT"
    | "SUBMITTED_UNVERIFIED"
    | "PENDING"
    | "CONFIRMED"
    | "INSUFFICIENT"
    | "EXCESS"
    | "REFUND_REQUIRED"
    | "CONFLICTED";
  txid?: string;
  receivedZatoshis: number;
  confirmations: number;
  checkedAt?: string;
  confirmedBeforeDeadlineAt?: string;
};
const noteSchema = z
  .object({
    txid: z.string().regex(/^[a-f0-9]{64}$/),
    network: z.enum(["testnet", "regtest"]),
    pool: z.enum(["sapling", "orchard", "ironwood"]),
    outputIndex: z.number().int().nonnegative().safe(),
    amountZatoshis: z.number().int().safe().positive().max(2100000000000000),
    recipient: z.string().min(1),
    memo: z.string().max(512),
  })
  .strict();
export type RecognizedNote = z.infer<typeof noteSchema>;
// Must be backed by authenticated wallet-side note recognition, NEVER by browser-supplied fields.
export type WalletReceiptSource = (
  intent: FundingIntent,
) => Promise<RecognizedNote>;
export class FundingService {
  constructor(
    private store: Store,
    private rpc?: Rpc,
    private receiptSource?: WalletReceiptSource,
    private network: ChainNetwork = (process.env.ZCASH_NETWORK ||
      "testnet") as ChainNetwork,
    private recipient?: string,
  ) {}
  async intent(userId: string, marketId: string) {
    return this.store.atomic(async (tx) => {
      if (!["testnet", "regtest"].includes(this.network))
        throw new Fault("Unsafe funding network", 503);
      const m = await tx.get<Market>(marketId);
      if (!m) throw new Fault("Challenge not found", 404);
      if ((m.network || "testnet") !== this.network)
        throw new Fault("Challenge funding network mismatch", 409);
      const participant = m.participants.find((p) => p.userId === userId);
      if (!participant)
        throw new Fault(
          "Only an accepted participant can request funding",
          403,
        );
      if (m.status !== "MATCHED" || Date.now() >= Date.parse(m.fundingDeadline))
        throw new Fault("Challenge is not accepting funding", 409);
      const id = "funding:" + marketId + ":" + userId;
      const existing = await tx.get<FundingIntent>(id);
      if (existing) return existing;
      const reference =
        "ZYRO:1:" +
        marketId +
        ":" +
        participant.side +
        ":" +
        randomBytes(16).toString("hex");
      const intent: FundingIntent = {
        id,
        marketId,
        userId,
        side: participant.side,
        network: this.network,
        agreementHash: m.agreementHash,
        reference,
        expectedZatoshis: m.stake,
        recipient: this.recipient || null,
        state: this.recipient ? "AWAITING_DEPOSIT" : "AWAITING_WALLET_SETUP",
        receivedZatoshis: 0,
        confirmations: 0,
      };
      await tx.put(id, "funding-intent", intent);
      return intent;
    });
  }
  async claim(userId: string, marketId: string, txid: string) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(txid);
    const intent = await this.intent(userId, marketId);
    return this.store.atomic(async (tx) => {
      const current = (await tx.get<FundingIntent>(intent.id))!;
      if (current.txid && current.txid !== txid)
        throw new Fault(
          "A funding claim already exists for this participant",
          409,
        );
      if (!current.txid) {
        current.txid = txid;
        current.state = "SUBMITTED_UNVERIFIED";
        await tx.put(current.id, "funding-intent", current);
      }
      return current;
    });
  }
  async verify(userId: string, marketId: string) {
    if (!this.receiptSource)
      throw new Fault(
        "Shielded wallet note recognition is not configured; a txid is not deposit proof",
        503,
      );
    const intent = await this.store.get<FundingIntent>(
      "funding:" + marketId + ":" + userId,
    );
    if (!intent || !intent.txid) throw new Fault("No funding claim found", 404);
    if (!intent.recipient)
      throw new Fault("No authenticated escrow recipient is configured", 503);
    const note = noteSchema.parse(await this.receiptSource(intent));
    if (
      note.txid !== intent.txid ||
      note.network !== intent.network ||
      note.recipient !== intent.recipient ||
      note.memo !== intent.reference
    )
      throw new Fault("Wallet note does not match the funding intent", 409);
    const observation =
      !this.rpc && !process.env.ZCASH_RPC_URL && process.env.LIGHTWALLETD_URL
        ? await observeLightwalletTransaction(
            note.txid,
            process.env.LIGHTWALLETD_URL,
            intent.network,
          )
        : await observeTransaction(note.txid, this.rpc, intent.network);
    return this.store.atomic(async (tx) => {
      const m = await tx.get<Market>(marketId);
      const current = await tx.get<FundingIntent>(intent.id);
      if (!m || !current || m.agreementHash !== current.agreementHash)
        throw new Fault("Funding agreement mismatch", 409);
      const outputId = [
        "funding-output",
        note.network,
        note.txid,
        note.pool,
        note.outputIndex,
      ].join(":");
      const consumed = await tx.get<{ intentId: string }>(outputId);
      if (consumed && consumed.intentId !== intent.id)
        throw new Fault(
          "Funding output is already associated with another intent",
          409,
        );
      // Preserve timely confirmation across ordinary rechecks, but invalidate
      // qualification on a reorg/conflict. Never infer timing from a submitted txid.
      if (
        !current.confirmedBeforeDeadlineAt &&
        current.state === "CONFIRMED" &&
        current.checkedAt &&
        Date.parse(current.checkedAt) < Date.parse(m.fundingDeadline)
      )
        current.confirmedBeforeDeadlineAt = current.checkedAt;
      if (observation.confirmations < 3 || observation.state === "CONFLICTED")
        delete current.confirmedBeforeDeadlineAt;
      else if (
        Date.now() < Date.parse(m.fundingDeadline) &&
        note.amountZatoshis === current.expectedZatoshis
      )
        current.confirmedBeforeDeadlineAt ??= observation.checkedAt;
      current.receivedZatoshis = note.amountZatoshis;
      current.confirmations = observation.confirmations;
      current.checkedAt = observation.checkedAt;
      current.state =
        observation.state === "CONFLICTED"
          ? "CONFLICTED"
          : observation.confirmations < 3
            ? "PENDING"
            : m.status === "CANCELLED" ||
                (Date.now() >= Date.parse(m.fundingDeadline) &&
                  !current.confirmedBeforeDeadlineAt)
              ? "REFUND_REQUIRED"
              : note.amountZatoshis < current.expectedZatoshis
                ? "INSUFFICIENT"
                : note.amountZatoshis > current.expectedZatoshis
                  ? "EXCESS"
                  : "CONFIRMED";
      await tx.put(outputId, "funding-output", {
        intentId: current.id,
        note,
        checkedAt: observation.checkedAt,
      });
      await tx.put(current.id, "funding-intent", current);
      return current;
    });
  }
  async summary(userId: string, marketId: string) {
    const m = await this.store.get<Market>(marketId);
    if (!m) throw new Fault("Challenge not found", 404);
    if (!m.participants.some((p) => p.userId === userId))
      throw new Fault("Participant access required", 403);
    const own = await this.store.get<FundingIntent>(
      "funding:" + marketId + ":" + userId,
    );
    return {
      intent: own || null,
      depositRecognitionConfigured: !!this.receiptSource,
      custodyMode: this.receiptSource
        ? "developer-custodial-demo"
        : "unconfigured",
      escrowIntegrated: false,
      settlementEligible: false,
      thresholdAuthorization: "NOT_STARTED",
      payoutBroadcast: false,
      notice:
        "Funding claims are unverified until an authenticated wallet recognizes the exact recipient, memo and amount. No integrated escrow or payout is available.",
    };
  }
}
