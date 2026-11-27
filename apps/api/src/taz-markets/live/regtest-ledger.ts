import { randomBytes } from "node:crypto";
import type { ClientSession } from "mongodb";
import { digest, requireThat, settlement, STAKE, type Block, type Obligation } from "../model.js";
import { TazStore } from "../store.js";
import { LiveCustodyAdapter, matchIntent, NU7, type OwnedObservation } from "./adapter.js";
import type { ObservationRpc } from "./rpc.js";

export const MARKET_ID = "private-regtest-refund";
const CONFIRMATIONS = 2;
const MAX_FEE = 50_000;
type Terms = {
  network: "regtest";
  genesis: string;
  branch: string;
  stake: number;
  confirmations: number;
  maxFee: number;
  opened: Block;
  cutoffHeight: number;
  custody: string;
  owner: string;
  receiver: string;
  refund: string;
  memo: string;
};

type Position = {
  _id: string;
  marketId: string;
  owner: string;
  side: "YES";
  rulesHash: string;
  refund: string;
  payout: string;
  memo: string;
  requestId: string;
  network: "regtest";
  status: "awaiting" | "qualified" | "review";
};

type Market = {
  _id: string;
  rules: Terms;
  rulesHash: string;
  status: "open" | "frozen" | "cancelled" | "review";
  close?: Block;
  frozen?: string[];
};

type Deposit = {
  _id: string;
  note: OwnedObservation;
  marketId: string;
  positionId?: string;
  status: "qualified" | "reserve" | "review";
  reservedBy?: string;
  provenance: { genesis: string; branch: string; tip: Block; observedAt: number };
};

export type RegtestObligation = Obligation & {
  network: "regtest";
  fundingHash: string;
  feeSource?: string;
  candidate?: { pczt: string; pcztHash: string; sighash: string; txid: string; expiry: number; anchor: string; fee: number; change: number };
  authorization?: {
    digest: string;
    keyFingerprint: string;
    pcztHash: string;
    sighash: string;
    expiry: number;
    fee: number;
    change: number;
    signature: string;
  };
  journal?: { txid: string; hex: string; hash: string };
  signClaimed?: true;
  signedPczt?: string;
};

export type RegtestStore = TazStore<{
  market: Market;
  position: Position;
  deposit: Deposit;
  obligation: RegtestObligation;
}>;

export class RegtestLedger {
  constructor(
    readonly store: RegtestStore,
    readonly observer: LiveCustodyAdapter,
    private readonly zebra: ObservationRpc<"zebra">,
  ) {
    requireThat(observer.mode === "regtest", "Regtest observer required");
  }

  async issue(owner: string, receiver: string, refund: string) {
    const scan = await this.observer.scan();
    requireThat(scan.notes.length === 0, "A fresh custody account is required");
    const genesis = String(await this.zebra.call("getblockhash", [0]));
    const rules: Terms = {
      network: "regtest", genesis, branch: NU7, stake: STAKE,
      confirmations: CONFIRMATIONS, maxFee: MAX_FEE,
      opened: scan.tip, cutoffHeight: scan.tip.height + 2,
      custody: scan.account, owner, receiver, refund,
      memo: "zyro-taz-v1:" + randomBytes(32).toString("hex"),
    };
    return this.store.atomic(async (session) => {
      requireThat(!(await this.store.markets.findOne({}, { session })), "Regtest exposure limit reached");
      await this.current(scan.tip, scan.observedAt);
      const rulesHash = digest(rules);
      await this.store.markets.insertOne({ _id: MARKET_ID, rules, rulesHash, status: "open" }, { session });
      await this.store.positions.insertOne({
        _id: MARKET_ID, marketId: MARKET_ID, owner, side: "YES", rulesHash,
        refund, payout: refund, network: "regtest", memo: rules.memo,
        requestId: MARKET_ID, status: "awaiting",
      }, { session });
      await this.store.record(session, "regtest-operator", "intent-issued", MARKET_ID, rules);
      return { rules, rulesHash };
    });
  }

  async current(tip: Block, observedAt: number) {
    const info = await this.zebra.call("getblockchaininfo") as { blocks: number; bestblockhash: string; consensus: { chaintip: string; nextblock: string } };
    requireThat(Date.now() - observedAt <= 30_000 && info.blocks === tip.height &&
      info.bestblockhash === tip.hash && info.consensus.chaintip === NU7 &&
      info.consensus.nextblock === NU7, "Stale or changed Regtest tip");
  }

