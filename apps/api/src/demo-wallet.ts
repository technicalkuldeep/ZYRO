import { DatabaseSync } from "node:sqlite";
import type {
  FundingIntent,
  WalletReceiptSource,
  RecognizedNote,
} from "./funding.js";
import { Fault } from "./engine.js";
export function demoWalletConfig() {
  if (process.env.ZYRO_CUSTODIAL_DEMO !== "1") return null;
  if (
    process.env.NODE_ENV === "production" ||
    (process.env.ZCASH_NETWORK || "testnet") !== "testnet"
  )
    throw new Error(
      "Developer-custodied wallet recognition is restricted to non-production public testnet",
    );
  const path = process.env.ZCASH_DEMO_WALLET_DB;
  const recipient = process.env.ZCASH_DEMO_RECEIVER;
  if (!path || !recipient?.startsWith("utest1"))
    throw new Error(
      "Demo wallet database and a known shielded testnet receiver must be configured",
    );
  return { recipient, source: walletDatabaseSource(path, recipient) };
}
// Read only notes already decrypted/recognized by pinned librustzcash through the CLI wallet.
// Never opens identity.txt or keys.toml. This is a developer-custodied testnet boundary.
export function walletDatabaseSource(
  path: string,
  recipient: string,
): WalletReceiptSource {
  return async (intent: FundingIntent) => {
    if (
      intent.network !== "testnet" ||
      intent.recipient !== recipient ||
      !intent.txid
    )
      throw new Fault("Demo wallet intent configuration mismatch", 409);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(path, { readOnly: true });
    } catch {
      throw new Fault("Demo wallet recognition database is unavailable", 503);
    }
    try {
      const memo = Buffer.from(intent.reference, "utf8");
      if (memo.length > 512) throw new Fault("Invalid funding reference", 400);
      const notes: RecognizedNote[] = [];
      for (const pool of ["orchard", "ironwood", "sapling"] as const) {
        const table = pool + "_received_notes";
        const index = pool === "sapling" ? "output_index" : "action_index";
        const rows = db
          .prepare(
            `SELECT n.${index} AS output_index,n.value,COALESCE(n.memo,s.memo) AS memo,a.address FROM ${table} n JOIN transactions t ON t.id_tx=n.transaction_id JOIN addresses a ON a.id=n.address_id LEFT JOIN sent_notes s ON s.transaction_id=n.transaction_id AND s.output_pool=? AND s.output_index=n.${index} AND s.to_address=a.address AND s.value=n.value WHERE t.txid=? AND a.address=? AND n.recipient_key_scope=0`,
          )
          .all({sapling:2,orchard:3,ironwood:4}[pool],Buffer.from(intent.txid, "hex").reverse(), recipient);
        for (const row of rows) {
          if (
            !(row.memo instanceof Uint8Array)
          )
            continue;
          // Wallet storage may trim the on-chain memo's zero padding. Self-payments
          // may classify as change and retain the exact memo in sent_notes instead.
          // Require a recognized external-scope note, exact receiver/value join and exact memo.
          const stored=Buffer.from(row.memo);
          if(stored.length<memo.length||stored.length>512||!stored.subarray(0,memo.length).equals(memo)||stored.subarray(memo.length).some(v=>v!==0))continue;
          const amount = Number(row.value);
          if (!Number.isSafeInteger(amount) || amount <= 0)
            throw new Fault("Wallet returned an unsafe amount", 502);
          notes.push({
            txid: intent.txid,
            network: "testnet",
            pool,
            outputIndex: Number(row.output_index),
            amountZatoshis: amount,
            recipient,
            memo: intent.reference,
          });
        }
      }
      if (notes.length !== 1)
        throw new Fault(
          notes.length
            ? "Multiple notes match this funding reference; manual review is required"
            : "Wallet has not recognized an exact matching note; synchronize the local wallet",
          409,
        );
      return notes[0];
    } catch (e) {
      if (e instanceof Fault) throw e;
      throw new Fault(
        "Unsupported wallet database schema or unavailable snapshot",
        503,
      );
    } finally {
      db.close();
    }
  };
}
