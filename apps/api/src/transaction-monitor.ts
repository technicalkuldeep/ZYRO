import { z } from "zod";
import { Store } from "./store.js";
import { Fault } from "./engine.js";
import { observeTransaction, type Rpc, type ChainNetwork } from "./zcash.js";
import { observeLightwalletTransaction } from "./lightwallet.js";
export type Observation = Awaited<ReturnType<typeof observeTransaction>> & {
  userId: string;
  lastError: string | null;
  lastAttemptAt: string;
};
export class TransactionMonitor {
  constructor(
    private store: Store,
    private rpc?: Rpc,
    private network?: ChainNetwork,
  ) {}
  async refresh(userId: string, txid: string) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(txid);
    try {
      const value =
        !this.rpc && !process.env.ZCASH_RPC_URL && process.env.LIGHTWALLETD_URL
          ? await observeLightwalletTransaction(
              txid,
              process.env.LIGHTWALLETD_URL,
              this.network,
            )
          : await observeTransaction(txid, this.rpc, this.network);
      const record: Observation = {
        ...value,
        userId,
        lastError: null,
        lastAttemptAt: new Date().toISOString(),
      };
      await this.store.put(userId + ":" + txid, "transaction", record);
      return record;
    } catch (e) {
      const existing = await this.store.get<Observation>(userId + ":" + txid);
      if (existing) {
        existing.lastAttemptAt = new Date().toISOString();
        existing.lastError =
          e instanceof Fault
            ? e.message
            : "Node response could not be verified";
        await this.store.put(userId + ":" + txid, "transaction", existing);
      }
      throw e;
    }
  }
  async list(userId: string) {
    return (await this.store.list<Observation>("transaction")).filter(
      (t) => t.userId === userId,
    );
  }
}
