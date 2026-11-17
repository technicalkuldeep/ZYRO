"use client";
import Link from "next/link";
import { PageHeading } from "../../components/shell";
import { MarketCard } from "../../components/markets";
import { useData, DataState } from "../../components/data";
import { Button } from "../../components/ui/button";
import type { Market } from "@zyro/shared";
export default function Dashboard() {
  const { data, error, reload } = useData("/dashboard");
  return (
    <>
      <PageHeading
        eyebrow="YOUR PERSPECTIVE, OVER TIME"
        title="My predictions."
        description="Your challenges, recorded acceptances and Arena performance in one place."
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span>CREATED OR JOINED</span>
              <strong>{data.markets.length}</strong>
            </div>
            <div className="stat-card">
              <span>ARENA CREDITS</span>
              <strong>{data.arena.session.credits}</strong>
            </div>
            <div className="stat-card">
              <span>PRACTICE WINS</span>
              <strong>{data.arena.stats.wins}</strong>
            </div>
            <div className="stat-card">
              <span>ON-CHAIN BALANCE</span>
              <strong>Unconnected</strong>
            </div>
          </div>
          <div className="section-heading">
            <h2>Your challenges</h2>
            <Button asChild variant="secondary">
              <Link href="/create">Create challenge</Link>
            </Button>
          </div>
          {data.markets.length ? (
            <div className="market-grid">
              {data.markets.map((m: Market) => (
                <MarketCard key={m.id} market={m} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <h3>Your track record starts here.</h3>
              <p>Create a challenge or try a free practice round.</p>
              <Button asChild>
                <Link href="/arena">Enter the Arena</Link>
              </Button>
            </div>
          )}
          <div className="panel" style={{ marginTop: 24 }}>
            <h2>Practice history</h2>
            {data.arena.rounds.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>CALL</th>
                      <th>STATE</th>
                      <th>RETURNED CREDITS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.arena.rounds.map((r: any) => (
                      <tr key={r.id}>
                        <td>{new Date(r.createdAt).toLocaleString()}</td>
                        <td>{r.side}</td>
                        <td>{r.status}</td>
                        <td>{r.payout ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No predictions yet.</p>
            )}
          </div>
          <div className="notice">
            This dashboard uses a persistent guest cookie. It is not a wallet
            account. No wallet balance, funded escrow or confirmed settlement is
            available.
          </div>
        </>
      )}
    </>
  );
}
