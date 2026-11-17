import { mkdirSync, writeFileSync } from "node:fs";
import { chainStatus } from "../apps/api/src/zcash.js";
import { lightwalletStatus } from "../apps/api/src/lightwallet.js";
const status = process.env.ZCASH_RPC_URL
  ? await chainStatus()
  : await lightwalletStatus();
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/chain-evidence.json",
  JSON.stringify(status, null, 2) + "\n",
);
console.log(JSON.stringify(status, null, 2));
