"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { api, useData } from "./data";
import { Button } from "./ui/button";
type Observation = {
  txid: string;
  network: string;
  state: string;
  confirmations: number;
  checkedAt: string;
  notice: string;
  lastError?: string | null;
  minedHeight?: number | null;
  decoded?: {
    transparentInputs: number;
    transparentOutputs: number;
    ironwoodActions: number;
    orchardActions: number;
    saplingOutputs: number;
  };
};
export function WalletObserver() {
  const {
    data,
    error: loadError,
    reload,
  } = useData<Observation[]>("/zcash/observations");
  const polling = useRef(false);
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh(id: string) {
    setBusy(true);
    setError("");
    try {
      await api("/zcash/observe", { txid: id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await reload();
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!data?.some((t) => t.state === "MEMPOOL" || t.state === "CONFIRMING"))
      return;
    const timer = setInterval(() => {
      if (polling.current || document.hidden) return;
      polling.current = true;
      void (async () => {
        try {
          const results = await Promise.allSettled(
            data
              .filter((t) => t.state === "MEMPOOL" || t.state === "CONFIRMING")
              .slice(0, 10)
              .map((t) => api("/zcash/observe", { txid: t.txid })),
          );
          const failed = results.find((r) => r.status === "rejected");
          if (failed?.status === "rejected")
            setError(
              failed.reason instanceof Error
                ? failed.reason.message
                : "Refresh failed",
            );
          await reload();
        } finally {
          polling.current = false;
        }
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [data, reload]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/zcash/observe", { txid });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <h3>Observe a testnet/regtest transaction</h3>
      <p className="muted tiny">
        Requires an operator-configured node. Observation verifies chain state
        only; it cannot verify a shielded recipient or amount.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="txid">Transaction ID</label>
          <input
            id="txid"
            required
            pattern="[a-f0-9]{64}"
            maxLength={64}
            value={txid}
            onChange={(e) => setTxid(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="64 lowercase hexadecimal characters"
          />
        </div>
        <Button disabled={busy} className="full">
          {busy ? "Checking node…" : "Check testnet transaction"}
        </Button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <div className="notice error" role="alert">
          {loadError}
          <Button variant="secondary" onClick={reload}>
            Retry history
          </Button>
        </div>
      )}
      <p className="muted tiny" style={{ marginTop: 16 }}>
        Pending observations refresh every 15 seconds while this page is
        visible. Confirmed observations require a manual recheck; confirmations
        can change after a reorganization.
      </p>
      {data?.map((t) => (
        <div className="result" key={t.txid}>
          <strong style={{ fontSize: 16 }}>
            {t.lastError ? "STALE · " : ""}
            {t.state}
          </strong>
          <p className="hash">{t.txid}</p>
          <p className="tiny muted">
            {t.network} · {t.confirmations} confirmations
            <br />
            Checked {new Date(t.checkedAt).toLocaleString()}
            <br />
            {t.notice}
          </p>
          {t.decoded && (
            <p className="tiny muted">
              Decoded structure: {t.decoded.ironwoodActions} Ironwood actions ·{" "}
              {t.decoded.orchardActions} Orchard actions ·{" "}
              {t.decoded.saplingOutputs} Sapling outputs. Transparent
              inputs/outputs: {t.decoded.transparentInputs}/
              {t.decoded.transparentOutputs}.
              {t.minedHeight
                ? " Mined height: " +
                  t.minedHeight.toLocaleString("en-US") +
                  "."
                : ""}
            </p>
          )}
          {t.lastError && (
            <p role="status" className="muted tiny">
              Last refresh failed: {t.lastError}. Status above is the last
              successful observation.
            </p>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => refresh(t.txid)}
          >
            Recheck transaction
          </Button>
        </div>
      ))}
    </div>
  );
}
