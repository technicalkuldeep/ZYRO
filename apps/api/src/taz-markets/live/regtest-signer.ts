import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { digest, requireThat, type Block } from "../model.js";
import { MARKET_ID, RegtestLedger, type RegtestObligation } from "./regtest-ledger.js";
import { operatorKeyFingerprint, verifyOperatorAuthorization } from "./operator-auth.js";
import type { LiveCustodyAdapter } from "./adapter.js";

type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;
type Candidate = NonNullable<RegtestObligation["candidate"]>;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const checked = z.object({
  txid: hash, shieldedSighash: hash, expiry: z.number().int(), anchor: hash,
  feeZat: z.number().int().positive(), changeZat: z.number().int().nonnegative(),
  paymentZat: z.literal(1_000_000), sourceTotalZat: z.literal(1_050_000),
});
const bytesHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class RegtestSigner {
  constructor(
    private ledger: RegtestLedger,
    private payerObserver: LiveCustodyAdapter,
    private node: Rpc,
    private custody: Rpc,
    private payer: Rpc,
    private custodyDb: string,
    private verifier: string,
    private operatorAccount: string,
    private operatorPublicKey: string,
  ) {}

  private get store() { return this.ledger.store; }

  private async obligation() {
    const market = await this.ledger.market();
    requireThat(market.status === "cancelled" && market.frozen?.length === 1, "Cancelled funding required");
    const row = await this.store.obligations.findOne({ _id: market.frozen[0] + ":refund" });
    requireThat(row?.network === "regtest" && row.kind === "refund" &&
      row.marketId === MARKET_ID && row.fundingHash === market.rulesHash &&
      row.owner === market.rules.owner && row.destination === market.rules.refund &&
      row.amount === market.rules.stake && row.sources.length === 1 && row.sources[0] === market.frozen[0],
      "Refund obligation disagrees with immutable funding");
    return { row, market };
  }

  private async sources(requireUnspent: boolean) {
    const { row, market } = await this.obligation();
    const scan = await this.ledger.observer.scan();
    await this.ledger.assertCanonical(market);
    const [principal] = row.sources;
    const deposit = await this.store.deposits.findOne({ _id: principal, status: "qualified", reservedBy: row._id });
    const depositNote = scan.notes.find(n => n.id === deposit?._id && n.commitment === deposit.note.commitment &&
      n.block.hash === deposit.note.block.hash && n.amount === row.amount &&
      n.memoReference === market.rules.memo && n.receiver === market.rules.receiver);
    const feeNote = scan.notes.find(n => n.id !== principal && n.pool === "ironwood" &&
      n.amount === 50_000 && n.receiver === market.rules.receiver && !n.memoReference &&
      n.block.height > market.rules.cutoffHeight && n.confirmations >= market.rules.confirmations);
    requireThat(depositNote && feeNote && scan.notes.length === 2 &&
      (!row.feeSource || row.feeSource === feeNote.id), "Unexpected custody input inventory");
    if (requireUnspent) {
      requireThat([depositNote, feeNote].every(n => n.availability === "listed-unspent"), "Reserved source unavailable");
    }
    const feeView = z.object({
      txid: hash, status: z.literal("mined"), blockhash: hash,
      spends: z.array(z.object({ account_uuid: z.string().uuid().optional(), valueZat: z.number().optional() })),
    }).parse(await this.payer("z_viewtransaction", [feeNote.txid]));
    const spends = feeView.spends.filter(s => (s.valueZat ?? 0) > 0);
    requireThat(feeView.txid === feeNote.txid && feeView.blockhash === feeNote.block.hash &&
      this.operatorAccount !== row.owner && spends.length > 0 &&
      spends.every(s => s.account_uuid === this.operatorAccount), "Operator fee funding provenance unavailable");

    const db = new DatabaseSync(this.custodyDb, { readOnly: true });
    const notes: Record<string, number> = {};
    try {
      const find = db.prepare(`SELECT n.nf, n.value FROM ironwood_received_notes n
        JOIN transactions t ON n.transaction_id = t.id_tx
        JOIN accounts a ON n.account_id = a.id
        WHERE t.txid = ? AND n.action_index = ? AND t.mined_height = ? AND a.uuid = ?`);
      for (const note of [depositNote, feeNote]) {
        const found = find.get(Buffer.from(note.txid, "hex").reverse(), note.outputIndex,
          note.block.height, Buffer.from(market.rules.custody.replaceAll("-", ""), "hex"));
        requireThat(found?.nf instanceof Uint8Array && found.nf.length === 32 && found.value === note.amount,
          "Custody wallet note identity disagrees");
        notes[Buffer.from(found.nf).toString("hex")] = note.amount;
      }
      requireThat(Object.keys(notes).length === 2, "Duplicate custody nullifier");
    } finally { db.close(); }
    const evidence = {
      recipient: row.destination, notes, max_fee: market.rules.maxFee,
      payer_fvk: await this.payer<string>("z_exportviewingkey", [row.destination]),
      custody_fvk: await this.custody<string>("z_exportviewingkey", [market.rules.receiver]),
    };
    await this.ledger.current(scan.tip, scan.observedAt);
    return { row, market, feeNote, scan, evidence };
  }

  private verify(pczt: string, evidence: Awaited<ReturnType<RegtestSigner["sources"]>>["evidence"]) {
    const dir = mkdtempSync(join(tmpdir(), "zyro-regtest-verifier-"));
    try {
      const path = join(dir, "evidence.json");
      writeFileSync(path, JSON.stringify(evidence), { mode: 0o600 });
      const bytes = Buffer.from(pczt, "base64");
      requireThat(bytes.toString("base64") === pczt, "Noncanonical PCZT encoding");
      const verified = checked.parse(JSON.parse(execFileSync(this.verifier, [path], { input: bytes, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] }).toString()));
      return {
        pczt, pcztHash: bytesHash(bytes), sighash: verified.shieldedSighash,
        txid: verified.txid, expiry: verified.expiry, anchor: verified.anchor,
        fee: verified.feeZat, change: verified.changeZat,
      };
    } catch {
      throw new Error("Independent PCZT verification rejected the artifact");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  private async validity(candidate: Candidate, tip: Block) {
    requireThat(candidate.expiry > tip.height + 1, "Refund transaction expired or too close to expiry");
    const trees = await this.node<{ hash: string; ironwood: { commitments: { finalRoot: string } } }>("z_gettreestate", [tip.hash]);
    const root = hash.parse(trees.ironwood.commitments.finalRoot);
    const reversed = Buffer.from(root, "hex").reverse().toString("hex");
    requireThat(trees.hash === tip.hash && (root === candidate.anchor || reversed === candidate.anchor),
      "Refund anchor is not the current canonical Ironwood root");
  }

  private approvalDigest(row: RegtestObligation, candidate: Candidate) {
    return digest([row._id, row.network, row.fundingHash, row.sources, row.feeSource, row.destination,
      row.amount, "FullPrivacy", candidate.pcztHash, candidate.sighash, candidate.txid, candidate.expiry,
      candidate.anchor, candidate.fee, candidate.change]);
  }

  private async approved(requireUnspent: boolean) {
    const source = await this.sources(requireUnspent);
    const { row } = source;
    const candidate = row.candidate;
    const authorization = row.authorization;
    requireThat(candidate && authorization &&
      authorization.keyFingerprint === operatorKeyFingerprint(this.operatorPublicKey), "Operator authorization missing or from an unexpected key");
    const value = this.approvalDigest(row, candidate);
    requireThat(authorization.digest === value &&
      verifyOperatorAuthorization(value, authorization.signature, this.operatorPublicKey) &&
      digest(this.verify(candidate.pczt, source.evidence)) === digest(candidate),
      "Authorized candidate was modified");
    await this.validity(candidate, source.scan.tip);
    return { ...source, candidate, authorization };
  }

  async prepare() {
    const { row, market, feeNote, scan, evidence } = await this.sources(true);
    if (row.candidate) return this.summary(row);
    requireThat(row.status === "pending", "Refund cannot be prepared");
    const built = z.object({ pczt: z.string(), privacy_policy: z.literal("FullPrivacy") }).parse(
      await this.custody("pczt_create", [market.rules.custody, [{ address: row.destination, amount: row.amount / 100_000_000 }], 2, "FullPrivacy", "orchard"]));
    const candidate = this.verify(built.pczt, evidence);
    await this.validity(candidate, scan.tip);
    return this.store.atomic(async session => {
      await this.ledger.current(scan.tip, scan.observedAt);
      await this.store.deposits.insertOne({ _id: feeNote.id, note: feeNote, marketId: MARKET_ID, status: "reserve", reservedBy: row._id,
        provenance: { genesis: market.rules.genesis, branch: scan.branch, tip: scan.tip, observedAt: scan.observedAt } }, { session });
      const result = await this.store.obligations.updateOne({ _id: row._id, status: "pending" },
        { $set: { candidate, feeSource: feeNote.id, status: "prepared" } }, { session });
      requireThat(result.modifiedCount === 1, "Refund already prepared");
      const prepared = { ...row, candidate, feeSource: feeNote.id, status: "prepared" } as const;
      await this.store.record(session, "regtest-operator", "refund-prepared", row._id, this.approvalDigest(prepared, candidate));
      return this.summary(prepared);
    });
  }

  async approve(expected: string, signature: string) {
    const { row, scan, evidence } = await this.sources(true);
    const candidate = row.candidate;
    requireThat(candidate && row.status === "prepared" && expected === this.approvalDigest(row, candidate),
      "Approval requires the exact pending digest and may only be submitted once");
    requireThat(verifyOperatorAuthorization(expected, signature, this.operatorPublicKey),
      "Independent operator signature does not authorize this digest");
    requireThat(digest(this.verify(candidate.pczt, evidence)) === digest(candidate), "Prepared candidate changed");
    await this.validity(candidate, scan.tip);
    return this.store.atomic(async session => {
      await this.ledger.current(scan.tip, scan.observedAt);
      const authorization = { digest: expected, pcztHash: candidate.pcztHash, sighash: candidate.sighash,
        expiry: candidate.expiry, fee: candidate.fee, change: candidate.change, signature,
        keyFingerprint: operatorKeyFingerprint(this.operatorPublicKey) };
      const result = await this.store.obligations.updateOne({ _id: row._id, status: "prepared", "candidate.pcztHash": candidate.pcztHash },
        { $set: { status: "authorized", authorization } }, { session });
      requireThat(result.modifiedCount === 1, "Approval already recorded");
      await this.store.record(session, "regtest-operator", "refund-authorized", row._id, expected);
      return { id: row._id, approval: expected };
    });
  }

  private sameEffects(expected: Candidate, actual: Candidate) {
    for (const key of ["sighash", "txid", "expiry", "anchor", "fee", "change"] as const)
      requireThat(expected[key] === actual[key], "Transaction effects changed after approval");
  }

  async sign() {
    const { row, candidate, evidence, scan, authorization } = await this.approved(true);
    requireThat(row.status === "authorized" && !row.signClaimed, "Signing already claimed or unavailable");
    const proven = z.object({ pczt: z.string() }).parse(await this.custody("pczt_prove", [candidate.pczt]));
    this.sameEffects(candidate, this.verify(proven.pczt, evidence));
    await this.store.atomic(async session => {
      await this.ledger.current(scan.tip, Date.now());
      const claim = await this.store.obligations.updateOne({ _id: row._id, status: "authorized",
        "authorization.digest": authorization.digest, signClaimed: { $exists: false } },
        { $set: { signClaimed: true } }, { session });
      requireThat(claim.modifiedCount === 1, "Signing already claimed");
    });
    const signed = z.object({ pczt: z.string(), ironwood_signed: z.literal(2), unsigned_ironwood: z.array(z.number()).length(0) })
      .parse(await this.custody("pczt_sign", [proven.pczt, "FullPrivacy", true]));
    this.sameEffects(candidate, this.verify(signed.pczt, evidence));
    await this.store.atomic(async session => {
      const saved = await this.store.obligations.updateOne({ _id: row._id, status: "authorized", signClaimed: true,
        signedPczt: { $exists: false } }, { $set: { signedPczt: signed.pczt } }, { session });
      requireThat(saved.modifiedCount === 1, "Signed PCZT was not persisted");
    });
    return this.extract();
  }

  async extract() {
    const { row, candidate, evidence } = await this.approved(false);
    requireThat(row.status === "authorized" && row.signClaimed && row.signedPczt, "No recoverable signed PCZT");
    this.sameEffects(candidate, this.verify(row.signedPczt, evidence));
    const extracted = z.object({ txid: hash, hex: z.string().regex(/^(?:[0-9a-f]{2})+$/) }).parse(await this.custody("pczt_extract", [row.signedPczt]));
    const bytes = Buffer.from(extracted.hex, "hex");
    const final = z.object({ txid: hash, expiry: z.number().int(), anchor: hash }).parse(JSON.parse(
      execFileSync(this.verifier, ["--final"], { input: bytes, timeout: 30_000 }).toString()));
    requireThat(final.txid === extracted.txid && final.txid === candidate.txid &&
      final.expiry === candidate.expiry && final.anchor === candidate.anchor, "Final transaction differs from approved effects");
    const journal = { ...extracted, hash: bytesHash(bytes) };
    return this.store.atomic(async session => {
      const saved = await this.store.obligations.updateOne({ _id: row._id, status: "authorized", signedPczt: row.signedPczt },
        { $set: { journal, signed: { txid: final.txid, artifact: journal.hash }, status: "signed" },
          $unset: { signedPczt: "" } }, { session });
      requireThat(saved.modifiedCount === 1, "Final artifact already journaled");
      await this.store.record(session, "regtest-signer", "refund-journaled", row._id, { txid: final.txid, hash: journal.hash });
      return { id: row._id, txid: final.txid, artifactHash: journal.hash };
    });
  }

  async broadcast() {
    const { row, candidate, scan } = await this.approved(false);
    const journal = row.journal;
    requireThat(row.status === "signed" && journal && candidate.txid === journal.txid &&
      row.signed?.txid === journal.txid && row.signed.artifact === journal.hash &&
      bytesHash(Buffer.from(journal.hex, "hex")) === journal.hash, "No unsubmitted journaled refund");
    await this.store.atomic(async session => {
      await this.ledger.current(scan.tip, scan.observedAt);
      const claim = await this.store.obligations.updateOne({ _id: row._id, status: "signed", "journal.hash": journal.hash },
        { $set: { status: "ambiguous" } }, { session });
      requireThat(claim.modifiedCount === 1, "Broadcast already claimed");
    });
    const txid = await this.node<string>("sendrawtransaction", [journal.hex]);
    requireThat(txid === journal.txid, "Node reported a different transaction");
    await this.store.atomic(async session => {
      await this.store.obligations.updateOne({ _id: row._id, status: "ambiguous", "journal.txid": txid },
        { $set: { status: "submitted" } }, { session });
    });
    return { id: row._id, txid };
  }

  async reconcile() {
    const { row, market } = await this.obligation();
    const journal = row.journal;
    requireThat(journal && row.signed?.txid === journal.txid &&
      bytesHash(Buffer.from(journal.hex, "hex")) === journal.hash, "No authentic journal artifact");
    const payer = await this.payerObserver.scan();
    await this.ledger.assertCanonical(market);
    const notes = payer.notes.filter(n => n.txid === journal.txid && n.receiver === row.destination &&
      n.amount === row.amount && n.confirmations >= market.rules.confirmations);
    if (notes.length === 0 && row.status !== "confirmed") return this.summary(row);
    return this.store.atomic(async session => {
      await this.ledger.current(payer.tip, payer.observedAt);
      const [note] = notes;
      if (row.status === "confirmed") {
        if (notes.length === 1 && row.confirmation?.hash === note.block.hash) return this.summary(row);
        await this.store.obligations.updateOne({ _id: row._id, status: "confirmed" }, { $set: { status: "review" } }, { session });
        return { id: row._id, status: "review", txid: journal.txid };
      }
      requireThat(notes.length === 1 && ["signed", "submitted", "ambiguous"].includes(row.status), "Unexpected refund receipt");
      await this.store.obligations.updateOne({ _id: row._id, "journal.txid": journal.txid },
        { $set: { status: "confirmed", confirmation: note.block } }, { session });
      await this.store.record(session, "regtest-observer", "refund-confirmed", row._id, note);
      return this.summary({ ...row, status: "confirmed", confirmation: note.block });
    });
  }

  private summary(row: RegtestObligation) {
    return { id: row._id, status: row.status, digest: row.candidate && this.approvalDigest(row, row.candidate),
      txid: row.journal?.txid, expiry: row.candidate?.expiry, fee: row.candidate?.fee,
      change: row.candidate?.change, sources: row.sources, feeSource: row.feeSource,
      recipient: row.destination, amount: row.amount, confirmation: row.confirmation };
  }
}

