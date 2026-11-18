"use client";
import Link from "next/link";
import { ArenaHub, roundHref } from "./arena-hub";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Bot,
  CheckCircle2,
  Crosshair,
  Trophy,
  ShieldCheck,
  Clock3,
  Sparkles,
  LockKeyhole,
} from "lucide-react";
import type { Round, Side } from "@zyro/shared";
import { useAuth, points, Avatar, type Balance } from "./auth";
import { api, useData, DataState, date } from "./data";
import { PageHeading } from "./shell";
export type ArenaData = {
  account: Balance;
  rounds: Round[];
  ledger: {
    _id: string;
    kind: string;
    amount: number;
    after: number;
    createdAt: string;
  }[];
};
export function ArenaProduct() {
  const path = usePathname();
  return ["history", "leaderboard", "profile"].includes(path.split("/")[2]) ? (
    <LegacyArenaProduct />
  ) : (
    <ArenaHub />
  );
}
function LegacyArenaProduct() {
  const path = usePathname();
  const { user, refresh } = useAuth();
  const { data, error, reload } = useData<ArenaData>("/account/arena");
  const section = path.split("/")[2] || "overview";
  const titles: Record<string, [string, string]> = {
    overview: [
      `Good to see you${user ? ", " + user.name.split(" ")[0] : ""}.`,
      "A little practice. A fresh perspective. Make your next call.",
    ],
    games: [
      "Find your next question.",
      "Quick practice is live. Real-world event settlement is still ahead.",
    ],
    history: [
      "Every call tells a story.",
      "Your saved predictions, outcomes, and virtual point history.",
    ],
    leaderboard: [
      "A little friendly perspective.",
      "Ranked by net gameplay points. Starting points and admin grants never count.",
    ],
    profile: [
      "Your own point of view.",
      "Your Google-linked Arena identity and the milestones you’ve earned.",
    ],
  };
  if (section === "games" && path.split("/")[3])
    return (
      <Game
        data={data}
        error={error}
        reload={async () => {
          await reload();
          await refresh();
        }}
      />
    );
  const title = titles[section] || titles.overview;
  return (
    <>
      <PageHeading
        eyebrow="FREE TO PLAY / BUILT FOR CURIOSITY"
        title={title[0]}
        description={title[1]}
        action={
          <span className="tag">
            <Sparkles size={13} /> ZYRO ARENA
          </span>
        }
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          {section === "overview" && (
            <>
              <div className="arena-welcome">
                <div>
                  <span className="overline">YOUR NEXT CALL IS WAITING</span>
                  <h2>
                    Bring your instinct.
                    <br />
                    <em>We’ll bring the challenge.</em>
                  </h2>
                  <Link
                    className="button primary"
                    href="/arena/games/quick-draw"
                  >
                    {data.account.committed
                      ? "Continue your round"
                      : "Play a quick round"}
                    <ArrowUpRight size={18} />
                  </Link>
                </div>
                <div className="arena-emblem" aria-hidden>
                  <Crosshair size={105} strokeWidth={0.7} />
                  <span>YES / NO</span>
                </div>
              </div>
              <Stats a={data.account} />
              <div className="arena-columns">
                <div>
                  <GameCard pending={!!data.account.committed} />
                  <div className="panel">
                    <div className="section-title">
                      <h3>Recent predictions</h3>
                      <Link className="text-link" href="/arena/history">
                        View all <ArrowRight size={15} />
                      </Link>
                    </div>
                    <RoundHistory rounds={data.rounds.slice(0, 4)} />
                  </div>
                </div>
                <aside>
                  <Signal />
                  <div className="panel">
                    <Trophy className="green" />
                    <h3>Make your mark.</h3>
                    <p className="muted">
                      Rankings reflect settled gameplay, never additional admin
                      points.
                    </p>
                    <Link className="text-link" href="/arena/leaderboard">
                      Explore rankings <ArrowUpRight size={15} />
                    </Link>
                  </div>
                </aside>
              </div>
            </>
          )}
          {section === "games" && (
            <>
              <div className="discovery-tabs">
                <span className="tag">Quick practice</span>
                <span className="muted">Real-world events · Planned</span>
              </div>
              <div className="arena-columns">
                <GameCard pending={!!data.account.committed} />
                <div className="panel future-event">
                  <Clock3 className="muted" />
                  <span className="overline">FUTURE EVENT / PREVIEW</span>
                  <h2>Will BTC exceed a predefined price tomorrow?</h2>
                  <p className="muted">
                    A real-world question needs a verified source, an
                    observation time, and an outcome oracle. Live market-data
                    settlement is not available.
                  </p>
                  <span className="tag">
                    <LockKeyhole size={14} /> Participation disabled
                  </span>
                  <div className="state-flow">
                    <span>Open</span>
                    <ArrowRight size={13} />
                    <span>Pending</span>
                    <ArrowRight size={13} />
                    <span>Awaiting outcome</span>
                  </div>
                  <p className="tiny muted">
                    Future lifecycle: Won · Lost · Cancelled · Disputed. No
                    random resolution of real-world events.
                  </p>
                </div>
              </div>
            </>
          )}
          {section === "history" && (
            <>
              <Stats a={data.account} />
              <div className="panel">
                <h2>Prediction history</h2>
                <RoundHistory rounds={data.rounds} />
              </div>
              <Ledger entries={data.ledger} />
            </>
          )}
          {section === "leaderboard" && <Rankings />}
          {section === "profile" && (
            <>
              <div className="profile-hero panel">
                <Avatar user={user} />
                <div>
                  <span className="overline green">GOOGLE-LINKED PLAYER</span>
                  <h2>{user?.name}</h2>
                  <p className="muted">{user?.email}</p>
                  <small className="muted">
                    Joined {user?.createdAt ? date(user.createdAt) : "—"} ·
                    Private profile
                  </small>
                </div>
                <div className="profile-points">
                  <strong className="mono">
                    {points(data.account.available)}
                  </strong>
                  <span>AVAILABLE ZYRO POINTS</span>
                </div>
              </div>
              <Stats a={data.account} />
              <div className="panel">
                <h2>Milestones, earned by playing.</h2>
                <div className="milestones">
                  {[
                    [
                      "First perspective",
                      data.account.played >= 1,
                      "Complete your first round",
                    ],
                    [
                      "Finding your rhythm",
                      data.account.played >= 10,
                      "Complete ten rounds",
                    ],
                    [
                      "A good instinct",
                      data.account.wins >= 1,
                      "Win your first round",
                    ],
                  ].map(([name, earned, description]) => (
                    <div className={earned ? "earned" : ""} key={String(name)}>
                      <Trophy />
                      <h3>{name}</h3>
                      <p>{description}</p>
                      <span className="tag">
                        {earned ? "EARNED" : "NOT YET"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <Ledger entries={data.ledger} />
            </>
          )}
        </>
      )}
      <p className="account-footnote">
        <ShieldCheck size={15} /> ZYRO Points are virtual, nontransferable and
        nonredeemable. No purchases or real-money wagering.
      </p>
    </>
  );
}
export function Stats({ a, pending }: { a: Balance; pending?: number }) {
  return (
    <>
      <div className="stat-grid">
        {[
          ["AVAILABLE POINTS", points(a.available)],
          ["COMMITTED", points(a.committed)],
          ["ROUNDS PLAYED", points(a.played)],
          [
            "WIN RATE",
            a.played ? Math.round((a.wins / a.played) * 100) + "%" : "—",
          ],
        ].map(([l, v]) => (
          <div className="stat-card" key={l}>
            <span>{l}</span>
            <strong className="mono">{v}</strong>
          </div>
        ))}
      </div>
      <div className="player-metrics">
        <span>
          <b className="mono">{a.wins}</b> wins
        </span>
        <span>
          <b className="mono">{a.played - a.wins - (a.ties || 0)}</b> losses
        </span>
        <span>
          <b className="mono">{a.streak}</b> current streak
        </span>
        <span>
          <b className="mono">{points(a.net)}</b> net gameplay points
        </span>
        <span>
          <b className="mono">
            {pending ?? a.pending ?? (a.committed > 0 ? 1 : 0)}
          </b>{" "}
          pending
        </span>
        <span>
          <b className="mono">{points(a.earned || 0)}</b> gameplay points earned
        </span>
        <span>
          <b className="mono">{points(a.lost || 0)}</b> gameplay points lost
        </span>
      </div>
    </>
  );
}
function GameCard({ pending }: { pending: boolean }) {
  return (
    <article className="play-card">
      <div className="section-title">
        <span className="tag">
          <span className="status-dot" />{" "}
          {pending ? "PENDING ROUND" : "QUICK PRACTICE"}
        </span>
        <span className="muted tiny">5s reveal</span>
      </div>
      <div className="game-visual" aria-hidden>
        <span>0</span>
        <Crosshair size={55} strokeWidth={1} />
        <span>99</span>
      </div>
      <span className="overline green">COMMITTED RANDOM DRAW</span>
      <h2>
        Will the next draw land
        <br />
        at 50 or above?
      </h2>
      <p className="muted">
        Your YES or NO versus Signal’s call. A transparent practice exercise
        with an even-stake payout.
      </p>
      <div className="game-card-foot">
        <span>
          <Bot size={16} /> vs Signal · 10–100 pts
        </span>
        <Link className="button primary" href="/arena/games/quick-draw">
          {pending ? "Continue" : "Make your call"}
          <ArrowUpRight size={17} />
        </Link>
      </div>
    </article>
  );
}
function Signal() {
  return (
    <div className="panel signal-panel">
      <div className="signal-icon">
        <Bot size={29} />
        <span className="status-dot" />
      </div>
      <span className="overline">YOUR PRACTICE OPPONENT</span>
      <h3>Meet Signal.</h3>
      <p className="muted">
        A rule-based bot with nothing up its sleeve. It chooses YES when your
        past draws average at least 50; otherwise NO. With no history, it starts
        with YES.
      </p>
      <p className="tiny muted">
        Its call does not change your payout. Past random draws cannot predict
        future results.
      </p>
    </div>
  );
}
export function RoundHistory({ rounds }: { rounds: Round[] }) {
  return rounds.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PREDICTION</th>
            <th>STAKE</th>
            <th>STATUS</th>
            <th>RETURNED</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={roundHref(r)}>
                  <strong>
                    {r.marketId
                      ? r.marketId.split(":")[0]
                      : r.gameKey || "Quick draw"}{" "}
                    · {r.choice || r.side}
                  </strong>
                  <small className="table-sub">
                    {date(r.createdAt)} ·{" "}
                    {r.gameKind === "market"
                      ? "Scheduled market"
                      : "Server-verified practice"}
                  </small>
                </Link>
              </td>
              <td className="mono">{points(r.stake)}</td>
              <td>
                <span
                  className={`tag ${r.status === "PENDING" ? "" : r.payout ? "green" : ""}`}
                >
                  {r.status === "PENDING"
                    ? "Pending"
                    : r.status === "CANCELLED"
                      ? "Cancelled"
                      : r.result?.verdict === "TIE"
                        ? "Tie / Refund"
                        : r.payout
                          ? "Won"
                          : "Lost"}
                </span>
              </td>
              <td className="mono">
                {r.status === "PENDING" ? "—" : points(r.payout)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty premium-empty">
      <Crosshair size={30} />
      <h3>A fresh page for your predictions.</h3>
      <p>Complete your first quick round to start your track record.</p>
      <Link className="text-link" href="/arena/games/quick-draw">
        Make your first call <ArrowRight size={15} />
      </Link>
    </div>
  );
}
export function Ledger({ entries }: { entries: ArenaData["ledger"] }) {
  return (
    <section className="panel">
      <h2>Your points, accounted for.</h2>
      <p className="muted">
        Every grant, committed stake, and settled outcome.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>ENTRY</th>
              <th>CHANGE</th>
              <th>AVAILABLE AFTER</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e._id}>
                <td>{date(e.createdAt)}</td>
                <td>{e.kind.replaceAll("_", " ")}</td>
                <td className="mono">
                  {e.amount > 0 ? "+" : ""}
                  {points(e.amount)}
                </td>
                <td className="mono">{points(e.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Rankings() {
  const { data, error, reload } = useData<
    { name: string; net: number; wins: number; played: number }[]
  >("/account/leaderboard");
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <Trophy className="green" />
          <h2>Practice rankings</h2>
        </div>
        <span className="tag">NET GAMEPLAY POINTS</span>
      </div>
      <p className="muted">
        At least one completed round. Public player aliases protect account
        names and emails.
      </p>
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : !data.length ? (
        <div className="empty premium-empty">
          <Trophy size={32} />
          <h3>The first chapter is still unwritten.</h3>
          <p>Complete a practice round to appear here.</p>
          <Link className="button primary" href="/arena/games/quick-draw">
            Start a round <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>RANK</th>
                <th>PLAYER</th>
                <th>NET POINTS</th>
                <th>WINS / PLAYED</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.name}>
                  <td className="mono">{String(i + 1).padStart(2, "0")}</td>
                  <td>{r.name}</td>
                  <td className="mono green">
                    {r.net > 0 ? "+" : ""}
                    {points(r.net)}
                  </td>
                  <td className="mono">
                    {r.wins} / {r.played}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Game({
  data,
  error,
  reload,
}: {
  data?: ArenaData;
  error: string;
  reload: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [side, setSide] = useState<Side>("YES");
  const [stake, setStake] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const op = useRef("");
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <DataState error={error} retry={reload} />;
  const pending = data.rounds.find((r) => r.status === "PENDING");
  const last = data.rounds.find((r) => r.status === "RESOLVED");
  const amount = Number(stake);
  const valid =
    /^\d+$/.test(stake) &&
    amount >= 10 &&
    amount <= 100 &&
    amount <= data.account.available;
  const remaining = pending
    ? Math.max(0, Math.ceil((Date.parse(pending.resolveAt) - now) / 1000))
    : 0;
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      if (pending) await api(`/account/arena/${pending.id}/resolve`, {});
      else
        await api("/account/arena/predict", {
          side,
          stake: amount,
          operation: op.current,
        });
      dialog.current?.close();
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="text-link muted" href="/arena/games">
        ← Back to games
      </Link>
      <div className="game-detail-heading">
        <span className="tag">
          <Crosshair size={13} /> QUICK PRACTICE / COMMITTED DRAW
        </span>
        <h1>
          Will the next draw land
          <br />
          <em>at 50 or above?</em>
        </h1>
        <p className="muted">
          A five-second random exercise. Clear rules. A verifiable reveal.
        </p>
      </div>
      <div className="arena-columns game-detail">
        <section className="play-card">
          <div className="matchup">
            <div>
              <Avatar user={user} />
              <strong>Your instinct</strong>
              <small>{pending?.side || side}</small>
            </div>
            <span className="mono muted">VS</span>
            <div>
              <span className="avatar bot-avatar">
                <Bot size={22} />
              </span>
              <strong>Signal</strong>
              <small>{pending?.botSide || "Rule-based bot"}</small>
            </div>
          </div>
          {pending ? (
            <div className="pending-reveal">
              <div className="countdown mono">
                {remaining > 0 ? remaining : <CheckCircle2 size={42} />}
              </div>
              <h2>
                {remaining ? "Your call is committed." : "The reveal is ready."}
              </h2>
              <p>
                {pending.stake} points committed on {pending.side}. They have
                already been deducted from your available balance.
              </p>
              <button
                className="button primary"
                disabled={busy || remaining > 0}
                onClick={() => void submit()}
              >
                {busy
                  ? "Revealing…"
                  : remaining
                    ? `Reveal in ${remaining}s`
                    : "Reveal result"}
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                className="button ghost cancel-round"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/account/arena/${pending.id}/cancel`, {});
                    await reload();
                    setMessage(
                      "Round cancelled. Your original stake has been returned.",
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cancel round & return {pending.stake} points
              </button>
              <details>
                <summary>Inspect commitment</summary>
                <p className="hash">{pending.commitment}</p>
              </details>
            </div>
          ) : (
            <>
              <div className="choice-buttons">
                {(["YES", "NO"] as const).map((s) => (
                  <button
                    className={`outcome ${s.toLowerCase()} ${side === s ? "selected" : ""}`}
                    aria-pressed={side === s}
                    key={s}
                    onClick={() => {
                      setSide(s);
                      op.current = "";
                    }}
                  >
                    <span>
                      {s}
                      <small>{s === "YES" ? "Draw 50–99" : "Draw 0–49"}</small>
                    </span>
                    {side === s ? (
                      <CheckCircle2 size={22} />
                    ) : (
                      <ArrowUpRight size={22} />
                    )}
                  </button>
                ))}
              </div>
              <label className="stake-label" htmlFor="point-stake">
                Your stake{" "}
                <span className="mono muted">
                  {points(data.account.available)} available
                </span>
              </label>
              <div className="stake-input">
                <input
                  id="point-stake"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={stake}
                  onChange={(e) => {
                    setStake(e.target.value);
                    op.current = "";
                  }}
                  aria-describedby="stake-help"
                />
                <span>ZYRO Points</span>
              </div>
              <div className="stake-presets">
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    className={amount === n ? "active" : ""}
                    onClick={() => {
                      setStake(String(n));
                      op.current = "";
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p id="stake-help" className="tiny muted">
                Choose 10–100 points. Winning returns twice your stake; losing
                returns zero.
              </p>
              <div className="outcome-summary">
                <span>
                  If you win{" "}
                  <b className="mono green">{points(amount * 2)} returned</b>
                </span>
                <span>
                  Available after commitment{" "}
                  <b className="mono">
                    {valid ? points(data.account.available - amount) : "—"}
                  </b>
                </span>
              </div>
              <button
                className="button primary full-width"
                disabled={busy || !valid}
                onClick={() => {
                  if (!op.current) op.current = crypto.randomUUID();
                  dialog.current?.showModal();
                }}
              >
                Review prediction <ArrowRight size={17} />
              </button>
              {!valid && (
                <p className="tiny" role="status">
                  Enter a whole-number stake within your available balance
                  (10–100).
                </p>
              )}
            </>
          )}
          {message && (
            <p className="notice error" role="alert">
              {message}
            </p>
          )}
          {!pending && last && (
            <div
              className={`result result-reveal ${last.payout ? "win-result" : ""}`}
              role="status"
            >
              <span className="overline">
                LAST ROUND / {last.payout ? "WON" : "LOST"}
              </span>
              <h2>
                {last.payout ? "A good call." : "Another point of perspective."}
              </h2>
              <p>
                Draw <b className="mono">{last.draw}</b> → {last.outcome} · Your
                call {last.side}
              </p>
              <p className="mono">{points(last.payout)} points returned</p>
              <details>
                <summary>Verify the reveal</summary>
                <p className="hash">
                  Secret: {last.secret}
                  <br />
                  SHA-256: {last.commitment}
                </p>
                <p className="tiny muted">
                  Hash the UTF-8 secret. First eight hexadecimal digits modulo
                  100 give the draw. This proves server commitment, not
                  independent randomness.
                </p>
              </details>
            </div>
          )}
        </section>
        <aside>
          <section className="panel">
            <span className="overline green">HOW THIS ROUND WORKS</span>
            <h3>A fair starting point.</h3>
            <ol className="game-rules">
              <li>
                A secret is generated and its SHA-256 commitment is stored
                before reveal.
              </li>
              <li>
                The first eight hash digits modulo 100 determine a draw from
                0–99.
              </li>
              <li>YES wins on 50–99. NO wins on 0–49.</li>
              <li>
                After five seconds, reveal. A win returns 2× your stake. No fee.
              </li>
            </ol>
            <div className="rule-note">
              <ShieldCheck size={18} />
              <p>
                These are random draws, not live events or price predictions.
              </p>
            </div>
          </section>
          <Signal />
          <div className="panel">
            <h3>Balance snapshot</h3>
            <p className="mono">
              {points(data.account.available)} available
              <br />
              {points(data.account.committed)} committed
            </p>
            <p className="tiny muted">
              Saved on the server. Signing out does not reset your balance.
            </p>
          </div>
        </aside>
      </div>
      <dialog ref={dialog} className="zyro-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <span className="overline green">CONFIRM YOUR CALL</span>
          <h2>Ready to commit?</h2>
          <p>
            Choose <strong>{side}</strong> with{" "}
            <strong>{amount} ZYRO Points</strong>. Your available balance will
            be {points(data.account.available - amount)}.
          </p>
          <p className="muted">
            Win: {amount * 2} returned. Loss: zero returned. No real-world
            value.
          </p>
          {message && (
            <p role="alert" className="notice error">
              {message}
            </p>
          )}
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
    </>
  );
}
