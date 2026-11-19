"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Round } from "@zyro/shared";
import { useAuth, points, type Balance } from "./auth";
import { api, DataState } from "./data";
import { LiveCryptoChart, priceText } from "./live-crypto-chart";
type Market = {
  _id: string;
  phase: string;
  status: string;
  specHash: string;
  spec: {
    pair: string;
    entryOpens: number;
    cutoff: number;
    start: number;
    end: number;
    startingCandle: number;
    endingCandle: number;
  };
  opening?: { close: number };
  outcome?: string;
  lastError?: string;
  evidence?: {
    opening: { close: number; time: number };
    closing: { close: number; time: number };
    fetchedAt: string;
    urls: string[];
    specHash: string;
  };
};
type Data = {
  serverTime: number;
  rounds: Market[];
  positions: Round[];
  account: Balance;
};
const time = (n: number) =>
  new Date(n).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + " UTC";
function phase(m: Market, now: number) {
  return [
    "SETTLED",
    "CANCELLED",
    "DISPUTED",
    "DATA_DELAYED",
    "RESULT_VERIFIED",
  ].includes(m.status)
    ? m.status
    : now < m.spec.entryOpens
      ? "UPCOMING"
      : now < m.spec.cutoff
        ? "ENTRY_OPEN"
        : now < m.spec.start
          ? "ENTRY_LOCKED"
          : now < m.spec.end
            ? "LIVE"
            : "AWAITING_PRICE_EVIDENCE";
}
export function FastCryptoExperience() {
  const { refresh } = useAuth();
  const [pair, setPair] = useState("BTC-USD"),
    [data, setData] = useState<Data>(),
    [error, setError] = useState(""),
    [submissionError, setSubmissionError] = useState("");
  const [selected, setSelected] = useState(""),
    [direction, setDirection] = useState<"UP" | "DOWN">("UP"),
    [stake, setStake] = useState(10),
    [busy, setBusy] = useState(false),
    [feed, setFeed] = useState("Connecting");
  const [now, setNow] = useState(0),
    operation = useRef(""),
    inflight = useRef(false),
    clock = useRef({ server: 0, at: 0 }),
    lastBalance = useRef<string | undefined>(undefined);
  function chooseRound(id: string) {
    setSelected(id);
    operation.current = "";
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("round", id);
    else url.searchParams.delete("round");
    window.history.replaceState(null, "", url);
  }
  async function load() {
    try {
      const d = await api<Data>("/account/fast");
      clock.current = { server: d.serverTime, at: performance.now() };
      setNow(d.serverTime);
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let alive = true;
    const saved = new URLSearchParams(window.location.search).get("round");
    if (saved) {
      setSelected(saved);
      const asset = saved.split(":")[1];
      if (["BTC-USD", "ETH-USD", "SOL-USD"].includes(asset)) setPair(asset);
    }
    async function poll() {
      try {
        const d = await api<Data>("/account/fast");
        if (alive) {
          clock.current = { server: d.serverTime, at: performance.now() };
          setData(d);
          setNow(d.serverTime);
          setError("");
          const balanceSignature = `${d.account.available}:${d.account.committed}`;
          if (
            lastBalance.current !== undefined &&
            lastBalance.current !== balanceSignature
          )
            void refresh();
          lastBalance.current = balanceSignature;
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void poll();
    const t = setInterval(() => void poll(), 3000),
      c = setInterval(() => {
        if (clock.current.server)
          setNow(clock.current.server + performance.now() - clock.current.at);
      }, 250);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, []);
  if (!data)
    return (
      <div className="fast-terminal">
        <DataState error={error} retry={() => void load()} />
      </div>
    );
  const markets = data.rounds
    .filter((r) => r.spec.pair === pair)
    .sort((a, b) => a.spec.start - b.spec.start);
  const m =
    markets.find((r) => r._id === selected) ||
    markets.find((r) => now >= r.spec.entryOpens && now < r.spec.end) ||
    markets.find((r) => r.spec.cutoff > now) ||
    markets.at(-1);
  const position = data.positions.find((p) => p.marketId === m?._id),
    state = m ? phase(m, now) : "UPCOMING";
  const target = m
    ? now < m.spec.cutoff
      ? m.spec.cutoff
      : now < m.spec.start
        ? m.spec.start
        : m.spec.end
    : now;
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const canEnter =
    !!m &&
    state === "ENTRY_OPEN" &&
    feed === "Live" &&
    !position &&
    !busy &&
    stake >= 10 &&
    stake <= 100 &&
    Number.isInteger(stake) &&
    stake <= data.account.available &&
    !error;
  async function submit() {
    if (!canEnter || !m || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setSubmissionError("");
    if (!operation.current) operation.current = crypto.randomUUID();
    try {
      await api(`/account/fast/${encodeURIComponent(m._id)}/predict`, {
        direction,
        stake,
        operation: operation.current,
        specHash: m.specHash,
      });
      chooseRound(m._id);
      operation.current = "";
      await load();
      await refresh();
    } catch (e) {
      setSubmissionError((e as Error).message);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="fast-terminal">
      <header className="fast-heading">
        <div>
          <Link href="/arena/crypto" className="overline">
            ARENA / LIVE CRYPTO
          </Link>
          <h1>
            Two minutes.
            <br />
            <em>Make your call.</em>
          </h1>
          <p>Real prices. Your perspective. Virtual points only.</p>
        </div>
        <div className="fast-balance">
          <small>AVAILABLE ZYRO POINTS</small>
          <strong>
            {points(data.account.available)} <span>PTS</span>
          </strong>
          <small>
            {points(data.account.committed)} committed · No cash value
          </small>
        </div>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error} · Entries paused until the connection recovers.
        </p>
      )}
      <nav className="fast-assets" aria-label="Cryptocurrency">
        {["BTC-USD", "ETH-USD", "SOL-USD"].map((p, i) => (
          <button
            key={p}
            aria-pressed={pair === p}
            onClick={() => {
              setPair(p);
              chooseRound("");
              operation.current = "";
            }}
          >
            <span className={`fast-coin coin-${i}`}>{["₿", "Ξ", "◎"][i]}</span>
            <span>
              {["Bitcoin", "Ethereum", "Solana"][i]}
              <small>{p}</small>
            </span>
            <span className="asset-arrow">↗</span>
          </button>
        ))}
      </nav>
      <div className="fast-workspace">
        <div className="fast-chart-panel">
          <div className="fast-market-bar">
            <strong>{pair.replace("-", " / ")}</strong>
            <span>SPOT PRICE / USD</span>
            <span className="fast-phase">{state.replaceAll("_", " ")}</span>
          </div>
          <LiveCryptoChart
            pair={pair}
            reference={m?.opening?.close}
            onStatus={setFeed}
          />
          <div className="fast-observation">
            <div>
              <small>OFFICIAL OPENING REFERENCE</small>
              <strong>{priceText(m?.opening?.close)}</strong>
              <span>
                {m?.opening
                  ? "Completed Coinbase 1m candle"
                  : "Locks after entry closes, at observation start"}
              </span>
            </div>
            <div>
              <small>
                {now < (m?.spec.cutoff || 0)
                  ? "ENTRY CLOSES IN"
                  : now < (m?.spec.start || 0)
                    ? "OBSERVATION STARTS IN"
                    : now < (m?.spec.end || 0)
                      ? "WINDOW ENDS IN"
                      : "VERIFICATION"}
              </small>
              <strong
                className={seconds < 15 && seconds > 0 ? "countdown-near" : ""}
              >
                {seconds
                  ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                  : state === "SETTLED"
                    ? "Final"
                    : "Awaiting evidence"}
              </strong>
              <span>Clock synchronized to the server</span>
            </div>
          </div>
        </div>
        <aside className="fast-ticket" id="fast-ticket">
          <span className="overline green">2-MINUTE PREDICTION</span>
          <h2>
            Will {pair.split("-")[0]} finish <br />
            higher or lower?
          </h2>
          <p>
            Compare the official opening and closing references across a fixed
            two-minute window.
          </p>
          <div className="fast-times">
            <div>
              <span>Observation starts</span>
              <b>{m ? time(m.spec.start) : "Waiting for schedule"}</b>
            </div>
            <div>
              <span>Observation ends</span>
              <b>{m ? time(m.spec.end) : "—"}</b>
            </div>
          </div>
          {position ? (
            <div
              className={`fast-receipt result-${position.result?.verdict || "pending"}`}
              role="status"
            >
              <span>
                {position.status === "PENDING"
                  ? "✓ POSITION LOCKED"
                  : position.result?.verdict === "WIN"
                    ? "✦ YOU CALLED IT"
                    : position.result?.verdict === "LOSS"
                      ? "ROUND COMPLETE"
                      : "STAKE REFUNDED"}
              </span>
              <strong>
                {position.choice} · {points(position.stake)} points
              </strong>
              <p>
                {position.status === "PENDING"
                  ? "Your position is saved in MongoDB. No changes after acceptance."
                  : `${points(position.payout)} points returned. Official outcome: ${m?.outcome || "Cancelled"}.`}
              </p>
            </div>
          ) : (
            <>
              <div className="fast-directions">
                {(["UP", "DOWN"] as const).map((d) => (
                  <button
                    key={d}
                    aria-pressed={direction === d}
                    className={`direction-${d.toLowerCase()}`}
                    disabled={busy}
                    onClick={() => {
                      setDirection(d);
                      operation.current = "";
                    }}
                  >
                    <span>{d === "UP" ? "↗" : "↘"}</span>
                    {d}
                    <small>
                      {d === "UP" ? "Strictly higher" : "Strictly lower"}
                    </small>
                  </button>
                ))}
              </div>
              <label className="fast-stake">
                Stake · ZYRO Points
                <input
                  type="number"
                  min="10"
                  max="100"
                  step="1"
                  value={Number.isNaN(stake) ? "" : stake}
                  disabled={busy}
                  onChange={(e) => {
                    setStake(e.target.valueAsNumber);
                    operation.current = "";
                  }}
                />
              </label>
              <div className="fast-presets">
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    onClick={() => {
                      setStake(n);
                      operation.current = "";
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="fast-return">
                <span>Potential virtual return</span>
                <strong>{points(stake * 2)} PTS</strong>
              </div>
              <button
                className="button primary fast-submit"
                disabled={!canEnter}
                onClick={() => void submit()}
              >
                {busy
                  ? "Confirming with Arena…"
                  : state !== "ENTRY_OPEN"
                    ? state === "UPCOMING"
                      ? "Entry opens shortly"
                      : "Entry locked"
                    : feed !== "Live"
                      ? "Waiting for fresh Coinbase data"
                      : `Confirm ${direction} · ${points(stake)} points`}
              </button>
            </>
          )}
          {submissionError && (
            <p role="alert" className="notice error">
              {submissionError}
            </p>
          )}
          <p className="fast-lock-copy">
            Entry closes 5 seconds before observation. The indicative streaming
            price is not your official starting reference. Equal prices refund
            your stake.
          </p>
          {m?.lastError && <p className="notice">{m.lastError}</p>}
        </aside>
      </div>
      <section className="fast-round-section">
        <div className="fast-section-title">
          <h2>The round board</h2>
          <span>Every 3 minutes · UTC</span>
        </div>
        <div className="fast-round-board">
          {markets.slice(-10).map((r) => (
            <button
              className={m?._id === r._id ? "selected" : ""}
              key={r._id}
              onClick={() => {
                chooseRound(r._id);
                operation.current = "";
              }}
            >
              <small>{phase(r, now).replaceAll("_", " ")}</small>
              <strong>{time(r.spec.start)}</strong>
              <span>
                {r.outcome || "2-minute window"}{" "}
                {data.positions.some((p) => p.marketId === r._id)
                  ? "· Your position"
                  : ""}
              </span>
            </button>
          ))}
        </div>
        {!markets.length && (
          <p>
            The durable worker is preparing upcoming rounds. This page refreshes
            automatically.
          </p>
        )}
      </section>
      <div className="fast-details">
        <section>
          <h2>Your latest calls</h2>
          {!data.positions.length ? (
            <p>Your confirmed predictions and results will appear here.</p>
          ) : (
            data.positions.slice(0, 12).map((p) => (
              <button
                className="fast-position-row"
                key={p.id}
                onClick={() => {
                  const r = data.rounds.find((r) => r._id === p.marketId);
                  if (r) {
                    setPair(r.spec.pair);
                    chooseRound(r._id);
                  }
                }}
              >
                <span>
                  {p.marketId?.split(":")[1]} <b>{p.choice}</b>
                  <small>
                    {new Date(p.createdAt)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}{" "}
                    UTC
                  </small>
                </span>
                <span>
                  {points(p.stake)} PTS
                  <small>
                    {p.result?.verdict || "Pending evidence"}
                    {p.payout != null ? ` · ${points(p.payout)} returned` : ""}
                  </small>
                </span>
              </button>
            ))
          )}
        </section>
        <section>
          <h2>The resolution record</h2>
          {m?.evidence ? (
            <>
              <p>
                <b>{m.outcome}</b> · Verified {m.evidence.fetchedAt}
              </p>
              <dl className="fast-evidence">
                <dt>Starting candle / close</dt>
                <dd>
                  {time(m.evidence.opening.time * 1000)} /{" "}
                  {priceText(m.evidence.opening.close)}
                </dd>
                <dt>Ending candle / close</dt>
                <dd>
                  {time(m.evidence.closing.time * 1000)} /{" "}
                  {priceText(m.evidence.closing.close)}
                </dd>
                <dt>Immutable specification SHA-256</dt>
                <dd>{m.specHash}</dd>
              </dl>
              {m.evidence.urls.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  Coinbase {i ? "ending" : "starting"} evidence ↗{" "}
                </a>
              ))}
            </>
          ) : (
            <p>
              Final outcome waits for both exact completed Coinbase candles. No
              tick, animation, or browser calculation can settle this round.
            </p>
          )}
          <details>
            <summary>Market rules & data delay policy</summary>
            <p>
              The start is the close of the one-minute candle ending at
              observation start. The finish is the close of the candle ending
              120 seconds later. Compare prices as integer units with eight
              decimal places. UP requires strictly greater; DOWN strictly less;
              equality refunds. A 10-point stake returns 20 on a win, 0 on a
              loss, or 10 on a refund. Stakes are 10–100 points; one immutable
              position per user per round.
            </p>
            <p>
              Verification begins at least 10 seconds after each candle ends.
              Missing evidence retries every 30 seconds. After one hour beyond
              the observation end, unavailable evidence cancels the round and
              refunds stakes. Coinbase may delay or revise candles; a stored
              verified outcome is not silently changed. The API worker must run;
              persisted jobs recover after restart.
            </p>
          </details>
        </section>
      </div>
      <a className="fast-mobile-action" href="#fast-ticket">
        {position ? "View your locked position" : "Make a prediction"}{" "}
        <span>↗</span>
      </a>
    </div>
  );
}
