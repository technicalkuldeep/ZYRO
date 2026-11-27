import {
  digest,
  NETWORK,
  STAKE,
  type Note,
  type Rules,
  type Scan,
} from "../apps/api/src/taz-markets/model.js";
export const closesAt = 119_000;
export const fixtureRules: Rules = {
  version: 1,
  network: NETWORK,
  pair: "BTC-USD",
  provider: "Coinbase Exchange",
  comparison: "GT",
  equality: "NO",
  stake: STAKE,
  thresholdUnits: "10000000000",
  candleStart: 120,
  closesAt,
  cutoffGraceMs: 1_000,
  confirmations: 2,
};
export const block = (height: number, branch = "fixture") => ({
  height,
  hash: digest([height, branch]),
});
export const token = "a-disposable-fixture-operator-credential";
export const recipient = "fixture-utest-receive";
export const change = "fixture-utest-change";
export const walletId = "fixture-wallet";
export const candle = (close: number) => [[120, 90, 110, 100, close, 1]];
export function received(memo = "fixture-memo", mod: Partial<Note> = {}): Note {
  return {
    txid: digest(memo),
    index: 0,
    pool: "ironwood",
    commitment: digest([memo]),
    walletId,
    network: NETWORK,
    recipient,
    memo,
    amount: STAKE,
    block: block(7),
    spendable: true,
    role: "deposit",
    ...mod,
  };
}
export function snapshot(
  observedAt: number,
  head: number,
  notes: Note[],
): Scan {
  return {
    network: NETWORK,
    walletId,
    observedAt,
    tip: block(head),
    scanned: block(head),
    notes,
    blocks: Array.from({ length: head + 1 }, (_, i) => block(i)),
  };
}
