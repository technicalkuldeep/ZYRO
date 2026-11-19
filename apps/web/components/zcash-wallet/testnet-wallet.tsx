"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
  ExternalLink,
  History,
  Droplets,
  Settings,
} from "lucide-react";
import QRCode from "qrcode";
import {
  EmbeddedWallet,
  formatZats,
  toZats,
  type Quote,
  type WalletState,
} from "../../lib/zcash-wallet/client";
import { discoverNoir, readNoir } from "../../lib/zcash-wallet/noir";
import { useNoir } from "../../lib/zcash-wallet/use-noir";
import { NoirStatusPanel } from "./noir-status";
import {
  quoteNoirPayment,
  sendNoirPayment,
  restoredExternalSubmission,
} from "../../lib/zcash-wallet/external-send";
import { NoirTransaction } from "./noir-transaction";
import {
  claimKey,
  faucetMessage,
  faucetRequest,
  submitClaim,
  type Claim,
} from "../../lib/zcash-wallet/faucet";
import { WalletActivity } from "./wallet-activity";
import styles from "./wallet.module.css";
import {
  SecretInput,
  WalletActionButton,
  WalletModal,
} from "./wallet-primitives";
type Panel = "receive" | "faucet" | "activity" | "settings";
type BalanceSnapshot = Pick<
  WalletState,
  "address" | "confirmed" | "spendable" | "pending" | "lastSync"
>;
type Mode = "landing" | "create" | "restore" | "unlock" | "send";
const errorText = (error: unknown) =>
  error instanceof Error
    ? faucetMessage[error.message] || error.message
    : "Operation failed. Retry when the service is available.";
