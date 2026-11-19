"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  SlidersHorizontal,
  Bot,
  Sparkles,
  Globe2,
  Trophy,
  Clock3,
  ShieldCheck,
  Compass,
} from "lucide-react";
import {
  gameDefinition,
  type gameDefinitions,
} from "../../../packages/shared/src/arena-games";
import type { Round } from "@zyro/shared";
import { useAuth, Avatar, points } from "./auth";
import { useData, DataState } from "./data";
import { Stats, RoundHistory, type ArenaData } from "./arena-product";
import { GameArt } from "./game-art";
import { QuickGame } from "./quick-game";
import {
  CryptoDetail,
  CryptoCard,
  type CryptoMarketUI,
} from "./crypto-experience";
type Definition = (typeof gameDefinitions)[number];
export type Discovery = {
  games: Definition[];
  categories: { name: string; count: number }[];
  markets: CryptoMarketUI[];
};
export function ArenaHub() {
  const path = usePathname();
  const part = path.split("/")[2];
  if (part === "games" && path.split("/")[3])
    return <QuickGame gameKey={path.split("/")[3]} />;
  if (part === "crypto" && path.split("/")[3])
    return <CryptoDetail id={decodeURIComponent(path.split("/")[3])} />;
  return (
    <DiscoveryPage
      initialType={
        part === "bot"
          ? "bot"
          : part === "crypto"
            ? "crypto"
            : part === "games"
              ? "quick"
              : "all"
      }
      home={!part}
    />
  );
}
function DiscoveryPage({
  initialType,
  home,
}: {
  initialType: string;
  home: boolean;
}) {
  const { user } = useAuth();
  const { data, error, reload } = useData<Discovery>("/account/discovery");
  const arena = useData<ArenaData>("/account/arena");
  const [category, setCategory] = useState("All"),
    [type, setType] = useState(initialType),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("available"),
    [sort, setSort] = useState("soon");
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("category");
    if (c) setCategory(c);
  }, []);
  const available = (m: CryptoMarketUI) =>
    m.status === "OPEN" && !m.disabled && m.spec.cutoff > Date.now();
  const games =
    data?.games.filter(
      (g) =>
        (type === "all" || type === g.type) &&
        (category === "All" || category === g.category) &&
        g.name.toLowerCase().includes(search.toLowerCase()) &&
        (status === "available" || status === "all"),
    ) || [];
  const markets = (
    data?.markets.filter(
      (m) =>
        (type === "all" || type === "crypto") &&
        (category === "All" || category === "Crypto") &&
        `${m.spec.pair} ${{ "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana" }[m.spec.pair] || ""} above ${m.spec.threshold}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (status === "all" ||
          (status === "available" && available(m)) ||
          (status === "pending" &&
            (m.status === "PENDING_VERIFICATION" ||
              (m.status === "OPEN" && m.spec.cutoff <= Date.now()))) ||
          (status === "resolved" &&
            (m.status === "RESOLVED" || m.status === "CANCELLED"))),
    ) || []
  ).sort((a, b) =>
    sort === "latest"
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : a.spec.observationTime - b.spec.observationTime,
  );
  const pending =
    arena.data?.rounds.filter((r) => r.status === "PENDING") || [];
  return (
    <div className="arena-v5">
      {(home || initialType === "crypto") && (
        <Link href="/arena/crypto/fast" className="fast-feature">
          <span>
            <small>COINBASE EXCHANGE / VIRTUAL POINTS</small>
            <strong>2-Minute Live Crypto Predictions</strong>
            <small>
              BTC · ETH · SOL — Choose UP or DOWN before the window begins.
            </small>
          </span>
          <span>↗</span>
        </Link>
      )}
      <div className="arena-heading">
        <div>
          <span className="overline green">THE ARENA / FREE TO PLAY</span>
          <h1>
            {home
              ? `Your perspective, ${user?.name.split(" ")[0] || "forecaster"}.`
              : initialType === "bot"
                ? "A worthy opponent awaits."
                : initialType === "crypto"
                  ? "Real questions. Real-world data."
                  : "A little instinct. A quick reveal."}
          </h1>
          <p>
            {home
              ? "A world of questions. Seven ways to play. One independent mind."
              : "Free virtual points. Clear rules. Every result accounted for."}
          </p>
        </div>
        <div className="arena-player">
          <Avatar user={user} />
          <div>
            <strong>{user?.name}</strong>
            <span className="mono">
              {points(arena.data?.account.available)}{" "}
              <small>available points</small>
            </span>
          </div>
        </div>
      </div>
      {home && (
        <section className="arena-feature">
          <div className="feature-editorial">
            <span className="feature-kicker">
              <i /> THE NEXT CALL IS YOURS
            </span>
            <h2>
              Trust your instinct.
              <br />
              <em>Enjoy the reveal.</em>
            </h2>
            <p>
              From a single coin to the crypto markets.
              <br />
              Find a question that feels like yours.
            </p>
            <div>
              <Link className="button primary" href="/arena/games/coin-flip">
                Flip your first coin <ArrowUpRight size={17} />
              </Link>
              <Link className="text-link" href="/arena/crypto">
                Explore Crypto <ArrowRight size={15} />
              </Link>
            </div>
          </div>
          <div className="featured-art">
            <GameArt kind="coin" />
            <span className="feature-caption">
              <span>COIN FLIP</span>
              <small>Two sides. Even odds. Zero fees.</small>
            </span>
          </div>
        </section>
      )}
      {home && arena.data && (
        <Stats a={arena.data.account} pending={pending.length} />
      )}
      {!!pending.length && (
        <section className="continue-strip">
          <Clock3 size={20} />
          <div>
            <strong>
              {pending.length}{" "}
              {pending.length === 1 ? "prediction" : "predictions"} in progress
            </strong>
            <span>
              {points(arena.data?.account.committed)} points committed · Your
              balance is saved.
            </span>
          </div>
          <Link className="text-link" href={roundHref(pending[0])}>
            Continue <ArrowRight size={16} />
          </Link>
        </section>
      )}
      <section className="discovery-section" id="discover">
        <div className="discovery-heading">
          <div>
            <span className="overline green">FOLLOW YOUR CURIOSITY</span>
            <h2>{home ? "What’s your next call?" : "Discover the Arena"}</h2>
          </div>
          <span className="discovery-count mono">
            {games.length + markets.length} shown
          </span>
        </div>
        <nav className="category-rail" aria-label="Prediction categories">
          {data?.categories.map((c) => (
            <button
              key={c.name}
              className={category === c.name ? "active" : ""}
              aria-pressed={category === c.name}
              onClick={() => {
                setCategory(c.name);
                setType("all");
                const u = new URL(window.location.href);
                u.searchParams.set("category", c.name);
                window.history.replaceState(null, "", u);
              }}
            >
              {c.name}
              <small className="mono">{c.count}</small>
            </button>
          ))}
        </nav>
        <div className="discovery-tools">
          <label className="discovery-search">
            <Search size={17} />
            <span className="sr-only">Search Arena</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find your next game or market"
              type="search"
            />
          </label>
          <label className="filter-select">
            <SlidersHorizontal size={15} />
            <span className="sr-only">Game type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All experiences</option>
              <option value="quick">Quick Predictions</option>
              <option value="bot">Challenge the Bot</option>
              <option value="crypto">Real-World Predictions</option>
            </select>
          </label>
          <label className="filter-select">
            <span className="sr-only">Market status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="available">Available now</option>
              <option value="all">All statuses</option>
              <option value="pending">Awaiting outcome</option>
              <option value="resolved">Settled</option>
            </select>
          </label>
          <label className="filter-select">
            <span className="sr-only">Sort markets</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="soon">Closing soon</option>
              <option value="latest">Newest first</option>
            </select>
          </label>
        </div>
        {!data ? (
          <DataState error={error} retry={reload} />
        ) : (
          <>
            {games.some((g) => g.type === "quick") && (
              <>
                <SectionTitle
                  icon="quick"
                  title="Quick Predictions"
                  description="A small stake. A satisfying reveal."
                />
                <div className="quick-game-grid">
                  {games
                    .filter((g) => g.type === "quick")
                    .map((g) => (
                      <GameTile key={g.key} game={g} />
                    ))}
                </div>
              </>
            )}
            {games.some((g) => g.type === "bot") && (
              <>
                <SectionTitle
                  icon="bot"
                  title="Challenge the Bot"
                  description="Meet Signal. Computer opponent, independent choices."
                />
                <div className="bot-game-grid">
                  {games
                    .filter((g) => g.type === "bot")
                    .map((g) => (
                      <GameTile key={g.key} game={g} />
                    ))}
                </div>
              </>
            )}
            {!!markets.length && (
              <>
                <SectionTitle
                  icon="world"
                  title="Real-World Predictions"
                  description="BTC · ETH · SOL / Coinbase Exchange completed candles"
                />
                <div className="crypto-market-grid">
                  {markets.map((m) => (
                    <CryptoCard key={m._id} market={m} />
                  ))}
                </div>
              </>
            )}
            {!games.length && !markets.length && (
              <div className="category-empty">
                <div className="empty-illustration">
                  <Compass size={55} strokeWidth={1} />
                  <span className="empty-orbit" />
                </div>
                <span className="overline">
                  {category.toUpperCase()} / ROOM FOR WHAT’S NEXT
                </span>
                <h2>
                  {category === "All"
                    ? "No matches. A fresh direction?"
                    : `${category} is on the horizon.`}
                </h2>
                <p>
                  {category === "Games"
                    ? "No games-industry prediction markets available yet."
                    : category === "All"
                      ? "Try another search, status or experience filter."
                      : `No active ${category.toLowerCase()} predictions yet. This category is being prepared.`}
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    setCategory("All");
                    setType("all");
                    setSearch("");
                    setStatus("available");
                  }}
                >
                  Explore available games <ArrowRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {home && (
        <div className="arena-bottom-grid">
          <section className="panel">
            <div className="section-title">
              <h2>Your recent calls</h2>
              <Link className="text-link" href="/arena/history">
                View history <ArrowUpRight size={15} />
              </Link>
            </div>
            {arena.data ? (
              <RoundHistory rounds={arena.data.rounds.slice(0, 4)} />
            ) : (
              <DataState error={arena.error} retry={arena.reload} />
            )}
          </section>
          <LeaderPreview />
        </div>
      )}
      <p className="arena-disclaimer">
        <ShieldCheck size={16} /> ZYRO Points have no cash value. No purchases,
        withdrawals or human-funded payouts.
      </p>
    </div>
  );
}
function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="game-section-title">
      <div className="section-icon">
        {icon === "quick" ? (
          <Sparkles size={18} />
        ) : icon === "bot" ? (
          <Bot size={18} />
        ) : (
          <Globe2 size={18} />
        )}
      </div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
export function GameTile({ game: g }: { game: Definition }) {
  return (
    <Link
      href={`/arena/games/${g.key}`}
      className={`game-tile tile-${g.accent} ${g.type === "bot" ? "bot-tile" : ""}`}
    >
      <div className="tile-meta">
        <span>{g.type === "bot" ? "VS SIGNAL / BOT" : "QUICK PREDICTION"}</span>
        <span>
          03s <Clock3 size={10} />
        </span>
      </div>
      <GameArt kind={g.visual} compact />
      <div className="tile-copy">
        <h3>{g.name}</h3>
        <p>{g.tagline}</p>
        <div className="tile-options">
          {g.labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="tile-footer">
          <span className="mono">10–100 PTS</span>
          <span>
            Play now <ArrowUpRight size={15} />
          </span>
        </div>
      </div>
    </Link>
  );
}
function LeaderPreview() {
  const { data, error, reload } = useData<
    { name: string; wins: number; net: number }[]
  >("/account/leaderboard");
  return (
    <section className="panel leader-preview">
      <span className="overline green">
        <Trophy size={14} /> A LITTLE FRIENDLY COMPETITION
      </span>
      <h2>Find your place.</h2>
      <p className="muted">Net gameplay earnings. Admin grants excluded.</p>
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : data.length ? (
        data.slice(0, 4).map((r, i) => (
          <div className="leader-row" key={r.name}>
            <span className="mono">0{i + 1}</span>
            <span>
              {r.name}
              <small>{r.wins} wins</small>
            </span>
            <b className="mono">{points(r.net)}</b>
          </div>
        ))
      ) : (
        <div className="leader-empty">
          <Trophy size={29} />
          <p>
            The first chapter is still unwritten.
            <br />
            Play a round to join the rankings.
          </p>
        </div>
      )}
      <Link className="text-link" href="/arena/leaderboard">
        Explore rankings <ArrowRight size={15} />
      </Link>
    </section>
  );
}
export function roundHref(r: Round) {
  if (r.gameKey === "crypto-fast")
    return `/arena/crypto/fast?round=${encodeURIComponent(r.marketId || "")}`;
  return r.marketId
    ? `/arena/crypto/${encodeURIComponent(r.marketId)}`
    : `/arena/games/${gameDefinition(r.gameKey || "")?.key || "quick-draw"}`;
}
