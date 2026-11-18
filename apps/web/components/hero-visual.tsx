"use client";
import { useState } from "react";
import { ArrowUpRight, Check, ShieldCheck, Sparkles } from "lucide-react";
export function HeroVisual() {
  const [side, setSide] = useState("YES");
  return (
    <div className="hero-instrument">
      <div className="instrument-orbit" aria-hidden />
      <div className="floating-caption">
        <span className="status-dot" /> YOUR PERSPECTIVE. YOUR CALL.
      </div>
      <div className="instrument-card">
        <div className="instrument-meta">
          <span>
            <Sparkles size={14} /> ARENA / QUICK DRAW
          </span>
          <span className="tag">PREVIEW</span>
        </div>
        <div className="instrument-question">
          <span className="draw-glyph">↗</span>
          <h2>
            One prediction.
            <br />A new perspective.
          </h2>
        </div>
        <p>Will the next draw land at 50 or above?</p>
        <div className="chart-legend">
          <span>Illustrative draw sequence</span>
          <span className="mono">0 — 99</span>
        </div>
        <svg
          className="hero-chart"
          viewBox="0 0 440 145"
          role="img"
          aria-label="Decorative example draw sequence, not live data"
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="currentColor" stopOpacity=".19" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 65, 105].map((y) => (
            <path
              key={y}
              d={`M0 ${y} H440`}
              stroke="currentColor"
              opacity=".12"
            />
          ))}
          <path
            d="M0 110 L25 115 50 78 75 89 100 94 125 70 150 91 175 55 200 61 225 44 250 66 275 53 300 30 325 45 350 26 375 36 400 12 440 20 V145 H0Z"
            fill="url(#chart-fill)"
          />
          <path
            className="chart-stroke"
            d="M0 110 L25 115 50 78 75 89 100 94 125 70 150 91 175 55 200 61 225 44 250 66 275 53 300 30 325 45 350 26 375 36 400 12 440 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
        <div className="preview-choices">
          {["YES", "NO"].map((s) => (
            <button
              key={s}
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={side === s ? "chosen" : ""}
            >
              {s}
              <span>{s === "YES" ? "50–99" : "0–49"}</span>
              {side === s ? <Check size={17} /> : <ArrowUpRight size={17} />}
            </button>
          ))}
        </div>
        <div className="instrument-bottom">
          <ShieldCheck size={15} />
          <span>Committed before reveal.</span>
          <span className="mono">100 starting pts</span>
        </div>
      </div>
      <div className="floating-receipt">
        <span className="receipt-icon">
          <Check size={18} />
        </span>
        <div>
          <strong>Your first call starts here.</strong>
          <small>Free to play. Nothing to lose but a guess.</small>
        </div>
        <ArrowUpRight size={18} />
      </div>
    </div>
  );
}
