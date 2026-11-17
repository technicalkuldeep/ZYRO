"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Globe,
  Layers,
  Plus,
  Search,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import type { Market } from "@zyro/shared";
import { Button } from "./ui/button";
import { PageHeading } from "./shell";
import { useData, DataState, zec, date } from "./data";
export function MarketCard({ market: m }: { market: Market }) {
  return (
    <article className="market-card">
      <div className="card-top">
        <span className={"category-icon " + m.category.toLowerCase()}>
          {m.category === "Zcash" ? (
            <Shield />
          ) : m.category === "Technology" ? (
            <Zap />
          ) : (
            <Globe />
          )}
        </span>
        <span className="tag">{m.category}</span>
        <span className="market-status">
          {m.example ? "EXAMPLE" : m.status}
        </span>
      </div>
      <Link href={"/markets/" + m.id} className="market-question">
        {m.question}
        <ArrowUpRight size={17} />
      </Link>
      <p className="muted card-description">
        {m.example
          ? "Explore the format. Create a challenge to make your own prediction."
          : m.description}
      </p>
      <div className="outcome-row">
        <Link className="outcome yes" href={"/markets/" + m.id + "?side=YES"}>
          <span>YES</span>
          <ArrowUpRight size={17} />
        </Link>
        <Link className="outcome no" href={"/markets/" + m.id + "?side=NO"}>
          <span>NO</span>
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="card-foot">
        <span className="mono">
          {zec(m.stake)} <small>/ side</small>
        </span>
        <span>
          <Users size={13} />
          {m.participants.length}/2
        </span>
        <span>
          <Clock size={13} />
          {date(m.fundingDeadline)}
        </span>
      </div>
    </article>
  );
}
export function MarketExplorer() {
  const { data, error, reload } = useData<Market[]>("/markets");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All markets");
  const [status, setStatus] = useState("All states");
  const filtered = data?.filter(
    (m) =>
      (category === "All markets" || m.category === category) &&
      (status === "All states" || m.status === status) &&
      m.question.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="THE WORLD IS FULL OF POSSIBILITIES"
        title="What happens next?"
        description="Find your perspective. Make a prediction. Keep your edge."
        action={
          <Button asChild>
            <Link href="/create">
              <Plus size={17} /> Create challenge
            </Link>
          </Button>
        }
      />
      <section className="feature-banner">
        <div>
          <span className="tag">
            <Zap size={12} /> ZERO CRYPTO REQUIRED
          </span>
          <h2>
            Good instincts?
            <br />
            Put them into practice.
          </h2>
          <p>
            Meet your forecasting bot. Make a call.
            <br />
            Build your track record with free ZYRO Credits.
          </p>
          <Button asChild>
            <Link href="/arena">
              Enter the Arena <ArrowRight size={17} />
            </Link>
          </Button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="floating-chip chip-yes">
            YES <ArrowUpRight />
          </span>
          <span className="arena-emblem">Z</span>
          <span className="floating-chip chip-no">
            NO <ArrowUpRight />
          </span>
          <span className="art-caption">YOUR INTUITION. YOUR NEXT MOVE.</span>
        </div>
        <span className="banner-index">01 / PRACTICE MAKES PERSPECTIVE</span>
      </section>
      <div className="section-heading">
        <h2>
          Explore challenges{" "}
          <span className="count">{data?.length ?? "—"}</span>
        </h2>
        <span className="muted tiny">
          <Shield size={14} /> Fixed stakes. Two perspectives.
        </span>
      </div>
      <div className="filterbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search challenges"
            type="search"
            placeholder="Search a question…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Challenge status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["All states", "OPEN", "MATCHED", "CANCELLED", "RESOLVED"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </div>
      <div className="tabs" aria-label="Market categories">
        {["All markets", "Zcash", "Technology", "Science", "Culture"].map(
          (c) => (
            <button
              key={c}
              className={category === c ? "selected" : ""}
              onClick={() => setCategory(c)}
            >
              {c === "All markets" && <Layers size={14} />} {c}
            </button>
          ),
        )}
      </div>
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : filtered?.length ? (
        <div className="market-grid">
          {filtered.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>No matching challenges</h3>
          <p>Try another search or create the first one.</p>
          <Button asChild>
            <Link href="/create">Create challenge</Link>
          </Button>
        </div>
      )}
      <div className="notice">
        <Shield size={18} />
        <span>
          You're exploring a testnet prototype. Example listings are labeled.
          Challenge matching and live chain observations work. Wallet-recognized
          funding is an opt-in developer demo; threshold escrow is not
          integrated.
        </span>
        <Link href="/about">
          Learn more <ArrowUpRight size={14} />
        </Link>
      </div>
    </>
  );
}
