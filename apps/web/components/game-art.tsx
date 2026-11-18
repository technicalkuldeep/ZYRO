"use client";
import { Bot, Hand, Scissors, File, Crosshair } from "lucide-react";
import type { GameResult } from "../../../packages/shared/src/arena-games";
export function Dice({ value = 5 }: { value?: number }) {
  return (
    <span className="die" aria-label={`Die ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          className={
            (
              {
                1: [4],
                2: [0, 8],
                3: [0, 4, 8],
                4: [0, 2, 6, 8],
                5: [0, 2, 4, 6, 8],
                6: [0, 2, 3, 5, 6, 8],
              } as Record<number, number[]>
            )[value]?.includes(i)
              ? "pip"
              : ""
          }
        />
      ))}
    </span>
  );
}
export function Coin({
  value = "H",
  index = 0,
}: {
  value?: string;
  index?: number;
}) {
  return (
    <span className={`coin coin-${index}`}>
      <span>{value}</span>
      <small>ZYRO / ARENA</small>
    </span>
  );
}
export function GameArt({
  kind,
  result,
  revealing = false,
  compact = false,
}: {
  kind: string;
  result?: GameResult;
  revealing?: boolean;
  compact?: boolean;
}) {
  const values = result?.values;
  return (
    <div
      className={`game-art art-${kind} ${revealing ? "revealing" : ""} ${result ? "revealed" : ""} ${compact ? "art-compact" : ""}`}
      aria-label={result ? `Outcome: ${result.label}` : `${kind} illustration`}
    >
      <div className="art-grid" aria-hidden />
      {kind === "number" && (
        <div className="number-dial">
          <span className="dial-label">ABOVE / BELOW</span>
          <strong className="mono">
            {values ? String(values[0]).padStart(2, "0") : "50"}
          </strong>
          <svg viewBox="0 0 200 140" aria-hidden>
            <path
              d="M20 120 A85 85 0 1 1 180 120"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path d="M100 100 L150 50" stroke="currentColor" strokeWidth="2" />
            <circle cx="100" cy="100" r="4" fill="currentColor" />
          </svg>
          <span className="dial-range mono">
            00 <span /> 99
          </span>
        </div>
      )}
      {kind === "coin" && (
        <Coin value={values ? (values[0] ? "T" : "H") : "Z"} />
      )}
      {kind === "dice" && (
        <div className="dice-pair">
          <Dice value={values?.[0] || 5} />
          <Dice value={values?.[1] || 3} />
          {values && (
            <b className="dice-total mono">TOTAL {values[0] + values[1]}</b>
          )}
        </div>
      )}
      {kind === "card" && (
        <div
          className={`playing-card ${values && Math.floor(values[0] / 13) < 2 ? "red-card" : ""}`}
        >
          <span>
            {values
              ? [
                  "A",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  "10",
                  "J",
                  "Q",
                  "K",
                ][values[0] % 13]
              : "Z"}
          </span>
          <strong>
            {values ? ["♥", "♦", "♣", "♠"][Math.floor(values[0] / 13)] : "♠"}
          </strong>
          <small>{values ? result?.label : "ZYRO"}</small>
          <i />
        </div>
      )}
      {kind === "triple" && (
        <div className="triple-coins">
          {[0, 1, 2].map((i) => (
            <Coin
              key={i}
              index={i}
              value={values ? (values[i] ? "T" : "H") : "?"}
            />
          ))}
        </div>
      )}
      {kind === "rps" && (
        <div className="rps-art">
          <span className="hand-orbit">
            <Hand size={40} strokeWidth={1.1} />
          </span>
          <span className="versus">VS</span>
          <span className="bot-orbit">
            {result?.bot === "SCISSORS" ? (
              <Scissors size={40} />
            ) : result?.bot === "PAPER" ? (
              <File size={40} />
            ) : (
              <Bot size={40} strokeWidth={1.1} />
            )}
            <i />
          </span>
        </div>
      )}
      {kind === "duel" && (
        <div className="duel-art">
          <div>
            <small>YOU</small>
            <strong className="mono">
              {values ? String(values[0]).padStart(2, "0") : "??"}
            </strong>
          </div>
          <Crosshair size={22} />
          <div>
            <small>SIGNAL / BOT</small>
            <strong className="mono">
              {values ? String(values[1]).padStart(2, "0") : "??"}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
