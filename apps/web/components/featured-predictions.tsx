"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Market } from "@zyro/shared";
import { useData, date, DataState } from "./data";
export function FeaturedPredictions() {
  const { data, error, reload } = useData<Market[]>("/markets");
  if (!data) return <DataState error={error} retry={reload} />;
  if (!data.length)
    return (
      <div className="empty premium-empty">
        <h3>The next question could be yours.</h3>
        <p>No public challenges yet. Try the live quick-draw practice game.</p>
        <Link className="text-link" href="/arena/games/quick-draw">
          Explore Arena <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  const visuals = [
    { glyph: "◔", tone: "moon" },
    { glyph: "✳", tone: "tech" },
    { glyph: "Z", tone: "zcash" },
  ];
  return (
    <div className="editorial-markets">
      {data.slice(0, 3).map((m, i) => (
        <Link href={`/markets/${m.id}`} key={m.id} className="editorial-market">
          <div className={`market-illustration ${visuals[i].tone}`} aria-hidden>
            <span>{visuals[i].glyph}</span>
            <small>
              0{i + 1} / {m.example ? "EDITORIAL EXAMPLE" : "TESTNET CHALLENGE"}
            </small>
          </div>
          <div className="editorial-market-body">
            <span className="overline">
              {m.category.toUpperCase()}{" "}
              <span className="muted">
                / {m.example ? "EXAMPLE" : m.status}
              </span>
            </span>
            <h3>{m.question}</h3>
            <div className="preview-pills">
              <span>
                YES <ArrowUpRight size={14} />
              </span>
              <span>
                NO <ArrowUpRight size={14} />
              </span>
            </div>
            <div className="market-caption">
              <span>
                {m.example
                  ? "Illustrative · No participation"
                  : `Testnet · ${m.status}`}
                <br />
                Resolution deadline: {date(m.resolutionDeadline)}
              </span>
              <ArrowUpRight size={16} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
