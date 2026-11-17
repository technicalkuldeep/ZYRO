import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { walletDatabaseSource } from "../apps/api/src/demo-wallet";
import type { FundingIntent } from "../apps/api/src/funding";
it("recognizes only exact memo, recipient, transaction and external-scope notes from a read-only wallet snapshot", async () => {
  mkdirSync(".local", { recursive: true });
  const file = ".local/fixture-wallet-" + randomUUID() + ".sqlite";
  const db = new DatabaseSync(file);
  const txid = "d".repeat(64);
  const reference = "ZYRO:1:fixture:YES:unique-reference";
  const recipient = "utest1-fixture";
  try {
    db.exec(
      "CREATE TABLE transactions(id_tx INTEGER,txid BLOB);CREATE TABLE addresses(id INTEGER,address TEXT);CREATE TABLE sent_notes(transaction_id INTEGER,output_pool INTEGER,output_index INTEGER,to_address TEXT,value INTEGER,memo BLOB);",
    );
    for (const pool of ["orchard", "ironwood", "sapling"])
      db.exec(
        `CREATE TABLE ${pool}_received_notes(transaction_id INTEGER,address_id INTEGER,${pool === "sapling" ? "output_index" : "action_index"} INTEGER,value INTEGER,memo BLOB,recipient_key_scope INTEGER)`,
      );
    db.prepare("INSERT INTO transactions VALUES(?,?)").run(
      1,
      Buffer.from(txid, "hex").reverse(),
    );
    db.prepare("INSERT INTO addresses VALUES(?,?)").run(1, recipient);
    const memo = Buffer.alloc(512);
    Buffer.from(reference).copy(memo);
    db.prepare("INSERT INTO ironwood_received_notes VALUES(?,?,?,?,?,?)").run(
      1,
      1,
      2,
      1000000,
      memo,
      0,
    );
    const intent: FundingIntent = {
      id: "fixture",
      marketId: "fixture",
      userId: "fixture",
      side: "YES",
      network: "testnet",
      agreementHash: "fixture",
      reference,
      expectedZatoshis: 1000000,
      recipient,
      state: "SUBMITTED_UNVERIFIED",
      txid,
      receivedZatoshis: 0,
      confirmations: 0,
    };
    const source = walletDatabaseSource(file, recipient);
    expect(await source(intent)).toMatchObject({
      pool: "ironwood",
      outputIndex: 2,
      amountZatoshis: 1000000,
      memo: reference,
    });
    await expect(source({ ...intent, reference: "wrong" })).rejects.toThrow(
      "not recognized",
    );
    await expect(source({ ...intent, recipient: "wrong" })).rejects.toThrow(
      "configuration mismatch",
    );
    db.exec("UPDATE ironwood_received_notes SET memo=NULL");
    db.prepare("INSERT INTO sent_notes VALUES(?,?,?,?,?,?)").run(
      1,
      4,
      2,
      recipient,
      1000000,
      Buffer.from(reference),
    );
    expect((await source(intent)).amountZatoshis).toBe(1000000);
    db.exec("UPDATE ironwood_received_notes SET recipient_key_scope=1");
    await expect(source(intent)).rejects.toThrow("not recognized");
  } finally {
    db.close();
    unlinkSync(file);
  }
});
