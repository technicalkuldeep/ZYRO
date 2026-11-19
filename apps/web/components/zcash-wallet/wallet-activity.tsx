"use client";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Copy, History } from "lucide-react";
import { formatZats } from "../../lib/zcash-wallet/client";
import styles from "./wallet.module.css";
export function WalletActivity({ rows }: { rows: Record<string, unknown>[] }) {
  const [copied, setCopied] = useState<string>();
  const [failed, setFailed] = useState(false);
  const unique = rows.filter(
    (row, index) =>
      !row.txid || rows.findIndex((other) => other.txid === row.txid) === index,
  );
  return (
    <>
      <ul className={styles.history}>
        {unique.map((row, index) => {
          const id =
            typeof row.txid === "string" && /^[a-f0-9]{64}$/i.test(row.txid)
              ? row.txid
              : undefined;
          const incoming = row.kind === "received" || row.kind === "incoming";
          const outgoing = row.kind === "sent" || row.kind === "outgoing";
          return (
            <li key={id || index}>
              <div className={styles.activityHeading}>
                {outgoing ? (
                  <ArrowUpRight size={18} />
                ) : incoming ? (
                  <ArrowDownLeft size={18} />
                ) : (
                  <History size={18} />
                )}
                <strong>
                  {incoming
                    ? "Received"
                    : outgoing
                      ? "Sent"
                      : String(row.kind || "Transfer")}
                </strong>
                <span>{String(row.status || "Unknown")}</span>
              </div>
              {row.amount !== undefined && (
                <strong>
                  {incoming ? "+" : outgoing ? "−" : ""}
                  {formatZats(String(row.amount))} TAZ
                </strong>
              )}
              {row.timestamp !== undefined && (
                <small>
                  {new Date(Number(row.timestamp) * 1000).toLocaleString()}
                </small>
              )}
              <details>
                <summary>
                  {id
                    ? id.slice(0, 12) + "…" + id.slice(-8)
                    : "Transaction details"}
                </summary>
                {id && (
                  <>
                    <code className={styles.address}>{id}</code>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(id);
                          setCopied(id);
                          setFailed(false);
                        } catch {
                          setFailed(true);
                        }
                      }}
                    >
                      <Copy size={16} />
                      {copied === id
                        ? "Transaction ID copied"
                        : "Copy transaction ID"}
                    </button>
                  </>
                )}
                {row.fee !== undefined && (
                  <small>Network fee {formatZats(String(row.fee))} TAZ</small>
                )}
                {row.mined_height !== undefined && (
                  <small>Block {String(row.mined_height)}</small>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert">
          Clipboard unavailable. Select the full transaction ID to copy.
        </p>
      )}
    </>
  );
}
