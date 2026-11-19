export type WalletState = {
  kind: "embedded" | "noir";
  address: string;
  birthday?: number;
  backedUp?: boolean;
  synced: boolean;
  tip?: number;
  scanned?: number;
  lastSync?: number;
  confirmed?: string;
  spendable?: string;
  pending?: string;
  history: unknown;
  submission?: { status: string; txids?: string[]; at: number };
  phrase?: string;
  accountId?: string;
};
export type Quote = {
  id: string;
  to: string;
  amount: string;
  memo: string;
  fee: string;
  expires: number;
  feeSource?: "exact" | "noir-approval";
};
const messages: Record<string, string> = {
  WALLET_IN_USE:
    "This wallet is open in another tab. Lock it there before unlocking here.",
  ISOLATION_REQUIRED:
    "This page needs cross-origin isolation. Reload the wallet page over HTTPS or localhost.",
  ENGINE_INTEGRITY:
    "Wallet engine integrity verification failed. Do not enter a recovery phrase.",
  TESTNET_UNIFIED_REQUIRED:
    "Use a testnet Unified Address beginning with utest1.",
  INVALID_ADDRESS: "The Zcash decoder rejected this address.",
  INVALID_PHRASE:
    "The recovery phrase is invalid. Check every word and its order.",
  INVALID_BIRTHDAY:
    "Enter a valid wallet birthday at or before the current testnet tip (minimum 280000).",
  WALLET_EXISTS:
    "An encrypted wallet already exists in this browser. Unlock it first.",
  UNLOCK_FAILED:
    "Incorrect password or damaged encrypted wallet. Your stored wallet has not changed.",
  BACKUP_REQUIRED: "Complete the recovery phrase backup before sending.",
  RECONCILE_REQUIRED:
    "A previous send needs reconciliation. Refresh transaction status before sending again.",
  SYNC_REQUIRED: "Synchronize the wallet before requesting a fee quote.",
  INVALID_MEMO: "The memo must be valid UTF-8 text, no more than 512 bytes.",
  INSUFFICIENT_FUNDS:
    "Insufficient spendable TAZ for the amount and network fee.",
  QUOTE_EXPIRED: "The fee quote expired. Review a fresh quote before sending.",
  SUBMISSION_UNKNOWN:
    "The send result is uncertain. Synchronize and reconcile before attempting another transfer.",
  WALLET_OPERATION_FAILED:
    "The wallet operation failed. Check testnet connectivity and retry. No balance has been assumed.",
};
export class EmbeddedWallet {
  private closed = false;
  private worker: Worker;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor(
    onProgress: (state: WalletState) => void,
    onStage: (stage: string) => void,
  ) {
    this.worker = new Worker("/zcash-wallet/wallet.worker.mjs", {
      type: "module",
      name: "ZYRO testnet wallet",
    });
    this.worker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.progress) onProgress(data.progress);
      if (data.stage) onStage(data.stage);
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error)
        pending.reject(
          new Error(
            messages[data.error] ||
              "Wallet operation failed. Unlock and retry.",
          ),
        );
      else pending.resolve(data.result);
    };
    this.worker.onerror = () => this.dispose();
  }
  request<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new Error(
          "Wallet engine stopped. Lock and unlock the wallet to restart it.",
        ),
      );
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ id, method, args });
    });
  }
  dispose() {
    this.closed = true;
    this.worker.onmessage = null;
    this.worker.terminate();
    for (const request of this.pending.values())
      request.reject(new Error("Wallet locked. Unlock to continue."));
    this.pending.clear();
  }
}
export function formatZats(value?: string | number | bigint) {
  if (value === undefined) return "—";
  const n = BigInt(value),
    sign = n < 0n ? "−" : "",
    abs = n < 0n ? -n : n;
  return `${sign}${abs / 100000000n}.${String(abs % 100000000n).padStart(8, "0")}`;
}
export function toZats(value: string) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(value))
    throw Error("Enter a TAZ amount with at most eight decimals.");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (result > 2100000000000000n)
    throw Error("Amount exceeds the Zcash supply limit.");
  return result;
}
