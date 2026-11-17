// Local operator recovery only. Never repeats an uncertain send, never fabricates a wallet receipt.
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Market } from "@zyro/shared";
import { Store } from "../apps/api/src/store.js";
import { FundingService } from "../apps/api/src/funding.js";
import { demoWalletConfig } from "../apps/api/src/demo-wallet.js";
if (process.env.ZYRO_RUN_WALLET_DEMO !== "1")
  throw new Error(
    "Explicit ZYRO_RUN_WALLET_DEMO=1 authorization is required for local demo recovery.",
  );
const config = demoWalletConfig();
if (!config) throw new Error("Opt-in demo wallet is not configured");
const path = ".local/funding-demo.json";
const journal = JSON.parse(readFileSync(path, "utf8"));
const save = () => writeFileSync(path, JSON.stringify(journal, null, 2) + "\n");
const store = new Store("apps/api/data/zyro.sqlite");
await store.init();
const service = new FundingService(
  store,
  undefined,
  config.source,
  "testnet",
  config.recipient,
);
async function wallet(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "wsl.exe",
      [
        "-d",
        "Ubuntu-24.04",
        "--exec",
        "bash",
        "/mnt/d/ZYRO/scripts/testnet-wallet.sh",
        ...args,
      ],
      {
        shell: false,
        windowsHide: true,
        env: { ...process.env, RUST_LOG: "off" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              "Wallet command failed; inspect state before retry: " +
                out.slice(-500),
            ),
          ),
    );
  });
}
try {
  const market = await store.get<Market>(journal.marketId);
  if (!market || market.network !== "testnet")
    throw new Error("No matching public-testnet challenge");
  for (const side of ["YES", "NO"] as const) {
    const participant = market.participants.find((p) => p.side === side);
    if (!participant) throw new Error("Missing accepted participant");
    const intent = await service.intent(participant.userId, market.id);
    let payment = journal.payments.find((p: any) => p.side === side);
    if (!payment) {
      payment = {
        side,
        reference: intent.reference,
        recipient: intent.recipient,
        amountZatoshis: intent.expectedZatoshis,
        status: "ABOUT_TO_SEND",
      };
      journal.payments.push(payment);
      save();
      await wallet(["sync"]);
      console.log("Constructing " + side + " testnet payment");
      const output = await wallet([
        "send",
        config.recipient,
        String(intent.expectedZatoshis),
        intent.reference,
      ]);
      payment.txid = output.match(/^[a-f0-9]{64}$/m)?.[0];
      if (!payment.txid)
        throw new Error(
          "No txid returned. Do not retry; inspect wallet history.",
        );
      payment.status = "BROADCAST";
      save();
      console.log(side + " broadcast " + payment.txid);
    }
    if (!payment.txid)
      throw new Error(
        "Uncertain prior send. Inspect wallet history; automatic resend refused.",
      );
    if (
      payment.reference !== intent.reference ||
      payment.recipient !== intent.recipient
    )
      throw new Error("Journal differs from persisted intent");
    await service.claim(participant.userId, market.id, payment.txid);
    for (let attempt = 0; attempt < 40; attempt++) {
      await wallet(["sync"]);
      let recognized;
      try {
        recognized = await service.verify(participant.userId, market.id);
      } catch (e) {
        if (!(e as Error).message.includes("not recognized")) throw e;
      }
      if (recognized) {
        payment.recognition = recognized;
        payment.status = recognized.state;
        save();
        if (recognized.state === "CONFIRMED") break;
        if (recognized.state !== "PENDING")
          throw new Error("Funding requires review: " + recognized.state);
      }
      if (attempt === 39)
        throw new Error("Timed out waiting; resume checks only, never resend.");
      console.log(side + " waiting for note recognition / three confirmations");
      await delay(15000);
    }
    const duplicate = await service.verify(participant.userId, market.id);
    if (duplicate.receivedZatoshis !== intent.expectedZatoshis)
      throw new Error("Duplicate accounting inconsistency");
    payment.duplicateRecheckVerified = true;
    save();
  }
  journal.checkedAt = new Date().toISOString();
  save();
  console.log(
    "PASS: both actual testnet notes recognized exactly once; threshold authorization and settlement remain disabled.",
  );
} finally {
  await store.close();
}
