import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Fault } from "./engine.js";
import type { ChainNetwork } from "./zcash.js";
import { inspectTransaction } from "./transaction-inspector.js";
const proto = fileURLToPath(
  new URL("../../../services/zcash/proto/service.proto", import.meta.url),
);
const definition = loadSync(proto, {
  longs: String,
  enums: String,
  bytes: Buffer,
  defaults: true,
  oneofs: true,
});
const loaded = grpc.loadPackageDefinition(definition) as any;
export const LightwalletService =
  loaded.cash.z.wallet.sdk.rpc.CompactTxStreamer;
const height = z
  .union([z.string().regex(/^\d+$/), z.number().int()])
  .transform(Number)
  .pipe(z.number().int().safe().nonnegative());
function connection(
  url = process.env.LIGHTWALLETD_URL,
  expected: ChainNetwork = (process.env.ZCASH_NETWORK ||
    "testnet") as ChainNetwork,
) {
  if (!url) throw new Fault("Lightwallet service is not configured", 503);
  if (!["testnet", "regtest"].includes(expected))
    throw new Fault("Only testnet or regtest can be configured", 503);
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Fault("Invalid lightwallet endpoint", 503);
  }
  if (
    endpoint.username ||
    endpoint.password ||
    !["https:", "http:"].includes(endpoint.protocol)
  )
    throw new Fault("Invalid lightwallet endpoint", 503);
  if (
    endpoint.protocol === "http:" &&
    !(
      expected === "regtest" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
  )
    throw new Fault("Plaintext gRPC is limited to local regtest", 503);
  const client = new LightwalletService(
    endpoint.host,
    endpoint.protocol === "https:"
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": 1024 * 1024 },
  );
  async function call(
    method: string,
    request: Record<string, unknown> = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await new Promise((resolve, reject) =>
          client[method](
            request,
            { deadline: Date.now() + 8000 },
            (error: grpc.ServiceError | null, value: unknown) =>
              error ? reject(error) : resolve(value),
          ),
        );
      } catch (e) {
        const code = (e as grpc.ServiceError).code;
        if (code === grpc.status.NOT_FOUND)
          throw new Fault(
            "Transaction not found on the lightwallet service",
            404,
          );
        if (
          attempt < 2 &&
          [grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED].includes(
            code,
          )
        ) {
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw new Fault(
          "Lightwallet connection failed; retry the connection check",
          502,
        );
      }
    }
    throw new Fault("Lightwallet unavailable", 502);
  }
  return { client, call };
}
export async function lightwalletStatus(
  url = process.env.LIGHTWALLETD_URL,
  expected: ChainNetwork = (process.env.ZCASH_NETWORK ||
    "testnet") as ChainNetwork,
) {
  const { client, call } = connection(url, expected);
  try {
    const info = z
      .object({
        chainName: z.string(),
        version: z.string(),
        vendor: z.string(),
        blockHeight: height,
        zcashdBuild: z.string().optional(),
        zcashdSubversion: z.string().optional(),
      })
      .parse(await call("getLightdInfo"));
    if (["main", "mainnet"].includes(info.chainName))
      throw new Fault("Mainnet lightwallet service refused", 503);
    const network = ["test", "testnet"].includes(info.chainName)
      ? "testnet"
      : info.chainName === "regtest"
        ? "regtest"
        : null;
    if (network !== expected)
      throw new Fault("Lightwallet service network mismatch", 503);
    const latest = z
      .object({ height, hash: z.instanceof(Buffer) })
      .parse(await call("getLatestBlock"));
    return {
      connected: true,
      provider: "lightwalletd",
      network,
      reportedChain: info.chainName,
      height: latest.height,
      reportedHeight: info.blockHeight,
      blockHash: Buffer.from(latest.hash).reverse().toString("hex"),
      software: {
        version: info.version,
        vendor: info.vendor,
        nodeBuild: info.zcashdBuild || null,
        nodeSubversion: info.zcashdSubversion || null,
      },
      checkedAt: new Date().toISOString(),
      trust:
        "Remote lightwallet service observation; not independently verified consensus or deposit evidence.",
    };
  } finally {
    client.close();
  }
}
export async function observeLightwalletTransaction(
  txid: string,
  url = process.env.LIGHTWALLETD_URL,
  expected: ChainNetwork = (process.env.ZCASH_NETWORK ||
    "testnet") as ChainNetwork,
  inspector = inspectTransaction,
) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(txid);
  if (expected !== "testnet")
    throw new Fault(
      "Lightwallet transaction decoding currently supports public testnet only; use JSON-RPC for regtest",
      503,
    );
  const { client, call } = connection(url, expected);
  try {
    const info = z
      .object({ chainName: z.string() })
      .parse(await call("getLightdInfo"));
    if (["main", "mainnet"].includes(info.chainName))
      throw new Fault("Mainnet lightwallet service refused", 503);
    if (!["test", "testnet"].includes(info.chainName))
      throw new Fault("Lightwallet service network mismatch", 503);
    const raw = z
      .object({ data: z.instanceof(Buffer), height: z.string().regex(/^\d+$/) })
      .parse(
        await call("getTransaction", {
          hash: Buffer.from(txid, "hex").reverse(),
        }),
      );
    const rawHeight = BigInt(raw.height);
    const minedHeight =
      rawHeight > 0n && rawHeight <= 0xffffffffn ? Number(rawHeight) : null;
    const decoded = await inspector({
      network: "testnet",
      txHex: raw.data.toString("hex"),
      height: minedHeight,
    });
    if (decoded.txid !== txid)
      throw new Fault(
        "Decoded transaction ID does not match requested ID",
        502,
      );
    const tip = z.object({ height }).parse(await call("getLatestBlock"));
    if (minedHeight !== null && minedHeight > tip.height)
      throw new Fault(
        "Service returned a transaction above its chain tip",
        502,
      );
    let blockhash: string | null = null;
    if (minedHeight !== null) {
      const block = z
        .object({
          height,
          hash: z.instanceof(Buffer),
          vtx: z.array(z.object({ txid: z.instanceof(Buffer) })),
        })
        .parse(await call("getBlock", { height: String(minedHeight) }));
      if (
        block.height !== minedHeight ||
        !block.vtx.some((t) =>
          t.txid.equals(Buffer.from(txid, "hex").reverse()),
        )
      )
        throw new Fault(
          "Transaction is absent from its reported compact block",
          502,
        );
      blockhash = Buffer.from(block.hash).reverse().toString("hex");
    }
    const confirmations =
      minedHeight === null ? 0 : tip.height - minedHeight + 1;
    return {
      txid,
      provider: "lightwalletd",
      network: "testnet" as const,
      reportedChain: info.chainName,
      confirmations,
      state:
        confirmations >= 3
          ? "CONFIRMED"
          : confirmations > 0
            ? "CONFIRMING"
            : "MEMPOOL",
      checkedAt: new Date().toISOString(),
      blockhash,
      minedHeight,
      chainHeight: tip.height,
      decoded,
      fundingVerified: false,
      notice:
        "Transaction bytes decoded and txid checked with librustzcash; inclusion and confirmations reported by a remote lightwallet service. No recipient, amount or market funding proof.",
    };
  } finally {
    client.close();
  }
}
