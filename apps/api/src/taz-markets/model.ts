import { createHash } from "node:crypto";
import { priceUnits, parseCandles } from "../price-provider.js";

export const NETWORK = "testnet" as const;
export const STAKE = 1_000_000;
export const ZATOSHIS_PER_TAZ = 100_000_000;
export type Side = "YES" | "NO";
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const hex = (value: string) => /^[a-f0-9]{64}$/.test(value);
export const integer = (value: number) =>
  Number.isSafeInteger(value) && value >= 0;
export function requireThat(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}

export type Rules = {
  version: 1;
  network: typeof NETWORK;
  pair: "BTC-USD";
  provider: "Coinbase Exchange";
  comparison: "GT";
  equality: "NO";
  candleStart: number;
  thresholdUnits: string;
  stake: number;
  closesAt: number;
  cutoffGraceMs: number;
  confirmations: number;
};
export type Block = { height: number; hash: string };
export type Note = {
  txid: string;
  pool: "sapling" | "orchard" | "ironwood";
  index: number;
  commitment: string;
  walletId: string;
  network: typeof NETWORK;
  recipient: string;
  memo: string;
  amount: number;
  block: Block;
  spendable: boolean;
  role: "deposit" | "fee" | "change";
};
export type Scan = {
  network: typeof NETWORK;
  walletId: string;
  observedAt: number;
  tip: Block;
  scanned: Block;
  // Complete fixture inventory, including canonical owned spent notes.
  notes: Note[];
  blocks: Block[];
};
export type Market = {
  _id: string;
  rules: Rules;
  rulesHash: string;
  status: "open" | "frozen" | "resolved" | "cancelled" | "review";
  close?: Block;
  frozen?: string[];
  frozenBlocks?: { id: string; block: Block }[];
  outcome?: Side;
  evidence?: number[];
  evidenceHold?: true;
  reason?: string;
};
export type Position = {
  _id: string;
  owner: string;
  marketId: string;
  side: Side;
  rulesHash: string;
  network: typeof NETWORK;
  stake: number;
  recipient: string;
  association: "wallet-decrypted-memo";
  memo: string;
  payout: string;
  refund: string;
  createdAt: number;
  closesAt: number;
  requestId: string;
  addressReviewer: string;
  status: "awaiting" | "qualified" | "review";
  hint?: string;
};
export const outputKey = (n: Note) =>
  [n.network, n.txid, n.pool, n.index].join(":");
export type Deposit = {
  _id: string;
  note: Note;
  positionId?: string;
  marketId?: string;
  status: "candidate" | "qualified" | "review" | "orphaned" | "reserve";
  reason?: string;
  reservedBy?: string;
};
export type Plan = {
  obligationId: string;
  network: typeof NETWORK;
  walletId: string;
  inputs: string[];
  recipient: string;
  amount: number;
  fee: number;
  change: { recipient: string; amount: number } | null;
};
export type Signed = { txid: string; artifact: string };
export type Obligation = {
  _id: string;
  kind: "payout" | "refund";
  marketId: string;
  owner: string;
  destination: string;
  amount: number;
  sources: string[];
  status:
    | "pending"
    | "prepared"
    | "authorized"
    | "signed"
    | "submitted"
    | "confirmed"
    | "ambiguous"
    | "failed-safe"
    | "review";
  plan?: Plan;
  approval?: { actor: string; digest: string; receipt: string };
  signed?: Signed;
  rebroadcastClaimed?: true;
  confirmation?: Block;
};
export type Limits = {
  maxStake: number;
  maxExposure: number;
  maxFee: number;
  minConfirmations: number;
  maxScanAgeMs: number;
};
export type ChainState = Pick<Scan, "observedAt" | "tip" | "blocks">;
export type Control = {
  _id: "fixture" | "regtest" | "testnet";
  revision: number;
  paused: boolean;
  incident?: string;
  chain?: ChainState;
  balances?: {
    spendablePrincipal: number;
    unsettledPrincipal: number;
    feeReserve: number;
  };
};
export type Audit = {
  _id: string;
  at: Date;
  actor: string;
  event: string;
  subject: string;
  evidenceDigest: string;
};
export function unsafeCustody(control: Control) {
  return Boolean(
    control.incident && control.incident !== "custody-limit-or-fee-reserve",
  );
}
export function validBlock(block: Block) {
  return integer(block.height) && hex(block.hash);
}
export function validateScan(
  scan: Scan,
  wallet: string,
  now: number,
  maxAge: number,
) {
  requireThat(
    scan.network === NETWORK && scan.walletId === wallet,
    "Wrong custody identity",
  );
  requireThat(
    integer(scan.observedAt) &&
      scan.observedAt <= now &&
      now - scan.observedAt <= maxAge &&
      validBlock(scan.tip) &&
      validBlock(scan.scanned) &&
      scan.tip.height === scan.scanned.height &&
      scan.tip.hash === scan.scanned.hash,
    "Stale or incomplete wallet scan",
  );
  requireThat(
    scan.blocks.length <= 10_000 && scan.notes.length <= 1_000,
    "Fixture inventory too large",
  );
  const blocks = new Map(
    scan.blocks.map((block) => [block.height, block.hash]),
  );
  requireThat(
    blocks.size === scan.blocks.length &&
      blocks.get(scan.tip.height) === scan.tip.hash &&
      scan.blocks.every(
        (block) => validBlock(block) && block.height <= scan.tip.height,
      ),
    "Invalid canonical block inventory",
  );
  const seen = new Set<string>();
  for (const note of scan.notes) {
    const id = outputKey(note);
    requireThat(
      note.walletId === wallet &&
        note.network === NETWORK &&
        ["sapling", "orchard", "ironwood"].includes(note.pool) &&
        integer(note.index) &&
        validBlock(note.block) &&
        hex(note.txid) &&
        hex(note.commitment) &&
        typeof note.recipient === "string" &&
        note.recipient.length <= 512 &&
        typeof note.memo === "string" &&
        Buffer.byteLength(note.memo) <= 512 &&
        integer(note.amount) &&
        note.amount > 0 &&
        typeof note.spendable === "boolean" &&
        ["deposit", "fee", "change"].includes(note.role) &&
        blocks.get(note.block.height) === note.block.hash &&
        !seen.has(id),
      "Invalid owned output inventory",
    );
    seen.add(id);
  }
  return blocks;
}

