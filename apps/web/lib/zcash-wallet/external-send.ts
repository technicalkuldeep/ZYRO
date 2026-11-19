import { toZats, formatZats, type Quote, type WalletState } from "./client";
import { supportedNoirVersion, type discoverNoir } from "./noir";
type Provider = NonNullable<ReturnType<typeof discoverNoir>>;
export const externalSendKey = (address: string) =>
  `zyro:testnet:noir-send:${address}`;
export async function quoteNoirPayment(
  provider: Provider,
  state: WalletState,
  to: string,
  amount: string,
  memo: string,
): Promise<Quote> {
  if (!supportedNoirVersion(provider.version))
    throw Error("Unsupported Noir version. Use V1 1.0.27+ or V2.");
  if (!state.synced) throw Error("Synchronize before sending.");
  if (new TextEncoder().encode(memo).length > 512)
    throw Error("Memo exceeds 512 UTF-8 bytes.");
  const max = await provider.zcash.getMaxTransfer({
    to,
    memo,
    fundingSource: "shielded",
    feeTier: "standard",
  });
  const value = amount === "max" ? toZats(max.maxAmount) : toZats(amount);
  if (value <= 0n || value > BigInt(state.spendable || "0"))
    throw Error("Insufficient spendable TAZ.");
  if (value > toZats(max.maxAmount))
    throw Error("Insufficient shielded TAZ for amount and network fee.");
  return {
    id: crypto.randomUUID(),
    to,
    amount: value.toString(),
    memo,
    fee: toZats(max.fee).toString(),
    expires: Date.now() + 60000,
    feeSource: value === toZats(max.maxAmount) ? "exact" : "noir-approval",
  };
}
export function restoredExternalSubmission(
  address: string,
): WalletState["submission"] {
  try {
    const item = JSON.parse(
      localStorage.getItem(externalSendKey(address)) || "null",
    );
    if (!item || typeof item !== "object") return;
    return {
      status:
        item.txid && /^[0-9a-f]{64}$/.test(item.txid)
          ? "Submitted"
          : "Submission unknown",
      at: Number.isSafeInteger(item.at) ? item.at : 0,
      txids:
        item.txid && /^[0-9a-f]{64}$/.test(item.txid) ? [item.txid] : undefined,
    };
  } catch {
    return;
  }
}
export async function sendNoirPayment(
  provider: Provider,
  address: string,
  quote: Quote,
) {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw Error(
      "This browser cannot safely coordinate payments between tabs. Use current Chrome or Edge.",
    );
  return navigator.locks.request(
    `zyro:noir-payment:${address}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw Error("Another tab is authorizing a payment for this account.");
      return sendAuthorizedPayment(provider, address, quote);
    },
  );
}
async function sendAuthorizedPayment(
  provider: Provider,
  address: string,
  quote: Quote,
) {
  if (Date.now() > quote.expires)
    throw Error("Quote expired. Review a fresh payment.");
  const authorization = await provider.zcash.getAccounts();
  if (!authorization || authorization.shielded !== address)
    throw Error("The account changed or locked. Reconnect before sending.");
  const key = externalSendKey(address);
  if (localStorage.getItem(key))
    throw Error("A previous send needs reconciliation before another payment.");
  const at = Date.now();
  localStorage.setItem(
    key,
    JSON.stringify({ status: "Awaiting authorization", at }),
  );
  try {
    const txid = await provider.zcash.sendTransaction({
      to: quote.to,
      amount: formatZats(quote.amount),
      memo: quote.memo,
      fundingSource: "shielded",
    });
    if (!/^[0-9a-f]{64}$/.test(txid))
      throw Error("Unknown submission result. Check Noir before another send.");
    localStorage.setItem(
      key,
      JSON.stringify({ status: "Submitted", txid, at }),
    );
    return txid;
  } catch (error) {
    const rejection = error as { code?: number; message?: string };
    // V1's bridge drops numeric codes. These exact messages are emitted only
    // for its explicit rejection path; generic transport errors stay unresolved.
    if (
      rejection.code === 4001 ||
      /^User rejected (?:the transaction|the request)$/.test(
        rejection.message || "",
      )
    )
      localStorage.removeItem(key);
    throw error;
  }
}
