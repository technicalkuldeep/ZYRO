/* global TextEncoder, crypto, self, navigator, AbortSignal */
import init, * as engine from "./engine/zcash_wallet_wasm.js";
import { normalizeHistory } from "./history.mjs";
import {
  parseAmount,
  deriveKey,
  seal,
  unseal,
  storage,
  encodeBytes,
  decodeBytes,
} from "./vault.mjs";
// Upstream diagnostics must not disclose user secrets or private wallet data.
for (const method of ["log", "debug", "info", "warn", "error"])
  console[method] = () => {};
const networkFetch = self.fetch.bind(self);
self.fetch = (input, options = {}) =>
  networkFetch(input, {
    ...options,
    signal: AbortSignal.any([
      AbortSignal.timeout(45000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
let initialized,
  wallet,
  account,
  key,
  salt,
  data,
  quote,
  lastSync = 0;
let lease;
async function ownership() {
  if (lease) return;
  if (!navigator.locks) fail("WALLET_IN_USE");
  await new Promise((resolve, reject) => {
    void navigator.locks.request(
      "zyro-zcash-testnet-v1",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          reject(Error("WALLET_IN_USE"));
          return;
        }
        lease = true;
        resolve();
        await new Promise(() => {}); // Worker termination releases this lease.
      },
    );
  });
}
const ENDPOINT = "https://zcash-wallet-grpc-testnet.deltarpc.com";
const fail = (code) => {
  throw Error(code);
};
async function load() {
  if (!initialized)
    initialized = (async () => {
      if (!self.crossOriginIsolated) fail("ISOLATION_REQUIRED");
      const response = await fetch(
        new URL("./engine/zcash_wallet_wasm_bg.wasm", import.meta.url),
      );
      const binary = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", binary)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      if (
        hash !==
        "0b83c3963486310a881a1ebdd24d241c0e595496b60aa1b154c853ad47f71a8e"
      )
        fail("ENGINE_INTEGRITY");
      await init({ module_or_path: binary });
      await engine.initThreadPool(
        Math.min(2, navigator.hardwareConcurrency || 2),
      );
    })();
  return initialized;
}
function validateAddress(address) {
  if (
    typeof address !== "string" ||
    address.length > 512 ||
    !address.startsWith("utest1")
  )
    fail("TESTNET_UNIFIED_REQUIRED");
  try {
    const parsed = engine.parse_unified_address("test", address);
    if (!parsed.orchard && !parsed.sapling && !parsed.ironwood)
      fail("SHIELDED_RECEIVER_REQUIRED");
    return address;
  } catch {
    fail("INVALID_ADDRESS");
  }
}
async function persist() {
  const bytes = await wallet.db_to_bytes();
  try {
    data.db = encodeBytes(bytes);
    await storage("put", await seal(key, salt, data));
  } finally {
    bytes.fill(0);
  }
}
async function view(synced = false) {
  const summary = await wallet.get_wallet_summary();
  const balances = summary?.account_balances?.find(
    (entry) => entry[0] === account,
  )?.[1];
  const tip = summary?.chain_tip_height,
    scanned = summary?.fully_scanned_height;
  const complete = !!synced && tip === scanned;
  const history = normalizeHistory(
    await wallet.get_transaction_history(account),
    tip,
  );
  const state = {
    kind: "embedded",
    address: data.address,
    birthday: data.birthday,
    backedUp: data.backedUp,
    tip,
    scanned,
    lastSync,
    synced: complete,
    confirmed:
      complete && balances
        ? String(
            BigInt(balances.sapling_balance) +
              BigInt(balances.orchard_balance) +
              BigInt(balances.ironwood_balance),
          )
        : undefined,
    spendable:
      complete && balances ? String(balances.spendable_balance) : undefined,
    pending:
      complete && balances ? String(balances.pending_balance) : undefined,
    history,
    submission: data.submission,
  };
  summary?.free();
  return state;
}
async function sync() {
  if (!wallet) fail("LOCKED");
  quote = undefined;
  await wallet.sync_session_setup();
  let more = true;
  while (more) {
    more = await wallet.sync_next_batch(1000);
    await persist();
    self.postMessage({ progress: await view(false) });
  }
  lastSync = Date.now();
  await persist();
  return view(true);
}
async function run(method, args) {
  if (method === "exists") return !!(await storage("get"));
  await load();
  if (method === "validate") return validateAddress(args.address);
  if (method === "create" || method === "restore") {
    await ownership();
    if (await storage("get")) fail("WALLET_EXISTS");
    const phrase =
      method === "create"
        ? engine.generate_mnemonic(24)
        : args.phrase?.trim().split(/\s+/).join(" ");
    try {
      engine.validate_mnemonic(phrase);
    } catch {
      fail("INVALID_PHRASE");
    }
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(args.password, salt);
    wallet = new engine.WebWallet("test", ENDPOINT, undefined, {
      trusted: 3,
      untrusted: 3,
    });
    if (!wallet.get_ironwood_activation_height()) fail("IRONWOOD_UNSUPPORTED");
    const tip = await wallet.get_latest_height();
    const birthday =
      method === "create" ? Math.max(1, tip - 20) : args.birthday;
    if (!Number.isSafeInteger(birthday) || birthday < 280000 || birthday > tip)
      fail("INVALID_BIRTHDAY");
    account = await wallet.create_account("ZYRO Testnet", phrase, 0, birthday);
    const addresses = await wallet.get_unified_addresses(account);
    data = {
      phrase,
      address: validateAddress(addresses.unified),
      birthday,
      account,
      backedUp: method === "restore",
      network: "test",
      hdIndex: 0,
    };
    await persist();
    return {
      ...(await view(false)),
      phrase: method === "create" ? phrase : undefined,
    };
  }
  if (method === "unlock") {
    await ownership();
    try {
      const unlocked = await unseal(args.password, await storage("get"));
      key = unlocked.key;
      salt = unlocked.salt;
      data = unlocked.data;
    } catch {
      fail("UNLOCK_FAILED");
    }
    if (data.network !== "test" || data.hdIndex !== 0) fail("WRONG_NETWORK");
    const bytes = decodeBytes(data.db);
    try {
      wallet = new engine.WebWallet("test", ENDPOINT, bytes, {
        trusted: 3,
        untrusted: 3,
      });
    } finally {
      bytes.fill(0);
    }
    account = data.account;
    const addresses = await wallet.get_unified_addresses(account);
    if (validateAddress(addresses.unified) !== data.address)
      fail("IDENTITY_MISMATCH");
    return {
      ...(await view(false)),
      phrase: data.backedUp ? undefined : data.phrase,
    };
  }
  if (!wallet) fail("LOCKED");
  if (method === "backup") {
    data.backedUp = true;
    await persist();
    return view(false);
  }
  if (method === "sync") return sync();
  if (method === "estimate") {
    if (!data.backedUp) fail("BACKUP_REQUIRED");
    if (data.submission) fail("RECONCILE_REQUIRED");
    if (!lastSync || Date.now() - lastSync > 60000) fail("SYNC_REQUIRED");
    const to = validateAddress(args.to),
      amount = parseAmount(args.amount);
    const memo = new TextEncoder().encode(args.memo || "");
    if (memo.length > 512 || (memo.length && memo[0] >= 246))
      fail("INVALID_MEMO");
    const estimate = await wallet.estimate_transfer(
      account,
      to,
      amount,
      "shielded",
      memo.length ? memo : undefined,
      5000n,
      40,
    );
    const state = await view(true);
    if (BigInt(state.spendable || 0) < amount + BigInt(estimate.feeZats))
      fail("INSUFFICIENT_FUNDS");
    quote = {
      id: crypto.randomUUID(),
      to,
      amount: amount.toString(),
      memo: args.memo || "",
      fee: estimate.feeZats,
      expires: Date.now() + 60000,
    };
    return quote;
  }
  if (method === "send") {
    if (!quote || args.id !== quote.id || Date.now() > quote.expires)
      fail("QUOTE_EXPIRED");
    if (data.submission) fail("RECONCILE_REQUIRED");
    const selected = quote;
    quote = undefined;
    data.submission = {
      id: selected.id,
      status: "Preparing",
      at: Date.now(),
      amount: selected.amount,
      fee: selected.fee,
    };
    // Durable intent is saved BEFORE proving/broadcast. Unknown results never
    // silently permit a second transfer, including across reload or crash.
    await persist();
    let usk;
    try {
      usk = engine.mnemonic_to_spending_key("test", data.phrase, "", 0);
      self.postMessage({ stage: "Proving / Signing / Broadcasting" });
      const result = await wallet.oneclick_transfer(
        account,
        selected.to,
        BigInt(selected.amount),
        usk,
        "shielded",
        selected.memo ? new TextEncoder().encode(selected.memo) : undefined,
        5000n,
        40,
      );
      data.submission = {
        ...data.submission,
        status:
          result.status === "success" ? "Submitted" : "Submission unknown",
        txids: result.txIds,
        result: result.status,
      };
      await persist();
      return view(false);
    } catch {
      data.submission.status = "Submission unknown";
      await persist();
      fail("SUBMISSION_UNKNOWN");
    } finally {
      usk?.free();
    }
  }
  if (method === "reconcile") {
    const state = await sync();
    const rows = Array.isArray(state.history) ? state.history : [];
    const ids = data.submission?.txids;
    if (
      ids?.length &&
      ids.every((id) =>
        rows.some((row) => row.txid === id && row.status === "Confirmed"),
      )
    ) {
      data.submission = undefined;
      await persist();
    }
    return view(true);
  }
  fail("UNSUPPORTED_OPERATION");
}
// Serialize all engine/database activity. Locks are held across async boundaries.
let queue = Promise.resolve();
self.onmessage = ({ data: request }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({
        id: request.id,
        result: await run(request.method, request.args || {}),
      });
    } catch (error) {
      const allowed =
        /^(WALLET_IN_USE|ISOLATION_REQUIRED|ENGINE_INTEGRITY|TESTNET_UNIFIED_REQUIRED|SHIELDED_RECEIVER_REQUIRED|INVALID_ADDRESS|WALLET_EXISTS|INVALID_PHRASE|INVALID_BIRTHDAY|IRONWOOD_UNSUPPORTED|UNLOCK_FAILED|WRONG_NETWORK|IDENTITY_MISMATCH|LOCKED|BACKUP_REQUIRED|RECONCILE_REQUIRED|SYNC_REQUIRED|INVALID_MEMO|INSUFFICIENT_FUNDS|QUOTE_EXPIRED|SUBMISSION_UNKNOWN)$/;
      self.postMessage({
        id: request.id,
        error: allowed.test(error?.message)
          ? error.message
          : "WALLET_OPERATION_FAILED",
      });
    }
  });
};
