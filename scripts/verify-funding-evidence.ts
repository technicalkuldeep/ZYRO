// Read-only recheck of the historical developer-custodied funding demonstration.
import { readFileSync, writeFileSync } from "node:fs";
import { demoWalletConfig } from "../apps/api/src/demo-wallet.js";
import { observeLightwalletTransaction } from "../apps/api/src/lightwallet.js";
import type { FundingIntent } from "../apps/api/src/funding.js";
const config = demoWalletConfig();
if (!config)
  throw new Error("Opt-in developer demo wallet configuration required");
const previous = JSON.parse(
  readFileSync("docs/evidence/market-funding.json", "utf8"),
) as {
  marketId: string;
  payments: { recognition: FundingIntent; txid: string; side: string }[];
};
const payments = [];
for (const payment of previous.payments) {
  const note = await config.source(payment.recognition);
  const chain = await observeLightwalletTransaction(payment.txid);
  if (
    chain.state !== "CONFIRMED" ||
    note.amountZatoshis !== payment.recognition.expectedZatoshis
  )
    throw new Error(
      "Historical funding no longer satisfies confirmed exact-amount checks",
    );
  payments.push({
    side: payment.side,
    txid: payment.txid,
    amountZatoshis: note.amountZatoshis,
    pool: note.pool,
    outputIndex: note.outputIndex,
    minedHeight: chain.minedHeight,
    confirmations: chain.confirmations,
    checkedAt: chain.checkedAt,
    exactWalletReceiverAndMemoRecognized: true,
  });
}
const receipt = {
  network: "testnet",
  marketId: previous.marketId,
  custody: "Existing developer wallet, not threshold custody",
  payments,
  thresholdSettlementExecuted: false,
};
writeFileSync(
  ".local/funding-recheck-phase3.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
