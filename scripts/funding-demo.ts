// Opt-in live testnet demo. Both participant sessions and the wallet are controlled by this developer.
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { acceptanceMessage } from "@zyro/shared";
if (process.env.ZYRO_RUN_WALLET_DEMO !== "1")
  throw new Error(
    "Set ZYRO_RUN_WALLET_DEMO=1 to explicitly authorize two valueless testnet payments. Never run against production.",
  );
const evidencePath = ".local/funding-demo.json";
if (existsSync(evidencePath))
  throw new Error(
    "A demo journal already exists. Inspect it before starting another run; sends are never automatically retried.",
  );
const base = "http://127.0.0.1:4000/api";
type Guest = { id: string; cookie: string };
async function api(path: string, guest?: Guest, body?: unknown) {
  const response = await fetch(base + path, {
    headers: {
      ...(guest ? { Cookie: guest.cookie } : {}),
      ...(body
        ? {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1:3000",
            "X-Zyro-Client": "web",
          }
        : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const value = (await response.json()) as any;
  if (!response.ok) throw new Error(value.error || "API request failed");
  return { response, value };
}
async function guest(): Promise<Guest> {
  const { response, value } = await api("/session");
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
  if (!cookie) throw new Error("Guest cookie missing");
  return { id: value.id, cookie };
}
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
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (c) => {
      output += c.toString();
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              "Wallet operation failed; inspect local state before any retry. " +
                output.slice(-500),
            ),
          ),
    );
  });
}
const a = await guest(),
  b = await guest();
const { value: market } = await api("/markets", a, {
  question: "Will the ZYRO public testnet funding demonstration complete?",
  description:
    "Developer-operated testnet demonstration: two guest participants fund an explicitly developer-custodied wallet. This is not FROST escrow and has no automatic settlement.",
  category: "Zcash",
  stake: 1000000,
  fundingDeadline: new Date(Date.now() + 3600000).toISOString(),
  resolutionDeadline: new Date(Date.now() + 7200000).toISOString(),
  source: "https://github.com/technicalkuldeep/ZYRO",
  rules:
    "YES if both shielded testnet notes are recognized with the exact reference and stake; otherwise NO. No automatic payout or refund.",
});
for (const [g, side] of [
  [a, "YES"],
  [b, "NO"],
] as const) {
  const keys = generateKeyPairSync("ed25519");
  await api("/markets/" + market.id + "/join", g, {
    side,
    publicKey: keys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    signature: sign(
      null,
      Buffer.from(acceptanceMessage(market.agreementHash, g.id, side)),
      keys.privateKey,
    ).toString("base64"),
  });
}
const evidence: {
  network: string;
  custody: string;
  marketId: string;
  checkedAt: string;
  payments: any[];
  settlementExecuted: boolean;
} = {
  network: "testnet",
  custody:
    "Developer operates both guest participants and the local wallet; not independent escrow",
  marketId: market.id,
  checkedAt: new Date().toISOString(),
  payments: [],
  settlementExecuted: false,
};
mkdirSync(".local", { recursive: true });
const save = () =>
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
save();
console.log("Matched public testnet demo challenge " + market.id);
for (const [g, side] of [
  [a, "YES"],
  [b, "NO"],
] as const) {
  const { value: intent } = await api(
    "/markets/" + market.id + "/funding-intent",
    g,
    {},
  );
  if (!intent.recipient?.startsWith("utest1"))
    throw new Error("No shielded testnet demo receiver configured");
  const payment: any = {
    side,
    reference: intent.reference,
    recipient: intent.recipient,
    amountZatoshis: intent.expectedZatoshis,
    status: "ABOUT_TO_SEND",
  };
  evidence.payments.push(payment);
  save();
  await wallet(["sync"]);
  console.log(
    "Constructing " +
      side +
      " shielded testnet payment; do not retry an uncertain broadcast.",
  );
  const output = await wallet([
    "send",
    intent.recipient,
    String(intent.expectedZatoshis),
    intent.reference,
  ]);
  const txid = output.match(/^[a-f0-9]{64}$/m)?.[0];
  if (!txid)
    throw new Error(
      "Wallet did not return a txid; inspect wallet history before retrying",
    );
  payment.txid = txid;
  payment.status = "BROADCAST";
  save();
  console.log(side + " broadcast " + txid);
  await api("/markets/" + market.id + "/funding-claim", g, { txid });
  for (let attempt = 0; attempt < 40; attempt++) {
    await wallet(["sync"]);
    let result: any;
    try {
      result = (await api("/markets/" + market.id + "/funding-recheck", g, {}))
        .value;
    } catch (e) {
      if (!(e as Error).message.includes("not recognized")) throw e;
    }
    if (result) {
      payment.recognition = result;
      payment.status = result.state;
      save();
      if (result.state === "CONFIRMED") break;
      if (result.state !== "PENDING")
        throw new Error("Unexpected funding state " + result.state);
    }
    if (attempt === 39)
      throw new Error(
        "Confirmation wait expired; payments may still confirm. Inspect journal before retrying.",
      );
    console.log(side + " waiting for recognized note / three confirmations");
    await delay(15000);
  }
  const repeated = (
    await api("/markets/" + market.id + "/funding-recheck", g, {})
  ).value;
  if (repeated.receivedZatoshis !== intent.expectedZatoshis)
    throw new Error("Duplicate processing changed accounting");
  payment.duplicateRecheckVerified = true;
  save();
}
evidence.checkedAt = new Date().toISOString();
save();
console.log(
  "PASS: both actual shielded testnet notes recognized; duplicate processing did not double-credit. Escrow and settlement remain disabled.",
);
