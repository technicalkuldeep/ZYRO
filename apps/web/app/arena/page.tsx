"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Bot, Check, RefreshCw, Sparkles } from "lucide-react";
import type { Side, Round, Session } from "@zyro/shared";
import { PageHeading } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { api, useData, DataState } from "../../components/data";
type Arena = {
  session: Session;
  rounds: Round[];
  stats: { played: number; wins: number; net: number };
};
export default function Arena() {
  const { data, error, reload } = useData<Arena>("/arena");
  const leaders =
    useData<{ name: string; wins: number; played: number; net: number }[]>(
      "/leaderboard",
    );
  const [side, setSide] = useState<Side>("YES");
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const pending = data?.rounds.find((r) => r.status === "PENDING");
  const last = data?.rounds.find((r) => r.status === "RESOLVED");
  async function act() {
    setBusy(true);
    setMessage("");
    try {
      if (pending) {
        await api("/arena/" + pending.id + "/resolve", {});
      } else await api("/arena/predict", { side, stake });
      await reload();
      await leaders.reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const remaining = pending
    ? Math.max(0, Math.ceil((Date.parse(pending.resolveAt) - now) / 1000))
    : 0;
  return (
    <>
      <PageHeading
        eyebrow="NO WALLET. NO PURCHASES. JUST PERSPECTIVE."
        title="Welcome to the Arena."
        description="Make a call, meet your forecasting bot, and find your rhythm."
        action={
          <span className="tag">
            <Sparkles size={14} /> FREE TO PLAY
          </span>
        }
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              ["ZYRO CREDITS", data.session.credits.toLocaleString()],
              ["PREDICTIONS", data.stats.played],
              [
                "WIN RATE",
                data.stats.played
                  ? Math.round((data.stats.wins / data.stats.played) * 100) +
                    "%"
                  : "—",
              ],
              ["NET CREDITS", (data.stats.net > 0 ? "+" : "") + data.stats.net],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="detail-layout">
            <div>
              <section className="arena-stage">
                <span className="tag">
                  <Sparkles size={13} /> QUICK PRACTICE · PROVABLE REVEAL
                </span>
                <h2>
                  Will the next draw land
                  <br />
                  at 50 or above?
                </h2>
                <p>
                  A server-generated number from 0–99. YES means 50–99; NO means
                  0–49. This training round teaches choices, stakes and
                  settlement. It is a random exercise, not a real-world
                  forecast.
                </p>
                <div className="choice-buttons">
                  {(["YES", "NO"] as const).map((s) => (
                    <button
                      key={s}
                      className={
                        "outcome " +
                        s.toLowerCase() +
                        (side === s ? " selected" : "")
                      }
                      aria-pressed={side === s}
                      disabled={!!pending || busy}
                      onClick={() => setSide(s)}
                    >
                      {s}
                      <ArrowRight size={20} />
                    </button>
                  ))}
                </div>
                <div className="arena-controls">
                  <label htmlFor="stake">Practice stake</label>
                  <select
                    id="stake"
                    value={stake}
                    disabled={!!pending || busy}
                    onChange={(e) => setStake(Number(e.target.value))}
                  >
                    {[10, 25, 50, 100].map((v) => (
                      <option key={v} value={v}>
                        {v} credits
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={act}
                    disabled={
                      busy ||
                      (!!pending && remaining > 0) ||
                      (!pending && data.session.credits < stake)
                    }
                    aria-busy={busy}
                  >
                    {busy
                      ? "Processing…"
                      : pending
                        ? remaining > 0
                          ? `Reveal in ${remaining}s`
                          : "Reveal result"
                        : "Lock prediction"}
                    {pending ? (
                      <RefreshCw size={15} />
                    ) : (
                      <ArrowRight size={15} />
                    )}
                  </Button>
                </div>
                {pending && (
                  <div className="result">
                    <p>
                      Your call: <strong>{pending.side}</strong> · Bot:{" "}
                      {pending.botSide}
                    </p>
                    <small className="muted">
                      Draw committed before reveal. Your stake is reserved.
                    </small>
                    <p className="hash">{pending.commitment}</p>
                  </div>
                )}
                {!pending && last && (
                  <div className="result">
                    <strong>
                      {last.payout
                        ? "Good call. +" + last.stake + " credits."
                        : "A new data point. Try again."}
                    </strong>
                    <p>
                      Draw: {last.draw} → {last.outcome} · Your call:{" "}
                      {last.side} · Bot: {last.botSide}
                    </p>
                    <details>
                      <summary>Verify the commitment</summary>
                      <p className="hash">
                        Secret: {last.secret}
                        <br />
                        SHA-256: {last.commitment}
                      </p>
                      <p className="tiny muted">
                        Hash the UTF-8 secret. The first 8 hex digits modulo 100
                        produce the draw. This is server commitment, not
                        independent randomness.
                      </p>
                    </details>
                  </div>
                )}
                {message && (
                  <p className="notice error" role="alert">
                    {message}
                  </p>
                )}
              </section>
              <div className="panel">
                <h2>Your practice history</h2>
                {data.rounds.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>YOUR CALL</th>
                          <th>BOT</th>
                          <th>STAKE</th>
                          <th>RESULT</th>
                          <th>RETURNED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rounds.map((r) => (
                          <tr key={r.id}>
                            <td className={r.side === "YES" ? "green" : ""}>
                              {r.side}
                            </td>
                            <td>{r.botSide}</td>
                            <td>{r.stake}</td>
                            <td>
                              {r.status === "PENDING"
                                ? "Awaiting reveal"
                                : r.outcome + " · " + r.draw}
                            </td>
                            <td>{r.status === "PENDING" ? "—" : r.payout}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    Your first prediction starts your track record.
                  </div>
                )}
              </div>
            </div>
            <aside>
              <div className="panel">
                <Bot className="green" size={28} />
                <h3 style={{ marginTop: 20 }}>Meet Signal.</h3>
                <p className="muted">
                  A transparent, rule-based bot. Signal picks YES if your
                  previous draws average at least 50, otherwise NO. With no
                  history, it starts with YES.
                </p>
                <p className="muted tiny">
                  Signal is an educational comparison. Its choice does not
                  change your payout. Random draws cannot be predicted from past
                  results.
                </p>
              </div>
              <div className="panel">
                <h3>Practice rankings</h3>
                <p className="muted tiny">
                  Ranked by net credits. Guest aliases only. This is a local
                  prototype, not a verified competition.
                </p>
                {leaders.data?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>FORECASTER</th>
                          <th>NET</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaders.data.map((l, i) => (
                          <tr key={l.name}>
                            <td>
                              {i + 1}. {l.name}
                            </td>
                            <td>
                              {l.net > 0 ? "+" : ""}
                              {l.net}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : leaders.error ? (
                  <p role="alert">{leaders.error}</p>
                ) : (
                  <p className="muted">
                    Complete a round to join the rankings.
                  </p>
                )}
              </div>
              <div className="notice">
                <Check size={17} />
                <span>
                  Credits are free, nontransferable, nonredeemable, and never
                  purchasable. Losing this browser session loses access to your
                  guest history.
                </span>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
