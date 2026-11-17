import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Fault } from "./engine.js";
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
export type ChainNetwork = "testnet" | "regtest";
export type RpcOptions = {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
  username?: string;
  password?: string;
};
const readMethods = new Set([
  "getblockchaininfo",
  "getnetworkinfo",
  "getblockhash",
  "getrawtransaction",
]);
export function rpcClient(
  url = process.env.ZCASH_RPC_URL,
  options: RpcOptions = {},
): Rpc {
  return async (method, params) => {
    if (!url) throw new Fault("Testnet/regtest node is not configured", 503);
    if (!readMethods.has(method))
      throw new Fault("RPC method is not permitted", 403);
    let endpoint: URL;
    try {
      endpoint = new URL(url);
    } catch {
      throw new Fault("Invalid RPC URL configuration", 503);
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new Fault("Invalid RPC URL configuration", 503);
    const username = options.username ?? process.env.ZCASH_RPC_USER;
    const password = options.password ?? process.env.ZCASH_RPC_PASSWORD;
    const attempts = Math.max(1, Math.min(options.attempts ?? 3, 4));
    for (let attempt = 0; attempt < attempts; attempt++) {
      const id = randomUUID();
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(username && password
              ? {
                  Authorization:
                    "Basic " +
                    Buffer.from(username + ":" + password).toString("base64"),
                }
              : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
          redirect: "error",
        });
      } catch {
        if (attempt + 1 < attempts) {
          await delay((options.retryDelayMs ?? 250) * 2 ** attempt);
          continue;
        }
        throw new Fault(
          "Node connection failed or timed out; retry the observation",
          502,
        );
      }
      if (
        [429, 502, 503, 504].includes(response.status) &&
        attempt + 1 < attempts
      ) {
        await response.body?.cancel();
        await delay((options.retryDelayMs ?? 250) * 2 ** attempt);
        continue;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Fault("Node returned an invalid RPC response", 502);
      }
      const envelope = z
        .object({
          id: z.string(),
          result: z.unknown().optional(),
          error: z
            .object({ code: z.number(), message: z.string() })
            .nullable()
            .optional(),
        })
        .safeParse(body);
      if (!envelope.success || envelope.data.id !== id)
        throw new Fault(
          "Node returned an invalid RPC response identifier",
          502,
        );
      if (envelope.data.error) {
        if (envelope.data.error.code === -5)
          throw new Fault("Transaction not found on the configured node", 404);
        throw new Fault("Node rejected the read-only RPC request", 502);
      }
      if (!response.ok) throw new Fault("Node RPC request failed", 502);
      return envelope.data.result;
    }
    throw new Fault("Node unavailable", 502);
  };
}
export async function assertNetwork(
  rpc: Rpc,
  expected: ChainNetwork = (process.env.ZCASH_NETWORK ||
    "testnet") as ChainNetwork,
) {
  if (!["testnet", "regtest"].includes(expected))
    throw new Fault("Only testnet or regtest can be configured", 503);
  const info = z
    .object({ chain: z.string() })
    .passthrough()
    .parse(await rpc("getblockchaininfo", []));
  if (["main", "mainnet"].includes(info.chain))
    throw new Fault("Mainnet node refused", 503);
  const reported =
    info.chain === "test" || info.chain === "testnet"
      ? "testnet"
      : info.chain === "regtest"
        ? "regtest"
        : null;
  const genesis = process.env.ZCASH_GENESIS_HASH;
  if (genesis) {
    if (!/^[a-f0-9]{64}$/.test(genesis))
      throw new Fault("Invalid configured genesis fingerprint", 503);
    if ((await rpc("getblockhash", [0])) !== genesis)
      throw new Fault("Node genesis fingerprint mismatch", 503);
  }
  // Zebra versions reporting regtest as "test" require an independently pinned genesis.
  if (
    reported !== expected &&
    !(expected === "regtest" && reported === "testnet" && genesis)
  )
    throw new Fault("Configured network does not match the node", 503);
  return { info, network: expected };
}
export async function chainStatus(
  rpc: Rpc = rpcClient(),
  expected?: ChainNetwork,
) {
  const { info, network } = await assertNetwork(rpc, expected);
  const chain = z
    .object({
      blocks: z.number().int().nonnegative().safe(),
      headers: z.number().int().nonnegative().safe().optional(),
      verificationprogress: z.number().min(0).max(1).optional(),
      initial_block_download_complete: z.boolean().optional(),
    })
    .parse(info);
  let software: unknown = null;
  try {
    software = z
      .object({
        version: z.number().optional(),
        subversion: z.string().optional(),
      })
      .parse(await rpc("getnetworkinfo", []));
  } catch {
    /* Unsupported optional RPC: do not invent a software version. */
  }
  return {
    connected: true,
    provider: "json-rpc",
    network,
    reportedChain: info.chain,
    height: chain.blocks,
    headers: chain.headers ?? null,
    syncProgress: chain.verificationprogress ?? null,
    syncComplete: chain.initial_block_download_complete ?? null,
    software,
    checkedAt: new Date().toISOString(),
  };
}
export async function observeTransaction(
  txid: string,
  rpc: Rpc = rpcClient(),
  expected?: ChainNetwork,
) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(txid);
  const { info, network } = await assertNetwork(rpc, expected);
  const tx = z
    .object({
      txid: z.string(),
      confirmations: z.number().int().safe().optional().default(0),
      blockhash: z.string().optional(),
    })
    .parse(await rpc("getrawtransaction", [txid, 1]));
  if (tx.txid !== txid)
    throw new Fault("Node returned a different transaction", 502);
  return {
    txid,
    network,
    reportedChain: info.chain,
    confirmations: Math.max(0, tx.confirmations),
    state:
      tx.confirmations < 0
        ? "CONFLICTED"
        : tx.confirmations >= 3
          ? "CONFIRMED"
          : tx.confirmations > 0
            ? "CONFIRMING"
            : "MEMPOOL",
    checkedAt: new Date().toISOString(),
    blockhash: tx.blockhash || null,
    fundingVerified: false,
    notice:
      "Chain observation only. This does not prove recipient, amount, shielded ownership, or market funding.",
  };
}
