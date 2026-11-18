"use client";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Clock3,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useData, api, DataState } from "./data";
import { useAuth, points } from "./auth";
import type { ArenaData } from "./arena-product";
export type CandleUI = { time: number; close: number; raw: number[] };
export type CryptoMarketUI = {
  _id: string;
  spec: {
    pair: string;
    threshold: number;
    operator: string;
    candleStart: number;
    cutoff: number;
    observationTime: number;
    provider: string;
    reference: { close: number; time: number };
    referenceFetchedAt: string;
    timezone: string;
    method: string;
    unavailable: string;
    equality: string;
  };
  specHash: string;
  status: string;
  disabled: boolean;
  createdAt: string;
  attempts: number;
  lastError?: string;
  outcome?: string;
  evidence?: {
    pair: string;
    provider: string;
    fetchedAt: string;
    url: string;
    candle: CandleUI;
  };
};
export const usd = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
export const utc = (v: number | string) =>
  new Date(v)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
function marketStatus(m: CryptoMarketUI) {
  return m.status === "RESOLVED"
    ? "Resolved"
    : m.status === "CANCELLED"
      ? "Refunded"
      : m.status === "PENDING_VERIFICATION"
        ? "Pending verification"
        : m.disabled
          ? "Entry paused"
          : Date.now() >= m.spec.cutoff
            ? "Awaiting outcome"
            : "Open for predictions";
}
export function AssetIcon({ pair }: { pair: string }) {
  return (
    <span className={`asset-icon asset-${pair.split("-")[0].toLowerCase()}`}>
      {pair.startsWith("BTC") ? "₿" : pair.startsWith("ETH") ? "Ξ" : "≋"}
    </span>
  );
}
export function CryptoCard({ market: m }: { market: CryptoMarketUI }) {
  return (
    <Link
      href={`/arena/crypto/${encodeURIComponent(m._id)}`}
      className="crypto-market-card"
    >
      <div className="crypto-card-head">
        <AssetIcon pair={m.spec.pair} />
        <span>
          {m.spec.pair}
          <small>REAL-WORLD / CRYPTO</small>
        </span>
        <ArrowUpRight size={17} />
      </div>
      <h3>
        Will {m.spec.pair.split("-")[0]} close above{" "}
        <em className="mono">{usd(m.spec.threshold)}</em>?
      </h3>
      <div className="crypto-card-target">
        <span className="target-line" />
        <span className="mono">FIXED THRESHOLD</span>
        <b className="mono">{usd(m.spec.threshold)}</b>
      </div>
      <div className="crypto-yesno">
        <span>
          YES <ArrowUpRight size={13} />
        </span>
        <span>
          NO <ArrowUpRight size={13} />
        </span>
      </div>
      <div className="crypto-card-time">
        <Clock3 size={13} />
        {utc(m.spec.observationTime)}
      </div>
      <div className="crypto-card-bottom">
        <span>{marketStatus(m)}</span>
        <small>Coinbase · 1m close</small>
      </div>
    </Link>
  );
}
export function PriceChart({
  candles,
  threshold,
}: {
  candles: CandleUI[];
  threshold: number;
}) {
  const values = candles.map((c) => c.close);
  if (!values.length) return <p>No completed chart data available.</p>;
  const min = Math.min(...values, threshold) * 0.9998,
    max = Math.max(...values, threshold) * 1.0002,
    scale = (n: number) => 220 - ((n - min) / (max - min)) * 190;
  const line = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i / (values.length - 1 || 1)) * 760},${scale(v)}`,
    )
    .join(" ");
  const y = scale(threshold);
  return (
    <div className="crypto-price-chart">
      <svg
        viewBox="0 0 760 245"
        role="img"
        aria-label={`Completed one-minute candle closes. Fixed threshold ${usd(threshold)}.`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="currentColor" stopOpacity=".16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[35, 95, 155, 215].map((v) => (
          <path key={v} d={`M0 ${v} H760`} className="chart-gridline" />
        ))}
        <path d={`${line} L760 245 L0 245 Z`} fill="url(#price-fill)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" />
        <path d={`M0 ${y} H760`} className="threshold-line" />
        <text x="8" y={Math.max(15, y - 8)} className="threshold-label">
          THRESHOLD {usd(threshold)}
        </text>
      </svg>
      <div className="chart-times">
        <span>{utc(candles[0].time * 1000)}</span>
        <span>{utc(candles.at(-1)!.time * 1000)}</span>
      </div>
    </div>
  );
}
export function CryptoDetail({ id }: { id: string }) {
  const {
    data: m,
    error,
    reload,
  } = useData<CryptoMarketUI>(`/account/crypto/${encodeURIComponent(id)}`);
  const arena = useData<ArenaData>("/account/arena");
  const { refresh } = useAuth();
  const price = useData<{
    candles: CandleUI[];
    source: string;
    fetchedAt: string;
  }>(`/account/prices/${id.split(":")[0]}`);
  const [side, setSide] = useState("YES"),
    [stake, setStake] = useState("10"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [now, setNow] = useState(Date.now());
  const op = useRef(""),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!m || !arena.data)
    return (
      <DataState
        error={error || arena.error}
        retry={() => {
          void reload();
          void arena.reload();
        }}
      />
    );
  const pending = arena.data.rounds.filter(
      (r) => r.marketId === id && r.status === "PENDING",
    ),
    last = arena.data.rounds.find(
      (r) => r.marketId === id && r.status !== "PENDING",
    );
  const amount = Number(stake),
    valid =
      /^\d+$/.test(stake) &&
      amount >= 10 &&
      amount <= 100 &&
      amount <= arena.data.account.available;
  const open = m.status === "OPEN" && !m.disabled && now < m.spec.cutoff;
  const seconds = Math.max(0, Math.floor((m.spec.cutoff - now) / 1000));
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/account/crypto/${encodeURIComponent(id)}/predict`, {
        side,
        stake: amount,
        operation: op.current,
        specHash: m!.specHash,
      });
      dialog.current?.close();
      await arena.reload();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update() {
    await Promise.all([reload(), arena.reload(), price.reload()]);
    await refresh();
  }
  return (
    <div className="arena-v5 crypto-detail">
      <div className="game-breadcrumb">
        <Link href="/arena/crypto">← Real-World Predictions</Link>
        <span className="tag">{marketStatus(m)}</span>
      </div>
      <div className="crypto-detail-title">
        <AssetIcon pair={m.spec.pair} />
        <div>
          <span className="overline green">
            {m.spec.pair} / COINBASE EXCHANGE
          </span>
          <h1>
            Above {usd(m.spec.threshold)}
            <span>?</span>
          </h1>
          <p>One fixed threshold. One completed UTC candle.</p>
        </div>
      </div>
      <div className="crypto-detail-layout">
        <div>
          <section className="crypto-chart-panel">
            <div className="crypto-price-heading">
              <div>
                <span>MOST RECENT COMPLETED CLOSE</span>
                <strong className="mono">
                  {price.data ? usd(price.data.candles.at(-1)!.close) : "—"}
                </strong>
              </div>
              <button className="button ghost" onClick={() => void update()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
            {price.data ? (
              <PriceChart
                candles={price.data.candles}
                threshold={m.spec.threshold}
              />
            ) : (
              <DataState error={price.error} retry={price.reload} />
            )}
            <p className="chart-provenance">
              Coinbase Exchange · Completed 1m candles ·{" "}
              {price.data
                ? `Fetched ${utc(price.data.fetchedAt)}`
                : "Unavailable"}
              <br />
              Recent historical data, not a live price feed.
            </p>
          </section>
          <div className="market-timeline">
            <div>
              <span>ENTRY CUTOFF</span>
              <strong>{utc(m.spec.cutoff)}</strong>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>CANDLE CLOSE / OBSERVATION</span>
              <strong>{utc(m.spec.observationTime)}</strong>
            </div>
          </div>
          {!!pending.length && (
            <section className="scheduled-pending">
              <Clock3 size={28} />
              <div>
                <span className="overline green">YOUR PREDICTION IS SAVED</span>
                <h2>
                  {m.status === "PENDING_VERIFICATION"
                    ? "Checking the source."
                    : "A little patience. A real outcome."}
                </h2>
                <p>
                  {pending
                    .map((r) => `${r.side} · ${r.stake} points`)
                    .join(" / ")}{" "}
                  committed. Available points were already deducted.
                </p>
                <p>
                  {now < m.spec.observationTime
                    ? "This prediction remains pending until the exact observation candle has closed."
                    : "The backend worker is retrieving and verifying the completed candle. No manual result claim is needed."}
                </p>
                <button className="text-link" onClick={() => void update()}>
                  Check status <RefreshCw size={13} />
                </button>
              </div>
            </section>
          )}
          {last && (
            <div
              className={`game-result-banner verdict-${last.result?.verdict}`}
              role="status"
            >
              <span className="overline">YOUR SETTLED PREDICTION</span>
              <h2>
                {last.result?.verdict === "WIN"
                  ? "A well-timed perspective."
                  : last.status === "CANCELLED"
                    ? "Your stake was refunded."
                    : "The market had another answer."}
              </h2>
              <p>
                Your call {last.side} · Outcome {last.result?.label} ·{" "}
                {points(last.payout)} points returned.
              </p>
            </div>
          )}
          <section className="market-rules">
            <span className="overline green">IMMUTABLE MARKET RULES</span>
            <h2>Know exactly what counts.</h2>
            <div className="market-rule-grid">
              <div>
                <span>YES</span>
                <p>
                  Closing price strictly greater than{" "}
                  <b className="mono">{usd(m.spec.threshold)}</b>.
                </p>
              </div>
              <div>
                <span>NO</span>
                <p>
                  Closing price less than or equal to the threshold. Equality is
                  NO, not a tie.
                </p>
              </div>
            </div>
            <p>
              Use the last traded price of the Coinbase Exchange {m.spec.pair}{" "}
              one-minute candle starting <b>{utc(m.spec.candleStart * 1000)}</b>{" "}
              and ending <b>{utc(m.spec.observationTime)}</b>. The first
              provider retrieval is at least ten seconds after close.
            </p>
            <p>
              If that exact completed candle is absent or invalid, the market
              remains Pending Verification. Retry every 60 seconds; refund after
              24 hours without usable evidence. Pausing entries does not change
              existing predictions.
            </p>
            <p>
              Virtual Arena payout: win returns 2× stake, loss returns zero. No
              matched human counterparty and no cash value.
            </p>
            <details>
              <summary>View published specification</summary>
              <p className="hash">SHA-256: {m.specHash}</p>
              <pre>{JSON.stringify(m.spec, null, 2)}</pre>
            </details>
          </section>
          {m.evidence && (
            <section className="source-evidence">
              <span className="overline green">
                <ShieldCheck size={14} /> SOURCE EVIDENCE
              </span>
              <h2>Outcome: {m.outcome}</h2>
              <p className="mono">
                Verified close {usd(m.evidence.candle.close)} / Fixed threshold{" "}
                {usd(m.spec.threshold)}
              </p>
              <p>
                {m.evidence.pair} · Candle start{" "}
                {utc(m.evidence.candle.time * 1000)}
                <br />
                Retrieved {utc(m.evidence.fetchedAt)}
              </p>
              <a
                className="text-link"
                href={m.evidence.url}
                target="_blank"
                rel="noreferrer"
              >
                Inspect provider endpoint <ExternalLink size={14} />
              </a>
              <details>
                <summary>Raw source candle</summary>
                <pre>{JSON.stringify(m.evidence.candle.raw)}</pre>
              </details>
            </section>
          )}
        </div>
        <aside>
          <div className="stake-ticket">
            <span className="overline green">REAL-WORLD / VIRTUAL STAKE</span>
            <h2>{open ? "Make your prediction." : "Entries are closed."}</h2>
            <div className="entry-countdown">
              <Clock3 size={15} />
              {open
                ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s to enter`
                : marketStatus(m)}
            </div>
            <div className="game-choice-grid choices-2">
              {["YES", "NO"].map((s) => (
                <button
                  key={s}
                  disabled={!open || !!pending.length}
                  className={side === s ? "chosen" : ""}
                  aria-pressed={side === s}
                  onClick={() => {
                    setSide(s);
                    op.current = "";
                  }}
                >
                  {s}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            <div className="ticket-balance">
              <span>Available</span>
              <b className="mono">{points(arena.data.account.available)} PTS</b>
            </div>
            <label htmlFor="market-stake">Point stake</label>
            <div className="v5-stake-input">
              <input
                id="market-stake"
                inputMode="numeric"
                value={stake}
                disabled={!open || !!pending.length}
                onChange={(e) => {
                  setStake(e.target.value);
                  op.current = "";
                }}
              />
              <span>PTS</span>
            </div>
            <div className="ticket-outcomes">
              <span>
                Potential return{" "}
                <b className="mono green">{points(amount * 2)} PTS</b>
              </span>
              <span>
                Available after entry{" "}
                <b className="mono">
                  {valid ? points(arena.data.account.available - amount) : "—"}
                </b>
              </span>
            </div>
            <button
              className="button primary full-width"
              disabled={!valid || !open || !!pending.length || busy}
              onClick={() => {
                if (!op.current) op.current = crypto.randomUUID();
                dialog.current?.showModal();
              }}
            >
              {pending.length
                ? "Prediction committed"
                : open
                  ? "Review prediction"
                  : "Entry unavailable"}
              <ArrowRight size={16} />
            </button>
            <p className="tiny muted">
              Resolution uses genuine Coinbase data. The backend worker settles
              eligible predictions; refreshing does not determine the outcome.
            </p>
          </div>
          <section className="provider-note">
            <ShieldCheck size={22} />
            <h3>Source, not speculation.</h3>
            <p>
              Threshold set from an actual completed reference close:{" "}
              <b>{usd(m.spec.reference.close)}</b> at{" "}
              {utc(m.spec.reference.time * 1000)}.
            </p>
            <p>
              Specification published {utc(m.createdAt)}. It cannot be edited
              through Arena or admin APIs.
            </p>
          </section>
        </aside>
      </div>
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
      <dialog
        ref={dialog}
        className="zyro-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <span className="overline green">CONFIRM SCHEDULED PREDICTION</span>
          <h2>
            {m.spec.pair} above {usd(m.spec.threshold)}?
          </h2>
          <p>
            <strong>{side}</strong> · {amount} ZYRO Points
            <br />
            Observation: {utc(m.spec.observationTime)}
          </p>
          <p>
            Points stay committed until the backend verifies the exact completed
            candle, or the published 24-hour refund policy applies. You cannot
            cancel to avoid a market outcome.
          </p>
          {message && <p role="alert">{message}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Go back
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Committing…" : "Confirm prediction"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
