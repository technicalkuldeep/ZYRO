import { mkdirSync, writeFileSync } from "node:fs";
import { observeLightwalletTransaction } from "../apps/api/src/lightwallet.js";
import { observeTransaction } from "../apps/api/src/zcash.js";
const txid = process.argv[2];
if (!txid) throw new Error("Usage: npm run chain:observe -- TESTNET_TXID");
const result = process.env.ZCASH_RPC_URL
  ? await observeTransaction(txid)
  : await observeLightwalletTransaction(txid);
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/transaction-evidence-" + txid + ".json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
