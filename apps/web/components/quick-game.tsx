"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  Bot,
  CheckCircle2,
  RotateCcw,
  LockKeyhole,
} from "lucide-react";
import {
  gameDefinition,
  type GameResult,
} from "../../../packages/shared/src/arena-games";
import { api, useData, DataState } from "./data";
import { useAuth, Avatar, points } from "./auth";
import type { ArenaData } from "./arena-product";
import { GameArt } from "./game-art";
type Preparation = {
  id: string;
  gameKey: string;
  commitment: string;
  rulesHash: string;
  preparedAt: string;
  expiresAt: string;
};
export function QuickGame({ gameKey }: { gameKey: string }) {
  const g = gameDefinition(gameKey);
  const { user, refresh } = useAuth();
  const { data, error, reload } = useData<ArenaData>("/account/arena");
  const [preparation, setPreparation] = useState<Preparation>(),
    [choice, setChoice] = useState(""),
    [stake, setStake] = useState("10"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [now, setNow] = useState(0),
    [revealing, setRevealing] = useState(false),
    [fresh, setFresh] = useState(false),
    [verified, setVerified] = useState("");
  const preparationOperation = useRef(""),
    entryOperation = useRef(""),
    dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLElement>(null);
  const pending = data?.rounds.find(
    (r) => r.status === "PENDING" && r.gameKind !== "market",
  );
  const last = data?.rounds.find(
    (r) =>
      (r.gameKey === gameKey || (gameKey === "quick-draw" && !r.gameKey)) &&
      r.status !== "PENDING",
  );
  // Entrance: choices 0ms; commitment preparation runs independently; result animates only after server confirmation.
  useEffect(() => {
    setChoice(g?.choices[0] || "");
    setPreparation(undefined);
    preparationOperation.current = crypto.randomUUID();
    entryOperation.current = "";
    setFresh(false);
    setVerified("");
    if (g)
      api<Preparation>(`/account/games/${g.key}/prepare`, {
        operation: preparationOperation.current,
      })
        .then(setPreparation)
        .catch((e) => setMessage(e.message));
  }, [gameKey]);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!g)
    return (
      <section className="panel">
        <h1>That game isn’t here.</h1>
        <Link href="/arena/games">Discover games</Link>
      </section>
    );
  if (!data) return <DataState error={error} retry={reload} />;
  const amount = Number(stake),
    valid =
      /^\d+$/.test(stake) &&
      amount >= 10 &&
      amount <= 100 &&
      amount <= data.account.available;
  const remaining = pending
    ? Math.max(0, Math.ceil((Date.parse(pending.resolveAt) - now) / 1000))
    : 0;
  const result = (last?.result ||
    (last?.status === "RESOLVED" && {
      values: [last.draw],
      label: last.outcome || "",
      verdict: last.payout ? "WIN" : "LOSS",
    })) as GameResult | undefined;
  async function commit() {
    setBusy(true);
    setMessage("");
    try {
      await api("/account/games/enter", {
        preparationId: preparation?.id,
        choice,
        stake: amount,
        operation: entryOperation.current,
      });
      dialog.current?.close();
      stage.current?.focus({ preventScroll: true });
      setFresh(false);
      await reload();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reveal() {
    if (!pending) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/account/arena/${pending.id}/resolve`, {});
      setFresh(false);
      await reload();
      setRevealing(true);
      await refresh();
      setPreparation(undefined);
      preparationOperation.current = "";
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function again() {
    setBusy(true);
    setMessage("");
    try {
      preparationOperation.current = crypto.randomUUID();
      entryOperation.current = "";
      setPreparation(
        await api<Preparation>(`/account/games/${g!.key}/prepare`, {
          operation: preparationOperation.current,
        }),
      );
      setFresh(true);
      setRevealing(false);
      setVerified("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!last?.secret) return;
    const payload = last.gameKey
      ? JSON.stringify({
          version: 2,
          id: last.id,
          key: last.gameKey,
          rulesHash: last.rulesHash,
          secret: last.secret,
        })
      : last.secret;
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload),
    );
    const hash = Array.from(new Uint8Array(bytes), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    setVerified(
      hash === last.commitment
        ? "Commitment matches. The revealed secret has not changed."
        : "Verification failed. Do not rely on this outcome.",
    );
  }
  const showResult = !pending && last && !fresh;
  return (
    <div className={`arena-v5 game-experience game-theme-${g.visual}`}>
      <div className="game-breadcrumb">
        <Link href={g.type === "bot" ? "/arena/bot" : "/arena/games"}>
          ← {g.category}
        </Link>
        <span className="mono">
          {points(data.account.available)} PTS AVAILABLE
        </span>
      </div>
      <div className="game-detail-title">
        <span className="overline green">
          {g.type === "bot"
            ? "CHALLENGE THE BOT / SIGNAL"
            : "QUICK PREDICTIONS / EVEN ODDS"}
        </span>
        <h1>
          {g.name}
          <span>.</span>
        </h1>
        <p>{g.tagline}</p>
      </div>
      <div className="game-play-layout">
        <section
          ref={stage}
          tabIndex={-1}
          aria-label="Game stage"
          className={`game-stage stage-${g.accent}`}
        >
          <div className="stage-topline">
            <span className="tag">
              <span className="status-dot" />
              {pending
                ? "POINTS COMMITTED"
                : showResult
                  ? "ROUND COMPLETE"
                  : "READY WHEN YOU ARE"}
            </span>
            <span className="stage-id">
              {pending ? pending.id.slice(0, 8) : "FREE TO PLAY"}
            </span>
          </div>
          {g.type === "bot" && (
            <div className="vs-players">
              <span>
                <Avatar user={user} /> {user?.name.split(" ")[0] || "You"}
              </span>
              <b>VS</b>
              <span>
                <Bot size={20} /> Signal <small>COMPUTER</small>
              </span>
            </div>
          )}
          <GameArt
            kind={g.visual}
            result={showResult ? result : undefined}
            revealing={revealing}
          />
          {pending ? (
            <div className="stage-pending">
              <h2>
                {remaining ? "Your call is locked." : "Ready for the reveal?"}
              </h2>
              <p>
                {pending.choice || pending.side} ·{" "}
                <b className="mono">{pending.stake}</b> points committed. Your
                stake has already been deducted.
              </p>
              <button
                className="button primary"
                disabled={busy || remaining > 0}
                onClick={() => void reveal()}
              >
                {busy
                  ? "Confirming result…"
                  : remaining
                    ? `Reveal in ${remaining}s`
                    : "Reveal result"}
                <ArrowRight size={17} />
              </button>
              {pending.gameKey !== g.key && (
                <Link
                  className="text-link"
                  href={`/arena/games/${pending.gameKey || "quick-draw"}`}
                >
                  Open your pending game
                </Link>
              )}
            </div>
          ) : showResult ? (
            <div
              className={`game-result-banner verdict-${result?.verdict || "REFUND"}`}
              role="status"
            >
              <span className="overline">
                {last.status === "CANCELLED"
                  ? "REFUNDED"
                  : result?.verdict === "WIN"
                    ? "WELL PLAYED"
                    : result?.verdict === "TIE"
                      ? "EVENLY MATCHED"
                      : "ANOTHER PERSPECTIVE"}
              </span>
              <h2>
                {last.status === "CANCELLED"
                  ? "Your stake is back."
                  : result?.verdict === "WIN"
                    ? "That’s a good call."
                    : result?.verdict === "TIE"
                      ? "A tie. Nothing lost."
                      : "A fresh round awaits."}
              </h2>
              <p>
                Your call: {last.choice || last.side} · Result:{" "}
                {result?.label || "Cancelled"}
                {result?.bot ? ` · Signal chose ${result.bot}` : ""}
              </p>
              <div className="result-points">
                <b className="mono">{points(last.payout)}</b>
                <span>
                  points returned
                  <br />
                  <strong>
                    {points(data.account.available)} available now
                  </strong>
                </span>
              </div>
              <button
                className="button secondary"
                onClick={() => void again()}
                disabled={busy || data.account.available < 10}
              >
                <RotateCcw size={16} /> Play another round
              </button>
              {data.account.available < 10 && (
                <p className="muted">
                  Not enough points for another stake. No automatic top-up is
                  applied.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className={`game-choice-grid choices-${g.choices.length}`}>
                {g.choices.map((c, i) => (
                  <button
                    key={c}
                    className={choice === c ? "chosen" : ""}
                    aria-pressed={choice === c}
                    onClick={() => {
                      setChoice(c);
                      entryOperation.current = "";
                    }}
                  >
                    <span>{g.labels[i]}</span>
                    {choice === c ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                  </button>
                ))}
              </div>
              <div className="precommit-status">
                <ShieldCheck size={14} />
                {preparation
                  ? "Server secret committed. Your choice is still yours."
                  : "Preparing your secret commitment…"}
              </div>
            </>
          )}
        </section>
        <aside className="stake-sidebar">
          <div className="stake-ticket">
            <span className="overline green">YOUR ROUND / VIRTUAL POINTS</span>
            <h2>
              {pending
                ? "A little anticipation."
                : showResult
                  ? "A clear outcome."
                  : "Make your call."}
            </h2>
            <div className="ticket-balance">
              <span>Available</span>
              <b className="mono">{points(data.account.available)} PTS</b>
            </div>
            <label htmlFor="game-stake">Point stake</label>
            <div className="v5-stake-input">
              <input
                id="game-stake"
                inputMode="numeric"
                pattern="[0-9]*"
                value={stake}
                disabled={!!pending || !!showResult}
                onChange={(e) => {
                  setStake(e.target.value);
                  entryOperation.current = "";
                }}
              />
              <span>PTS</span>
            </div>
            <div className="stake-presets">
              {[10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  disabled={!!pending || !!showResult}
                  className={amount === n ? "active" : ""}
                  onClick={() => {
                    setStake(String(n));
                    entryOperation.current = "";
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="ticket-outcomes">
              <span>
                Win returns{" "}
                <b className="mono green">{points(amount * 2)} PTS</b>
              </span>
              <span>
                Loss returns <b className="mono">0 PTS</b>
              </span>
              {["dice-duel", "rock-paper-scissors", "lucky-number"].includes(
                g.key,
              ) && (
                <span>
                  Tie returns <b className="mono">{points(amount)} PTS</b>
                </span>
              )}
              <span>
                Fee <b className="mono">0</b>
              </span>
            </div>
            {!pending && !showResult && (
              <button
                className="button primary full-width"
                disabled={!valid || busy || !preparation}
                onClick={() => {
                  if (!entryOperation.current)
                    entryOperation.current = crypto.randomUUID();
                  dialog.current?.showModal();
                }}
              >
                Review prediction <ArrowRight size={16} />
              </button>
            )}
            {!valid && !pending && !showResult && (
              <p className="stake-error">
                Choose a whole-number stake from 10–100 within your available
                points.
              </p>
            )}
            <small className="muted">
              Free, nonredeemable points. No cash value.
            </small>
          </div>
          <section className="game-rule-panel">
            <h3>
              <LockKeyhole size={15} /> Clear rules
            </h3>
            <p>{g.rules}</p>
            <p>
              Win: 2× stake returned. Loss: zero. Ties refund the stake. Signal
              is a computer, not a human counterparty.
            </p>
          </section>
        </aside>
      </div>
      {message && (
        <div className="notice error" role="alert">
          {message}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void again()}
          >
            Prepare again
          </button>
        </div>
      )}
      {error && <DataState error={error} retry={reload} />}
      <details className="fairness-panel">
        <summary>
          <ShieldCheck size={18} /> Verify fairness{" "}
          <span>COMMITMENT / REVEAL</span>
        </summary>
        <p>
          The server committed before your final choice. This proves
          non-alteration after commitment, not independently fair secret
          generation. Outcomes use HMAC-SHA256 labelled streams and rejection
          sampling; choices do not influence the random stream.
        </p>
        <p className="hash">
          Commitment:{" "}
          {pending?.commitment || last?.commitment || preparation?.commitment}
          <br />
          Rules hash:{" "}
          {pending?.rulesHash || last?.rulesHash || preparation?.rulesHash}
          <br />
          Prepared:{" "}
          {pending?.preparedAt || last?.preparedAt || preparation?.preparedAt}
        </p>
        {last?.secret && (
          <>
            <p className="hash">Revealed secret: {last.secret}</p>
            <button className="button secondary" onClick={() => void verify()}>
              Verify commitment in this browser
            </button>
            <p role="status">{verified}</p>
          </>
        )}
        <a
          className="text-link"
          href="https://github.com/technicalkuldeep/ZYRO"
        >
          Open-source verification algorithm <ArrowRight size={14} />
        </a>
      </details>
      <dialog
        className="zyro-dialog"
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <span className="overline green">CONFIRM YOUR PREDICTION</span>
          <h2>{g.name}</h2>
          <p>
            Your choice: <strong>{choice}</strong>
            <br />
            Stake: <strong>{amount} ZYRO Points</strong>
            <br />
            Available after:{" "}
            <strong>{points(data.account.available - amount)}</strong>
          </p>
          <p className="muted">
            {g.rules} Your points are deducted once when the server accepts this
            prediction.
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