export function classify(
  note: Note,
  position: Position | undefined,
  market: Market | undefined,
) {
  if (note.role === "fee") return "reserve";
  if (note.role !== "deposit") return "change";
  if (!position || !market || note.recipient !== position.recipient)
    return "unknown association";
  if (note.amount !== position.stake) return "incorrect amount";
  if (market.close && note.block.height > market.close.height)
    return "late deposit";
  return "exact";
}

export function resolveFixture(
  rules: Rules,
  observations: unknown[],
  now: number,
) {
  if (now < (rules.candleStart + 60) * 1000) return;
  const evidence = new Map<string, number[]>();
  for (const response of observations) {
    for (const candle of parseCandles(response, now)) {
      if (candle.time === rules.candleStart)
        evidence.set(digest(candle.raw), candle.raw);
    }
  }
  if (evidence.size !== 1) return;
  const [row] = evidence.values();
  const side: Side =
    BigInt(priceUnits(row[4])) > BigInt(rules.thresholdUnits) ? "YES" : "NO";
  return { side, row };
}

export function sum(values: number[]) {
  const total = values.reduce(
    (balance, amount) => balance + BigInt(amount),
    0n,
  );
  requireThat(
    total >= 0n && total <= BigInt(Number.MAX_SAFE_INTEGER),
    "Unsafe zatoshi total",
  );
  return Number(total);
}

export function settlement(
  market: Pick<Market, "_id" | "rulesHash"> & { rules: { stake: number } },
  funded: (Pick<Deposit, "_id" | "positionId"> & { note: { amount: number } })[],
  positions: Pick<Position, "_id" | "marketId" | "rulesHash" | "owner" | "side" | "payout" | "refund">[],
  outcome?: Side,
): Obligation[] {
  const entries = funded.map((deposit) => {
    const position = positions.find((item) => item._id === deposit.positionId);
    requireThat(
      position &&
        position.marketId === market._id &&
        position.rulesHash === market.rulesHash &&
        deposit.note.amount === market.rules.stake,
      "Invalid frozen funding",
    );
    return { position, deposit };
  });
  requireThat(
    new Set(entries.map(({ position }) => position._id)).size ===
      entries.length &&
      new Set(funded.map((note) => note._id)).size === funded.length &&
      new Set(entries.map(({ position }) => position.owner)).size ===
        entries.length,
    "Repeated frozen funding",
  );
  if (outcome)
    requireThat(
      entries.length === 2 &&
        entries[0].position.side !== entries[1].position.side,
      "Opposing stakes required",
    );
  return entries
    .filter(({ position }) => !outcome || position.side === outcome)
    .map(({ position, deposit }) => ({
      _id: outcome ? market._id + ":payout" : deposit._id + ":refund",
      kind: outcome ? "payout" : "refund",
      marketId: market._id,
      owner: position.owner,
      destination: outcome ? position.payout : position.refund,
      amount: outcome
        ? sum(funded.map(({ note }) => note.amount))
        : deposit.note.amount,
      sources: outcome ? funded.map((note) => note._id).sort() : [deposit._id],
      status: "pending",
    }));
}