  async market(session?: ClientSession) {
    const market = await this.store.markets.findOne({ _id: MARKET_ID }, { session });
    requireThat(market && market.rules.network === "regtest" &&
      market.rulesHash === digest(market.rules) && market.rules.custody === this.observer.account,
    "Missing or modified Regtest market");
    return market;
  }

  async assertCanonical(market: Market) {
    for (const block of [market.rules.opened, market.close]) {
      if (block) requireThat(await this.zebra.call("getblockhash", [block.height]) === block.hash, "Funding chain reorganized");
    }
  }

  async qualify() {
    const market = await this.market();
    const rules = market.rules;
    const scan = await this.observer.scan();
    requireThat(scan.tip.height >= rules.cutoffHeight + rules.confirmations - 1, "Waiting for confirmed cutoff");
    await this.assertCanonical(market);
    const close = { height: rules.cutoffHeight, hash: String(await this.zebra.call("getblockhash", [rules.cutoffHeight])) };
    const matched = matchIntent(scan, { network: "regtest", account: rules.custody, receiver: rules.receiver,
      memo: rules.memo, amount: rules.stake, confirmations: rules.confirmations });
    const note = scan.notes.find(({ id }) => id === matched?.outputId);
    requireThat(note && note.pool === "ironwood" && note.availability === "listed-unspent" &&
      note.block.height > rules.opened.height && note.block.height <= close.height, "No eligible Regtest deposit");
    return this.store.atomic(async (session) => {
      const current = await this.market(session);
      await this.current(scan.tip, scan.observedAt);
      if (current.status === "frozen" || current.status === "cancelled") {
        requireThat(current.frozen?.[0] === note.id && current.close?.hash === close.hash, "Frozen funding changed");
        return note.id;
      }
      requireThat(current.status === "open", "Market held for review");
      const position = await this.store.positions.findOne({ _id: MARKET_ID, status: "awaiting" }, { session });
      requireThat(position?.rulesHash === current.rulesHash && position.owner === rules.owner &&
        position.refund === rules.refund && position.memo === rules.memo, "Position terms disagree");
      await this.store.deposits.insertOne({ _id: note.id, note, marketId: MARKET_ID, positionId: MARKET_ID,
        status: "qualified", provenance: { genesis: rules.genesis, branch: scan.branch, tip: scan.tip, observedAt: scan.observedAt } }, { session });
      await this.store.positions.updateOne({ _id: MARKET_ID }, { $set: { status: "qualified" } }, { session });
      await this.store.markets.updateOne({ _id: MARKET_ID }, { $set: { status: "frozen", close, frozen: [note.id] } }, { session });
      await this.store.record(session, "regtest-observer", "funding-frozen", MARKET_ID, { close, note, scanTip: scan.tip });
      return note.id;
    });
  }

  async cancel() {
    const scan = await this.observer.scan();
    return this.store.atomic(async (session) => {
      const market = await this.market(session);
      await this.assertCanonical(market);
      await this.current(scan.tip, scan.observedAt);
      requireThat(market.frozen?.length === 1 && ["frozen", "cancelled"].includes(market.status), "No frozen Regtest position");
      const id = market.frozen[0];
      const existing = await this.store.obligations.findOne({ _id: id + ":refund" }, { session });
      if (market.status === "cancelled") {
        requireThat(existing, "Refund obligation missing");
        return existing._id;
      }
      const deposit = await this.store.deposits.findOne({ _id: id, status: "qualified", reservedBy: { $exists: false } }, { session });
      const position = await this.store.positions.findOne({ _id: MARKET_ID, status: "qualified" }, { session });
      requireThat(deposit && position && scan.notes.some(n => n.id === id && n.commitment === deposit.note.commitment &&
        n.block.hash === deposit.note.block.hash && n.availability === "listed-unspent"), "Frozen note unavailable");
      const [refund] = settlement(market, [deposit], [position]);
      requireThat(refund.kind === "refund" && refund.destination === market.rules.refund, "Refund terms disagree");
      await this.store.obligations.insertOne({ ...refund, network: "regtest", fundingHash: market.rulesHash }, { session });
      await this.store.deposits.updateOne({ _id: id }, { $set: { reservedBy: refund._id } }, { session });
      await this.store.markets.updateOne({ _id: MARKET_ID }, { $set: { status: "cancelled" } }, { session });
      await this.store.record(session, "regtest-operator", "cancelled", MARKET_ID, refund._id);
      return refund._id;
    });
  }
}
