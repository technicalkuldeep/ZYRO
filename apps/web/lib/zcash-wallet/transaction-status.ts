import * as grpc from "@grpc/grpc-js";
import { fromJSON } from "@grpc/proto-loader";
import schema from "./lightwalletd.json";
// Generated without changes from services/zcash/proto/{service,compact_formats}.proto.
// JSON avoids runtime filesystem imports in Next's bundled route handlers.
const definition = fromJSON(
  schema as unknown as Parameters<typeof fromJSON>[0],
  { longs: String, enums: String, bytes: Buffer, defaults: true, oneofs: true },
);
const Service = (grpc.loadPackageDefinition(definition) as any).cash.z.wallet
  .sdk.rpc.CompactTxStreamer;
export type TransactionStatus = {
  txid: string;
  network: "testnet";
  state: "pending" | "confirming" | "confirmed" | "not-found";
  confirmations: number;
  minedHeight?: number;
  chainHeight?: number;
  checkedAt: string;
};
// Public chain metadata only. No wallet keys, memo, address, or private balance.
export async function observeWalletTransaction(
  txid: string,
): Promise<TransactionStatus> {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw Error("Invalid transaction ID");
  const client = new Service(
    "testnet.zec.rocks:443",
    grpc.credentials.createSsl(),
    { "grpc.max_receive_message_length": 8 * 1024 * 1024 },
  );
  const deadline = Date.now() + 8000;
  const call = (method: string, payload: unknown = {}) =>
    new Promise<any>((resolve, reject) =>
      client[method](
        payload,
        { deadline },
        (error: grpc.ServiceError | null, response: unknown) =>
          error ? reject(error) : resolve(response),
      ),
    );
  try {
    const info = await call("getLightdInfo");
    if (!["test", "testnet"].includes(info.chainName))
      throw Error("Testnet service identity mismatch");
    const hash = Buffer.from(txid, "hex").reverse();
    let raw;
    try {
      raw = await call("getTransaction", { hash });
    } catch (error) {
      if ((error as grpc.ServiceError).code === grpc.status.NOT_FOUND)
        return {
          txid,
          network: "testnet",
          state: "not-found",
          confirmations: 0,
          checkedAt: new Date().toISOString(),
        };
      throw error;
    }
    const mined = BigInt(raw.height);
    if (mined <= 0n || mined > 0xffffffffn)
      return {
        txid,
        network: "testnet",
        state: "pending",
        confirmations: 0,
        checkedAt: new Date().toISOString(),
      };
    const [tip, block] = await Promise.all([
      call("getLatestBlock"),
      call("getBlock", { height: String(mined) }),
    ]);
    const chainHeight = Number(tip.height),
      minedHeight = Number(mined);
    if (
      !Number.isSafeInteger(chainHeight) ||
      chainHeight < minedHeight ||
      Number(block.height) !== minedHeight ||
      !block.vtx.some((tx: { txid: Buffer }) => tx.txid.equals(hash))
    )
      throw Error("Unverified chain inclusion");
    const confirmations = chainHeight - minedHeight + 1;
    return {
      txid,
      network: "testnet",
      state: confirmations >= 3 ? "confirmed" : "confirming",
      confirmations,
      minedHeight,
      chainHeight,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    client.close();
  }
}