export function TestnetWallet() {
  const [panel, setPanel] = useState<Panel>();
  const [showPhrase, setShowPhrase] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [noirView, setNoirView] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const connectionIntent = useRef(false);
  const intentRead = useRef(false);
  const [ready, setReady] = useState(false);
  const [balanceSnapshot, setBalanceSnapshot] = useState<BalanceSnapshot>();
  const [state, setState] = useState<WalletState>(),
    [mode, setMode] = useState<Mode>("landing"),
    [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [syncStatus, setSyncStatus] = useState("Not connected");
  const [phrase, setPhrase] = useState(""),
    [acknowledged, setAcknowledged] = useState(false),
    [quote, setQuote] = useState<Quote>(),
    [qr, setQr] = useState(""),
    [qrAddress, setQrAddress] = useState(""),
    [copied, setCopied] = useState(false);
  const [claim, setClaim] = useState<Claim>(),
    [network, setNetwork] = useState<{
      drip_zat: number;
      address_cooldown_hours: number;
      captcha_mode: "local_test" | "turnstile" | "bearer";
    }>();
  const engine = useRef<EmbeddedWallet | null>(null),
    provider = useRef<ReturnType<typeof discoverNoir>>(null),
    current = useRef<WalletState | undefined>(undefined),
    working = useRef(false),
    mounted = useRef(true);
  const releaseProvider = useRef<() => void>(() => {}),
    polling = useRef(false),
    epoch = useRef(0),
    operationRevision = useRef(0);
  const update = useCallback((next: WalletState) => {
    current.current = next;
    if (mounted.current) {
      setState(next);
      setBalanceSnapshot((previous) =>
        next.synced
          ? {
              address: next.address,
              confirmed: next.confirmed,
              spendable: next.spendable,
              pending: next.pending,
              lastSync: next.lastSync,
            }
          : previous?.address === next.address
            ? previous
            : undefined,
      );
    }
  }, []);
  const worker = useCallback(() => {
    if (!engine.current)
      engine.current = new EmbeddedWallet((next) => {
        update({
          ...next,
          submission: restoredExternalSubmission(next.address),
        });
        setSyncStatus("Syncing");
      }, setStage);
    return engine.current;
  }, [update]);
  const noir = useNoir({
    validate: (address) => worker().request("validate", { address }),
    selected: () => current.current?.kind === "noir",
    account: (wallet, next) => {
      epoch.current++;
      setPanel(undefined);
      setMode("landing");
      setShowPhrase(false);
      setCopied(false);
      setQuote(undefined);
      setClaim(undefined);
      setQr("");
      if (wallet && next) {
        provider.current = wallet;
        update(next);
        setSyncStatus(next.synced ? "Synced" : "Syncing");
      } else if (current.current?.kind === "noir") {
        current.current = undefined;
        provider.current = null;
        setState(undefined);
        setBalanceSnapshot(undefined);
        setMode("landing");
      }
    },
  });
  async function perform(label: string, operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    const revision = ++operationRevision.current;
    setBusy(true);
    setError("");
    setStage(label);
    try {
      await operation();
    } catch (e) {
      if (mounted.current && revision === operationRevision.current)
        setError(errorText(e));
    } finally {
      if (revision === operationRevision.current) {
        working.current = false;
        if (mounted.current) {
          setBusy(false);
          setStage("");
        }
      }
    }
  }
  const refresh = useCallback(async () => {
    const active = current.current;
    if (!active) return;
    const generation = epoch.current;
    setSyncStatus("Syncing");
    try {
      const next =
        active.kind === "embedded"
          ? await worker().request<WalletState>(
              active.submission ? "reconcile" : "sync",
            )
          : await readNoir(provider.current!, false, (address) =>
              worker().request("validate", { address }),
            );
      if (generation !== epoch.current) return;
      if (!next)
        throw Error(
          "Noir Wallet is locked or disconnected. Unlock the extension and connect again.",
        );
      if (next.address !== active.address) {
        setQuote(undefined);
        setClaim(undefined);
      }
      update(
        next.kind === "noir"
          ? { ...next, submission: restoredExternalSubmission(next.address) }
          : next,
      );
      setSyncStatus(next.synced ? "Synced" : "Syncing");
    } catch (e) {
      if (generation === epoch.current) {
        update({
          ...active,
          synced: false,
          confirmed: undefined,
          spendable: undefined,
          pending: undefined,
        });
        setSyncStatus("Offline · retry available");
      }
      throw e;
    }
  }, [update, worker]);
  const lock = useCallback(() => {
    epoch.current++;
    operationRevision.current++;
    working.current = false;
    setBusy(false);
    setStage("");
    releaseProvider.current();
    releaseProvider.current = () => {};
    engine.current?.dispose();
    engine.current = null;
    provider.current = null;
    current.current = undefined;
    setState(undefined);
    setBalanceSnapshot(undefined);
    setPhrase("");
    setShowPhrase(false);
    setPhraseCopied(false);
    setPanel(undefined);
    setCopied(false);
    setQuote(undefined);
    setClaim(undefined);
    setQr("");
    setMode("landing");
    setRestoreNotice(false);
    setAcknowledged(false);
    setSyncStatus("Locked");
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void worker()
      .request<boolean>("exists")
      .then((value) => {
        if (!cancelled) {
          setExists(value);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    void faucetRequest("network")
      .then(setNetwork)
      .catch(() => {});
    let idleAt = Date.now();
    const activity = () => {
      idleAt = Date.now();
    };
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    const idle = setInterval(() => {
      if (current.current?.kind === "embedded" && Date.now() - idleAt > 300000)
        lock();
    }, 10000);
    return () => {
      cancelled = true;
      mounted.current = false;
      engine.current?.dispose();
      engine.current = null;
      releaseProvider.current();
      clearInterval(idle);
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
    };
  }, [lock, worker]);
  useEffect(() => {
    if (!state?.address) return;
    try {
      const saved = localStorage.getItem(claimKey(state.address));
      setClaim(saved ? JSON.parse(saved) : undefined);
    } catch {
      setError(
        "Faucet receipt storage is unavailable. Use the official website.",
      );
    }
    if (panel !== "receive") {
      setQr("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(state.address, { width: 280, margin: 2 }).then(
      (url) => {
        if (!cancelled) {
          setQr(url);
          setQrAddress(state.address);
        }
      },
      () => {
        if (!cancelled)
          setError("Unable to generate QR. Copy your address instead.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [state?.address, panel]);
  useEffect(() => {
    if (!state?.address || phrase) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>,
      attempt = 0;
    const tick = async () => {
      if (cancelled) return;
      if (!working.current && !document.hidden) {
        const revision = ++operationRevision.current;
        working.current = true;
        setBusy(true);
        setStage("Synchronizing blockchain");
        try {
          await refresh();
          attempt = 0;
        } catch {
          attempt++;
          if (!cancelled && revision === operationRevision.current)
            setSyncStatus("Reconnecting…");
        } finally {
          if (revision === operationRevision.current) working.current = false;
          if (mounted.current && revision === operationRevision.current) {
            setBusy(false);
            setStage("");
          }
        }
      }
      if (!cancelled)
        timer = setTimeout(
          tick,
          Math.min(120000, 30000 * 2 ** Math.min(attempt, 2)),
        );
    };
    timer = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state?.address, phrase, refresh]);
  useEffect(() => {
    if (!claim?.request_id || !state?.address) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>,
      count = 0;
    const address = state.address,
      id = claim.request_id;
    const poll = async () => {
      if (cancelled) return;
      if (polling.current || document.hidden) {
        timer = setTimeout(poll, 10000);
        return;
      }
      polling.current = true;
      try {
        const next = (await faucetRequest(
          `status/${encodeURIComponent(id)}`,
        )) as Claim;
        if (!cancelled && current.current?.address === address) {
          localStorage.setItem(claimKey(address), JSON.stringify(next));
          setClaim(next);
          if (next.state === "confirmed") {
            if (!working.current) {
              working.current = true;
              try {
                await refresh();
              } finally {
                working.current = false;
              }
            }
            return;
          }
          if (next.state === "failed") return;
        }
      } catch {
        /* Preserve the original ID; no automatic claim POST retries. */
      } finally {
        polling.current = false;
      }
      if (!cancelled && ++count < 60)
        timer = setTimeout(
          poll,
          Math.min(60000, 5000 * 2 ** Math.min(count, 4)),
        );
    };
    timer = setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [claim?.request_id, state?.address, refresh]);
  useEffect(() => {
    setPanel(undefined);
    setQr("");
    setCopied(false);
    setQuote(undefined);
  }, [state?.address]);
  useEffect(() => {
    setError("");
  }, [panel]);
  useEffect(() => {
    // React Strict Mode replays mount effects; consume the explicit click once.
    if (intentRead.current) return;
    intentRead.current = true;
    if (new URLSearchParams(location.search).get("connect") === "noir") {
      setNoirView(true);
      try {
        connectionIntent.current =
          sessionStorage.getItem("zyro:noir-connect-intent") === "yes";
        sessionStorage.removeItem("zyro:noir-connect-intent");
      } catch {
        /* Explicit connection remains available. */
      }
    }
  }, []);
  useEffect(() => {
    if (!ready || noir.status === "searching" || !connectionIntent.current)
      return;
    connectionIntent.current = false;
    void connect();
  }, [ready, noir.status]);
  async function onboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form),
      password = String(fields.get("password") || "");
    if (mode !== "unlock" && password !== fields.get("confirm")) {
      setError("The passwords do not match.");
      return;
    }
    const generation = epoch.current;
    await perform(
      mode === "unlock"
        ? "Unlocking encrypted wallet"
        : "Initializing wallet engine",
      async () => {
        noir.embedded();
        const next = await worker().request<WalletState>(
          mode === "unlock" ? "unlock" : mode,
          {
            password,
            phrase: fields.get("phrase"),
            birthday: Number(fields.get("birthday")),
          },
        );
        form.reset();
        if (generation !== epoch.current) return;
        setPhrase(next.phrase || "");
        setShowPhrase(false);
        setRestoreNotice(mode === "restore");
        const clean = { ...next };
        delete clean.phrase;
        update(clean);
        setExists(true);
        setMode("landing");
        setSyncStatus("Connecting");
      },
    );
  }
  async function connect() {
    setNoirView(true);
    await perform("Awaiting wallet approval", noir.connect);
  }
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = epoch.current;
    const f = new FormData(event.currentTarget),
      to = String(f.get("to") || "").trim(),
      amount = String(f.get("amount") || ""),
      memo = String(f.get("memo") || "");
    await perform("Estimating network fee", async () => {
      if (!state?.synced) throw Error("Synchronize before sending.");
      if (toZats(amount) <= 0n) throw Error("Enter a positive TAZ amount.");
      if (new TextEncoder().encode(memo).length > 512)
        throw Error("The memo exceeds 512 UTF-8 bytes.");
      await worker().request("validate", { address: to });
      const next =
        state.kind === "embedded"
          ? await worker().request<Quote>("estimate", { to, amount, memo })
          : await quoteNoirPayment(provider.current!, state, to, amount, memo);
      if (generation === epoch.current) setQuote(next);
    });
  }
  async function send() {
    if (!quote || !state) return;
    const selected = quote;
    const generation = epoch.current;
    setQuote(undefined);
    await perform("Awaiting authorization", async () => {
      if (Date.now() > selected.expires)
        throw Error("The quote expired. Request a fresh estimate.");
      if (state.kind === "embedded")
        update(
          await worker().request<WalletState>("send", { id: selected.id }),
        );
      else {
        const txid = await sendNoirPayment(
          provider.current!,
          state.address,
          selected,
        );
        if (generation !== epoch.current) return;
        update({
          ...state,
          synced: false,
          spendable: undefined,
          submission: { status: "Submitted", txids: [txid], at: Date.now() },
        });
      }
      setMode("landing");
      await refresh();
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(state!.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Clipboard unavailable. Select and copy the address.");
    }
  }
  const rows = Array.isArray(state?.history)
    ? (state.history as Record<string, unknown>[])
    : [];
  const balanceView =
    state &&
    (state.confirmed !== undefined ||
      (state.kind === "noir" && state.spendable !== undefined))
      ? state
      : balanceSnapshot?.address === state?.address
        ? balanceSnapshot
        : state;
  const cachedBalance = !!state && balanceView !== state && !!balanceView;
  return (
    <section className={styles.wallet} aria-label="Zcash testnet wallet">
      <header className={styles.top}>
        <a href="/" aria-label="ZYRO home" className={styles.wordmark}>
          ZYRO<span>/ wallet</span>
        </a>
        <span className={styles.network}>
          <span />
          Zcash Testnet · TAZ
        </span>
      </header>
      <a className={styles.textButton} href="/testnet">
        ← Back to Testnet
      </a>
      {!state && (
        <div className={styles.intro}>
          <span className={styles.eyebrow}>ZYRO WALLET</span>
          <h1>{noirView ? "Connect Noir." : "Make it yours."}</h1>
          <p>
            {noirView
              ? "Approve a connection in your Noir extension."
              : "A private testnet wallet, secured on this device."}
          </p>
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          <strong>Action needed</strong>
          <p>{error}</p>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {busy && stage !== "Synchronizing blockchain" && (
        <div className={styles.notice} role="status">
          <span className={styles.pulse} />
          {stage || "Working…"}
          <small>Keep this page open while the operation completes.</small>
        </div>
      )}
      {noirView && !state && (
        <NoirStatusPanel
          status={noir.status}
          version={noir.version}
          localhost={noir.localhost}
          retry={() => void noir.retry()}
        />
      )}
      {!state && mode === "landing" && (
        <section className={styles.panel}>
          {noirView ? (
            <>
              <h2>Noir Wallet</h2>
              <p>Your keys stay in the extension.</p>
              <button
                className={styles.primary}
                onClick={connect}
                disabled={busy || !ready}
              >
                Connect Noir Wallet
              </button>
              <button onClick={() => setNoirView(false)}>
                Use ZYRO Wallet
              </button>
            </>
          ) : (
            <>
              <h2>{exists ? "Welcome back." : "Your keys. Your beginning."}</h2>
              <div className={styles.onboardingChoices}>
                {exists && (
                  <button
                    className={styles.primary}
                    onClick={() => setMode("unlock")}
                    disabled={busy || !ready}
                  >
                    <LockKeyhole size={18} />
                    Unlock Existing Wallet
                  </button>
                )}
                <button
                  onClick={() => setMode("create")}
                  disabled={exists || busy || !ready}
                >
                  <Wallet size={18} />
                  Create New Wallet
                </button>
                <button
                  onClick={() => setMode("restore")}
                  disabled={exists || busy || !ready}
                >
                  Import / Restore Wallet
                </button>
              </div>
              {exists && (
                <p className={styles.fine}>
                  An encrypted wallet already exists here. Unlock it to
                  continue. To restore another wallet, use a separate browser
                  profile; your existing vault will stay intact.
                </p>
              )}
              <a
                className={styles.textButton}
                href="/wallet/testnet?connect=noir"
              >
                Connect Noir instead <ArrowUpRight size={16} />
              </a>
            </>
          )}
        </section>
      )}
      {!state && mode !== "landing" && (
        <section className={`${styles.panel} ${styles.formPanel}`}>
          <button
            className={styles.textButton}
            onClick={() => {
              setMode("landing");
              setError("");
            }}
            disabled={busy}
          >
            ← Back
          </button>
          <h2>
            {mode === "create"
              ? "Create New Testnet Wallet"
              : mode === "restore"
                ? "Restore Wallet"
                : "Unlock your wallet"}
          </h2>
          <p>
            {mode === "unlock"
              ? "Your password decrypts this device's wallet. It is never sent to ZYRO."
              : "Choose a unique password of at least 12 characters. Save your recovery phrase and wallet birthday offline."}
          </p>
          <form key={mode} onSubmit={onboard}>
            {mode === "restore" && (
              <>
                <SecretInput
                  label="Recovery phrase"
                  name="phrase"
                  required
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <small>
                  Compatible BIP-39 English phrases only. Testnet ZIP-32 account
                  0, empty BIP-39 passphrase. Other wallets or account settings
                  may derive different addresses.
                </small>
                <label>
                  Wallet birthday block
                  <input
                    name="birthday"
                    type="number"
                    min="280000"
                    step="1"
                    required
                    defaultValue={280000}
                  />
                </label>
                <small>
                  A birthday after earlier payments can omit funds. Use your
                  backup's birthday or an earlier block. Older birthdays take
                  longer to scan.
                </small>
              </>
            )}
            <SecretInput
              label={
                mode === "unlock" ? "Wallet password" : "New wallet password"
              }
              name="password"
              minLength={12}
              maxLength={1024}
              required
              autoComplete={
                mode === "unlock" ? "current-password" : "new-password"
              }
            />
            {mode !== "unlock" && (
              <SecretInput
                label="Confirm password"
                name="confirm"
                minLength={12}
                maxLength={1024}
                required
                autoComplete="new-password"
              />
            )}
            <button className={styles.primary} type="submit" disabled={busy}>
              {mode === "create"
                ? "Create encrypted wallet"
                : mode === "restore"
                  ? "Restore and synchronize"
                  : "Unlock wallet"}
            </button>
          </form>
        </section>
      )}
      {state && (
        <>
          {phrase && (
            <section className={`${styles.panel} ${styles.backup}`}>
              <h2>Back up your wallet</h2>
              <p>
                Keep these words private. Anyone with your phrase can spend your
                funds.
              </p>
              <button
                aria-pressed={showPhrase}
                onClick={() => setShowPhrase(!showPhrase)}
              >
                {showPhrase ? "Hide" : "Show"} Recovery Phrase
              </button>
              {showPhrase && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(phrase);
                      setPhraseCopied(true);
                    } catch {
                      setError(
                        "Clipboard unavailable. Write down your phrase privately.",
                      );
                    }
                  }}
                >
                  {phraseCopied ? "Copied" : "Copy recovery phrase"}
                </button>
              )}
              <ol>
                {phrase.split(" ").map((word, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {showPhrase ? word : "••••••"}
                  </li>
                ))}
              </ol>
              <p>
                Wallet birthday: <strong>{state.birthday}</strong> · Testnet ·
                ZIP-32 account 0 · No BIP-39 passphrase
              </p>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I saved the phrase and birthday. Losing my backup may mean
                losing access.
              </label>
              <button
                className={styles.primary}
                disabled={!acknowledged || busy}
                onClick={() =>
                  void perform("Saving backup acknowledgement", async () => {
                    update(await worker().request<WalletState>("backup"));
                    setPhrase("");
                    setShowPhrase(false);
                    setPhraseCopied(false);
                    setCopied(false);
                    setAcknowledged(false);
                    await refresh();
                  })
                }
              >
                I saved my backup
              </button>
            </section>
          )}
          {restoreNotice && (
            <div className={styles.notice}>
              <p>
                Wallet restored. Compare the receiving address with your backup.
                Recovery scans from block {state.birthday}; keep this page open.
                Lock and unlock to verify your new password.
              </p>
              <button onClick={() => setRestoreNotice(false)}>Dismiss</button>
            </div>
          )}
          <div className={styles.balances}>
            <section className={styles.balance}>
              <span>
                {state.confirmed === undefined && state.spendable !== undefined
                  ? "Available balance"
                  : "Confirmed balance"}
              </span>
              <strong>
                {formatZats(balanceView?.confirmed ?? balanceView?.spendable)}{" "}
                <small>TAZ</small>
              </strong>
              <small>
                {cachedBalance
                  ? `Cached · last checked ${balanceView?.lastSync ? new Date(balanceView.lastSync).toLocaleTimeString() : "earlier this session"}. Updating…`
                  : state.confirmed === undefined
                    ? state.kind === "noir"
                      ? "Noir connection · View confirmed balance in the extension"
                      : "Awaiting reliable wallet data"
                    : "Available " + formatZats(state.spendable) + " TAZ"}
              </small>
            </section>
            {balanceView?.pending !== undefined &&
              BigInt(balanceView.pending) !== 0n && (
                <p className={styles.pending}>
                  +{formatZats(balanceView.pending)} TAZ pending
                  {cachedBalance ? " · last checked" : ""}
                </p>
              )}
          </div>
          <div className={styles.actionGrid}>
            <WalletActionButton
              icon={<ArrowUpRight size={20} />}
              disabled={
                busy ||
                !!phrase ||
                !state.synced ||
                state.spendable === undefined ||
                !!state.submission
              }
              onClick={() => {
                setPanel(undefined);
                setMode("send");
              }}
            >
              Send
            </WalletActionButton>
            <WalletActionButton
              icon={<ArrowDownLeft size={20} />}
              disabled={!!phrase}
              onClick={() => setPanel("receive")}
            >
              Receive
            </WalletActionButton>
            <WalletActionButton
              icon={<Droplets size={20} />}
              disabled={!!phrase}
              onClick={() => setPanel("faucet")}
            >
              Get TAZ
            </WalletActionButton>
            <WalletActionButton
              icon={<History size={20} />}
              disabled={!!phrase}
              onClick={() => setPanel("activity")}
            >
              Activity
            </WalletActionButton>
          </div>
          <section className={styles.overview}>
            <div>
              <span className={styles.eyebrow}>
                {state.kind === "embedded"
                  ? "ZYRO BROWSER WALLET"
                  : "NOIR EXTENSION WALLET"}
              </span>
              <p className={styles.shortAddress}>
                {state.address.slice(0, 18)}…{state.address.slice(-12)}
              </p>
              <button onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Address copied" : "Copy address"}
              </button>
            </div>
            <div className={styles.sync}>
              <strong role="status">{syncStatus}</strong>
              {syncStatus.startsWith("Offline") ||
              syncStatus.startsWith("Reconnecting") ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform("Synchronizing blockchain", refresh)
                  }
                >
                  Retry connection
                </button>
              ) : null}
              <small>
                {state.lastSync
                  ? "Last checked " +
                    new Date(state.lastSync).toLocaleTimeString()
                  : "Awaiting wallet data"}
              </small>
              <div className={styles.management}>
                <button
                  onClick={
                    state.kind === "noir"
                      ? () =>
                          void perform("Disconnecting Noir", async () => {
                            await noir.disconnect();
                            lock();
                          })
                      : lock
                  }
                >
                  <LockKeyhole size={16} />
                  {state.kind === "embedded"
                    ? "Lock wallet"
                    : "Disconnect Noir Wallet"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    noir.dismiss();
                    lock();
                  }}
                >
                  Switch Wallet
                </button>
                <button onClick={() => setPanel("settings")} disabled={busy}>
                  <Settings size={16} />
                  Settings
                </button>
              </div>
            </div>
          </section>
          {panel === "settings" && (
            <WalletModal
              error={error}
              stage={stage}
              title="Wallet settings"
              busy={busy}
              close={() => setPanel(undefined)}
            >
              <p>
                {state.kind === "embedded"
                  ? "Encrypted on this device. Locks after five minutes of inactivity."
                  : "Connected through Noir. Keys and approval stay in the extension."}
              </p>
              <p className={styles.fine}>
                TAZ is testnet currency, separate from real ZEC.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void perform("Synchronizing blockchain", refresh)
                }
              >
                <RefreshCw size={16} />
                Refresh balance
              </button>
              <a
                className={styles.textButton}
                href="/zcash-wallet/PROVENANCE.md"
                target="_blank"
                rel="noreferrer"
              >
                Engine provenance and licensing
              </a>
            </WalletModal>
          )}
          {mode === "send" && (
            <WalletModal
              error={error}
              stage={stage}
              title="Send TAZ"
              busy={busy}
              close={() => {
                setMode("landing");
                setQuote(undefined);
              }}
            >
              <small>Available {formatZats(state.spendable)} TAZ</small>
              <p>Shielded funding only · Zcash public testnet</p>
              {!quote ? (
                <form onSubmit={prepare}>
                  <label>
                    Recipient testnet Unified Address
                    <textarea name="to" required spellCheck={false} rows={3} />
                  </label>
                  <label>
                    Amount in TAZ
                    <input
                      name="amount"
                      inputMode="decimal"
                      type="text"
                      required
                      placeholder="0.01"
                    />
                  </label>
                  <label>
                    Private memo (optional)
                    <textarea name="memo" rows={2} maxLength={512} />
                  </label>
                  <small>Maximum 512 UTF-8 bytes.</small>
                  {state.kind === "noir" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(event) => {
                        const form = event.currentTarget.form!;
                        const fields = new FormData(form),
                          to = String(fields.get("to") || "").trim(),
                          memo = String(fields.get("memo") || "");
                        void perform("Calculating Send Max", async () => {
                          await worker().request("validate", { address: to });
                          setQuote(
                            await quoteNoirPayment(
                              provider.current!,
                              state,
                              to,
                              "max",
                              memo,
                            ),
                          );
                        });
                      }}
                    >
                      Review Send Max
                    </button>
                  )}
                  <button
                    type="submit"
                    className={styles.primary}
                    disabled={busy}
                  >
                    Review amount and fee
                  </button>
                </form>
              ) : (
                <div className={styles.confirm}>
                  <h3>Confirm shielded transfer</h3>
                  <p className={styles.address}>{quote.to}</p>
                  <dl>
                    <dt>Amount</dt>
                    <dd>{formatZats(quote.amount)} TAZ</dd>
                    <dt>Estimated network fee</dt>
                    <dd>
                      {formatZats(quote.fee)} TAZ
                      {quote.feeSource === "noir-approval" &&
                        " (send-max reference only)"}
                    </dd>
                    <dt>Total expected deduction</dt>
                    <dd>
                      {quote.feeSource === "noir-approval"
                        ? "Final fee and total shown in Noir approval"
                        : `${formatZats(BigInt(quote.amount) + BigInt(quote.fee))} TAZ`}
                    </dd>
                    <dt>Network</dt>
                    <dd>Zcash Testnet</dd>
                  </dl>
                  {quote.memo && <p>Memo: {quote.memo}</p>}
                  <button
                    className={styles.primary}
                    onClick={send}
                    disabled={busy}
                  >
                    Authorize shielded transfer
                  </button>
                </div>
              )}
              <button
                className={styles.textButton}
                onClick={() => {
                  setMode("landing");
                  setQuote(undefined);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </WalletModal>
          )}
          {state.submission && (
            <section className={styles.notice} aria-live="polite">
              <strong>{state.submission.status}</strong>
              {state.kind === "noir" &&
                state.submission.txids?.map((txid) => (
                  <NoirTransaction
                    key={txid}
                    txid={txid}
                    address={state.address}
                    reconciled={() =>
                      void perform("Refreshing Noir balance", refresh)
                    }
                  />
                ))}
              {state.submission.txids?.map((txid) => (
                <code className={styles.address} key={txid}>
                  {txid}
                </code>
              ))}
              <p>
                Submission is not confirmation. Refresh to reconcile with
                scanned history. Unknown sends remain blocked to prevent
                duplicate payments.
              </p>
              <button
                disabled={busy}
                onClick={() => void perform("Reconciling transaction", refresh)}
              >
                Check transaction status
              </button>
            </section>
          )}
          {panel === "receive" && (
            <WalletModal
              error={error}
              stage={stage}
              title="Receive TAZ"
              busy={false}
              close={() => {
                setPanel(undefined);
                setQr("");
                setCopied(false);
              }}
            >
              <span className={styles.eyebrow}>ZCASH TESTNET</span>
              <p>Send only Zcash testnet funds to this address.</p>
              {qr && qrAddress === state.address && (
                <img
                  className={styles.qr}
                  src={qr}
                  width={240}
                  height={240}
                  alt="QR code containing this wallet's testnet receiving address"
                />
              )}
              <p className={styles.address}>{state.address}</p>
              <button onClick={copy}>
                {copied ? "Copied" : "Copy receiving address"}
              </button>
              {state.birthday && (
                <small>Recovery birthday: {state.birthday}</small>
              )}
            </WalletModal>
          )}
          {panel === "faucet" && (
            <WalletModal
              error={error}
              stage={stage}
              title="Get TAZ"
              busy={busy}
              close={() => setPanel(undefined)}
            >
              <p className={styles.address}>{state.address}</p>
              <button onClick={copy}>
                {copied ? "Copied" : "Copy receiving address"}
              </button>
              <span className={styles.eyebrow}>FAUZEC · PUBLIC TESTNET</span>
              <h2>Get Free Testnet TAZ</h2>
              <p>
                {network
                  ? `${formatZats(network.drip_zat)} TAZ per claim. ${network.address_cooldown_hours}-hour address cooldown.`
                  : "Current drip and cooldown unavailable. Check the official faucet."}
              </p>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  !!phrase ||
                  !!claim ||
                  !network ||
                  network.captcha_mode !== "local_test"
                }
                onClick={() =>
                  void perform("Requesting faucet TAZ", async () => {
                    await worker().request("validate", {
                      address: state.address,
                    });
                    await submitClaim(state.address, setClaim);
                  })
                }
              >
                Request TAZ from Fauzec
              </button>
              {network && network.captcha_mode !== "local_test" && (
                <p>
                  Fauzec requires verification. Copy your receiving address and
                  use the official faucet link below. ZYRO cannot bypass this
                  check.
                </p>
              )}
              <a
                className={styles.textButton}
                href="https://fauzec.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open official Fauzec website <ExternalLink size={14} />
              </a>
              <p className={styles.fine}>
                If human verification is required, copy your address and finish
                on Fauzec. A receipt never updates wallet balances; blockchain
                scanning does.
              </p>
              {claim && (
                <div className={styles.receipt}>
                  <strong>{claim.state || "Submission uncertain"}</strong>
                  <small>Request ID</small>
                  <code>{claim.request_id}</code>
                  {claim.txid && (
                    <>
                      <small>Transaction ID</small>
                      <code>{claim.txid}</code>
                    </>
                  )}
                  {claim.next_eligible_at_ms && (
                    <p>
                      Next eligible:{" "}
                      {new Date(claim.next_eligible_at_ms).toLocaleString()}
                    </p>
                  )}
                  {claim.error_code && (
                    <p>{faucetMessage[claim.error_code] || claim.error_code}</p>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        "Checking original faucet request",
                        async () => {
                          const next = await faucetRequest(
                            `status/${encodeURIComponent(claim.request_id)}`,
                          );
                          localStorage.setItem(
                            claimKey(state.address),
                            JSON.stringify(next),
                          );
                          setClaim(next);
                          if (next.state === "confirmed") await refresh();
                        },
                      )
                    }
                  >
                    Resume request status
                  </button>
                </div>
              )}
            </WalletModal>
          )}
          {panel === "activity" && (
            <WalletModal
              error={error}
              stage={stage}
              title="Activity"
              busy={false}
              close={() => setPanel(undefined)}
            >
              <p>Private details come from this wallet’s blockchain scan.</p>
              {rows.length ? (
                <WalletActivity rows={rows} />
              ) : (
                <div className={styles.empty}>
                  <ArrowDownLeft size={24} />
                  <h3>
                    {state.synced
                      ? "No transactions yet"
                      : "Waiting for wallet synchronization"}
                  </h3>
                  <p>
                    {state.kind === "noir"
                      ? "Open Noir Wallet for private transaction history."
                      : "Receive testnet TAZ to begin. Incoming funds appear after the wallet scans them."}
                  </p>
                </div>
              )}
            </WalletModal>
          )}
        </>
      )}
      <footer className={styles.footer}>
        <ShieldCheck size={16} />
        Testnet funds only. Keys stay on your device.
        <a href="/zcash-wallet/PROVENANCE.md" target="_blank" rel="noreferrer">
          Engine notices
        </a>
      </footer>
    </section>
  );
}
