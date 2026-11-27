/** Private local operator CLI. No API route imports this module. */
import { readFile, stat } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { TazStore } from "../store.js";
import { hex, requireThat } from "../model.js";
import { LiveCustodyAdapter } from "./adapter.js";
import { ObservationRpc } from "./rpc.js";
import { RegtestLedger, type RegtestStore } from "./regtest-ledger.js";
import { RegtestSigner } from "./regtest-signer.js";
import { assertIsolatedSignerIdentity, operatorKeyFingerprint } from "./operator-auth.js";

const endpoint = z.object({ url: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/), cookie: z.string().min(1) });
const configuration = z.object({
  mongo: z.string().regex(/^mongodb:\/\/[^/@]+@127\.0\.0\.1:[0-9]+\/\?replicaSet=[a-zA-Z0-9]+&authSource=admin$/),
  zebra: endpoint, custody: endpoint, payer: endpoint,
  payerAccount: z.string().uuid(), verifier: z.string(), custodyDb: z.string(),
  operatorAccount: z.string().uuid(),
  operatorPublicKey: z.string().min(1),
  operatorUid: z.number().int().nonnegative(),
  apiUid: z.number().int().nonnegative(),
});

async function privateFile(path: string) {
  const info = await stat(path);
  requireThat(info.isFile() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0,
    "Operator configuration must be owner-only");
  return readFile(path, "utf8");
}

type Endpoint = z.infer<typeof endpoint>;
async function rpc<T>(service: Endpoint, method: string, params: unknown[] = []): Promise<T> {
  const cookie = (await privateFile(service.cookie)).trim();
  const response = await fetch(service.url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(cookie).toString("base64") },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json() as { id: number; error?: { code: number }; result?: T };
  requireThat(response.ok && data.id === 1 && !data.error && data.result !== undefined,
    method + " failed (" + (data.error?.code ?? response.status) + ")");
  return data.result;
}

async function main() {
  const [file, action, argument, signatureFile] = process.argv.slice(2);
  requireThat(file && action, "Expected private config and operator action");
  const config = configuration.parse(JSON.parse(await privateFile(file)));
  assertIsolatedSignerIdentity(config.operatorUid, config.apiUid, process.getuid?.());
  operatorKeyFingerprint(config.operatorPublicKey);
  const zebra = new ObservationRpc("zebra", config.zebra.url, config.zebra.cookie);
  const wallet = new ObservationRpc("zallet", config.custody.url, config.custody.cookie);
  const payerWallet = new ObservationRpc("zallet", config.payer.url, config.payer.cookie);
  const accounts = z.array(z.object({ account_uuid: z.string().uuid() })).parse(await wallet.call("z_listaccounts", [false]));
  const [custody] = accounts;
  requireThat(custody && accounts.length === 1, "Dedicated single-account custody wallet required");
  const observer = new LiveCustodyAdapter("regtest", custody.account_uuid, 2, zebra, wallet);
  const payerObserver = new LiveCustodyAdapter("regtest", config.payerAccount, 2, zebra, payerWallet);
  const client = new MongoClient(config.mongo, { serverSelectionTimeoutMS: 5000 });
  const store: RegtestStore = new TazStore(client, client.db("zyro_taz_regtest"), "regtest");
  const ledger = new RegtestLedger(store, observer, zebra);
  const signer = new RegtestSigner(ledger, payerObserver,
    (method, params) => rpc(config.zebra, method, params),
    (method, params) => rpc(config.custody, method, params),
    (method, params) => rpc(config.payer, method, params),
    config.custodyDb, config.verifier, config.operatorAccount, config.operatorPublicKey);
  try {
    await store.init();
    if (action === "issue") {
      await payerObserver.scan();
      const receiver = await rpc<{ address: string }>(config.custody, "z_getaddressforaccount", [custody.account_uuid, ["orchard"]]);
      const refund = await rpc<{ address: string }>(config.payer, "z_getaddressforaccount", [config.payerAccount, ["orchard"]]);
      requireThat(receiver.address.startsWith("uregtest1") && refund.address.startsWith("uregtest1") &&
        receiver.address !== refund.address, "Reviewed Regtest addresses required");
      return await ledger.issue(config.payerAccount, receiver.address, refund.address);
    }
    if (action === "qualify") return await ledger.qualify();
    if (action === "cancel") return await ledger.cancel();
    if (action === "intent") {
      const market = await ledger.market();
      return { rules: market.rules, rulesHash: market.rulesHash, close: market.close };
    }
    requireThat(!argument || hex(argument), "Invalid digest");
    if (action === "prepare") return await signer.prepare();
    if (action === "approve" && argument && signatureFile) {
      const signature = (await privateFile(signatureFile)).trim();
      return await signer.approve(argument, signature);
    }
    if (action === "sign") return await signer.sign();
    if (action === "extract") return await signer.extract();
    if (action === "broadcast") return await signer.broadcast();
    if (action === "reconcile") return await signer.reconcile();
    throw new Error("Unknown private operator action");
  } finally {
    await client.close();
  }
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Regtest operator action failed");
  process.exitCode = 1;
}
