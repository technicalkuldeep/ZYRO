"use client";
import { useEffect, useState } from "react";
import type { TransactionStatus } from "../../lib/zcash-wallet/transaction-status";
import { externalSendKey } from "../../lib/zcash-wallet/external-send";
export function NoirTransaction({
  txid,
  address,
  reconciled,
}: {
  txid: string;
  address: string;
  reconciled: () => void;
}) {
  const [status, setStatus] = useState<TransactionStatus>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const check = async () => {
      try {
        const response = await fetch(
          `/api/zcash/testnet/transactions/${txid}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
          },
        );
        if (!response.ok)
          throw Error(
            "Public testnet status unavailable. Check Noir before retrying a payment.",
          );
        const next: TransactionStatus = await response.json();
        if (next.txid !== txid || next.network !== "testnet")
          throw Error("Unexpected transaction status response.");
        if (cancelled) return;
        setStatus(next);
        setError("");
      } catch (error) {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "Status unavailable",
          );
      }
      if (!cancelled && ++attempts < 60) timer = setTimeout(check, 30000);
    };
    void check();
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [txid]);
  return (
    <div role="status">
      <p>
        {error ||
          (status
            ? `${status.state} · ${status.confirmations} confirmations${status.minedHeight ? ` · block ${status.minedHeight}` : ""}`
            : "Checking public testnet inclusion…")}
        <br />
        <small>
          Public chain metadata only. Noir remains authoritative for private
          balances and transaction details.
        </small>
      </p>
      {!error && status?.state === "confirmed" && (
        <button
          onClick={() => {
            try {
              const key = externalSendKey(address),
                intent = JSON.parse(localStorage.getItem(key) || "null");
              if (intent?.txid !== txid)
                throw Error("The active submission changed. Refresh Noir.");
              // Retain the public receipt; never store private memo or payment details.
              localStorage.setItem(`${key}:confirmed`, JSON.stringify(status));
              localStorage.removeItem(key);
              reconciled();
            } catch {
              setError(
                "Unable to reconcile the stored payment. Check Noir before retrying.",
              );
            }
          }}
        >
          Acknowledge confirmed payment
        </button>
      )}
    </div>
  );
}
