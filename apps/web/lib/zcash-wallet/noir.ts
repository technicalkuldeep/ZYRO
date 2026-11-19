import { getNoirWallet } from "@noir-wallet/sdk";
import { toZats, type WalletState } from "./client";
export type NoirStatus =
  | "searching"
  | "installed"
  | "unavailable"
  | "unsupported"
  | "unauthorized"
  | "locked"
  | "wrong-network"
  | "approval"
  | "connected"
  | "rejected"
  | "disconnected";
export const noirMessages: Record<NoirStatus, string> = {
  searching: "Searching for Noir Wallet",
  installed: "Noir Wallet installed",
  unavailable: "Extension unavailable",
  unsupported: "Unsupported extension version",
  unauthorized: "No account authorized · unlock Noir and connect",
  locked: "Noir Wallet locked · unlock it in the extension",
  "wrong-network": "Wrong network · select Zcash Testnet in Noir",
  approval: "Awaiting wallet approval",
  connected: "Connected to Zcash Testnet",
  rejected: "Connection rejected",
  disconnected: "Noir Wallet disconnected",
};
export function supportedNoirVersion(version?: string) {
  if (!version || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) return false;
  const [major, minor, patch] = version.split(".").map(Number);
  return major === 2 || (major === 1 && (minor > 0 || patch >= 27));
}
export function discoverNoir() {
  if (typeof window === "undefined") return null;
  return getNoirWallet();
}
export function waitForNoir(
  signal?: AbortSignal,
  timeout = 4000,
): Promise<ReturnType<typeof discoverNoir>> {
  if (typeof window === "undefined" || signal?.aborted)
    return Promise.resolve(null);
  const immediate = discoverNoir();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const finish = (provider: ReturnType<typeof discoverNoir>) => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("noirwallet#initialized", check);
      signal?.removeEventListener("abort", aborted);
      resolve(provider);
    };
    const check = () => {
      const found = discoverNoir();
      if (found) finish(found);
    };
    const aborted = () => finish(null);
    window.addEventListener("noirwallet#initialized", check);
    signal?.addEventListener("abort", aborted, { once: true });
    const poll = setInterval(check, 150);
    const timer = setTimeout(() => finish(discoverNoir()), timeout);
  });
}
export function noirErrorStatus(error: unknown): NoirStatus {
  const value = error as { code?: number; message?: string };
  if (
    value?.code === 4001 ||
    /user rejected|user denied|request rejected/i.test(value?.message || "")
  )
    return "rejected";
  if (value?.code === 4100) return "unauthorized";
  if (value?.code === 4200) return "unsupported";
  if (/locked/i.test(value?.message || "")) return "locked";
  if (/network|testnet|utest1|mainnet/i.test(value?.message || ""))
    return "wrong-network";
  return "disconnected";
}
export function noirLocalhostUrl() {
  if (
    typeof window === "undefined" ||
    !["127.0.0.1", "[::1]"].includes(window.location.hostname) ||
    window.location.protocol !== "http:"
  )
    return undefined;
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  return url.toString();
}
export async function readNoir(
  wallet: NonNullable<ReturnType<typeof discoverNoir>>,
  connect: boolean,
  validate: (address: string) => Promise<unknown>,
): Promise<WalletState | null> {
  const connection = connect
    ? await wallet.zcash.connect()
    : await wallet.zcash.getAccounts();
  if (!connection) return null;
  if (!connection.shielded?.startsWith("utest1"))
    throw Error(
      "Wrong network: choose Testnet in Noir Wallet settings, unlock it, and reconnect.",
    );
  await validate(connection.shielded);
  const authorized = connection.accounts?.find(
    (a) => a.addresses?.shielded === connection.shielded,
  );
  if (!authorized)
    throw Error(
      "Noir did not identify the authorized shielded account. Reconnect the wallet.",
    );
  const balances = await wallet.zcash.getBalance(authorized.id);
  const primary = balances.accounts?.find((a) => a.id === authorized.id);
  const synced = primary?.synced === true;
  return {
    kind: "noir",
    accountId: authorized.id,
    address: connection.shielded,
    backedUp: true,
    synced,
    // The provider exposes shielded total, not a separately confirmed shielded
    // balance. Keep confirmed unknown rather than relabel its total.
    spendable:
      synced && balances.spendable !== undefined
        ? toZats(balances.spendable).toString()
        : undefined,
    history: [],
    lastSync: synced ? Date.now() : undefined,
  };
}
