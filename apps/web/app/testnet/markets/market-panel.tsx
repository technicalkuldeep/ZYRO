"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./markets.module.css";

export function MarketPanel() {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [data, setData] = useState<{
    readiness?: { ledger?: string; reason?: string; fundingEnabled?: boolean };
    markets?: Array<{
      id: string;
      status: string;
      confirmedPositions: number;
      prizePoolZatoshis: string;
      sides: Array<{ side: "YES" | "NO"; status: string; stake: number }>;
    }>;
    history?: Array<{ id: string; marketId: string; side: "YES" | "NO"; status: string; stake: number }>;
  }>({});
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [readiness, markets, history] = await Promise.all([
          fetch("/api/testnet/taz/readiness", { credentials: "same-origin", cache: "no-store" }),
          fetch("/api/testnet/taz/markets", { credentials: "same-origin", cache: "no-store" }),
          fetch("/api/testnet/taz/history", { credentials: "same-origin", cache: "no-store" }),
        ]);
        if (![readiness, markets, history].every((response) => response.ok)) return;
        const [r, m, h] = await Promise.all([readiness.json(), markets.json(), history.json()]);
        if (active) setData({ readiness: r, markets: m.markets, history: h.positions });
      } catch {
        // Keep the explicit unavailable state when the dedicated Testnet ledger is absent.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const market = data.markets?.find((row) => row.status === "open" || row.status === "frozen") ?? data.markets?.[0];
  const readiness = data.readiness;
  const zats = (amount: string) => {
    const value = BigInt(amount);
    return `${value / 100_000_000n}.${String(value % 100_000_000n).padStart(8, "0")} TAZ`;
  };
  return (
    <section className={styles.marketPanel} aria-labelledby="round-title">
      <div className={styles.marketIntro}>
        <div>
          <p className={styles.eyebrow}>BTC / USD · TWO SIDES · FIXED STAKE</p>
          <h2 id="round-title">Will Bitcoin rise?</h2>
          <p>
            A proposed 60-second round starts its price window only after one
            YES and one NO deposit are independently recognized and confirmed.
          </p>
        </div>
        <div className={styles.roundState}>
          <span />
          <div><strong>{market ? `Round ${market.id.slice(0, 8)} · ${market.status}` : "No live round available"}</strong><small>{readiness?.ledger === "connected" ? "Testnet ledger connected · intake paused" : "Testnet market ledger unavailable"}</small></div>
        </div>
      </div>

      <div className={styles.marketGrid}>
        <div className={styles.marketRules}>
          <div className={styles.ruleRow}><span>Reference</span><strong>Coinbase BTC-USD spot at lock</strong></div>
          <div className={styles.ruleRow}><span>Prediction window</span><strong>60 seconds after both deposits confirm</strong></div>
          <div className={styles.ruleRow}><span>Result</span><strong>Higher is YES · equal or lower is NO</strong></div>
          <div className={styles.ruleRow}><span>Resolution</span><strong>Completed Coinbase candle; invalid data pauses</strong></div>
          <div className={styles.disclosure}>
            This planned round is not accepting TAZ. The operator-controlled Testnet
            custody account and real payout flow have not passed live acceptance.
            V1 settlement is planned around centralized single-key operator custody;
            it is not decentralized or FROST-backed.
          </div>
        </div>

        <div className={styles.entryCard}>
          <div className={styles.entryHead}><span>YOUR PREDICTION</span><span>0.01 TAZ</span></div>
          <div className={styles.sideChoices} role="group" aria-label="Choose prediction side">
            {(["YES", "NO"] as const).map((choice) => (
              <button
                type="button"
                key={choice}
                className={`${styles.sideChoice} ${side === choice ? styles.selected : ""}`}
                aria-pressed={side === choice}
                onClick={() => setSide(choice)}
              >
                <span>{choice}</span>
                <small>{choice === "YES" ? "Price finishes higher" : "Price finishes equal or lower"}</small>
              </button>
            ))}
          </div>
          <div className={styles.entrySummary}>
            <div><span>Stake</span><strong>0.01 TAZ</strong></div>
            <div><span>Potential pool with an opposing deposit</span><strong>0.02 TAZ</strong></div>
            <div><span>Selected side</span><strong>{side}</strong></div>
          </div>
          <button className={styles.disabledAction} type="button" disabled>
            {readiness?.fundingEnabled ? "Funding unavailable pending release gate" : "Funding unavailable"}
          </button>
          <p className={styles.entryNote}>
            No payment request or receiver is issued until a real funding intent
            is committed by the Testnet market ledger.
          </p>
          <div className={styles.entryLinks}>
            <Link href="/wallet/testnet">Open Testnet wallet</Link>
            <a href="https://fauzec.com/" target="_blank" rel="noreferrer">Get valueless Testnet TAZ ↗</a>
          </div>
        </div>
      </div>

      <div className={styles.myPositions}>
        <div><p className={styles.eyebrow}>MY PREDICTIONS</p><h3>Positions appear here after verified funding</h3></div>
        <span>{market ? `${market.confirmedPositions} confirmed · ${zats(market.prizePoolZatoshis)} prize pool` : "No live Testnet position is connected"}</span>
      </div>
      {data.history?.length ? <div className={styles.myPositions} aria-label="My Testnet predictions"><div><p className={styles.eyebrow}>MY TESTNET PREDICTIONS</p><h3>Verified market history</h3></div><ul>{data.history.map((position) => <li key={position.id}>{position.side} · {position.stake / 100_000_000} TAZ · {position.status}</li>)}</ul></div> : null}
    </section>
  );
}
