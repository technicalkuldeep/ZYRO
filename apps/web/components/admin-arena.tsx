"use client";
import { useState } from "react";
import { ShieldCheck, Clock3, CheckCircle2, Activity } from "lucide-react";
import { useData, DataState, api } from "./data";
import { points } from "./auth";
import { utc, type CryptoMarketUI } from "./crypto-experience";
import { PageHeading } from "./shell";
type Content = {
  definitions: { key: string; name: string; type: string }[];
  totals: { resolved: number; awaiting: number; pending: number };
  games: { _id: string; rounds: number; pending: number; payouts: number }[];
  markets: CryptoMarketUI[];
  attempts: {
    _id: string;
    marketId: string;
    at: string;
    result: string;
    error?: string;
  }[];
  errors: { _id: string; at: string; type: string; message: string }[];
  audit: {
    _id: string;
    action: string;
    actorEmail: string;
    reason: string;
    at: string;
  }[];
};
export function AdminArena() {
  const { data, error, reload } = useData<Content>("/admin/arena");
  return (
    <div className="arena-v5">
      <PageHeading
        eyebrow="PRIVATE / ARENA OPERATIONS"
        title="Every game. Every outcome."
        description="Gameplay, scheduled source checks and auditable participation controls."
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              ["GAME TYPES PLAYED", data.games.length],
              ["AWAITING VERIFICATION", data.totals.awaiting],
              ["RESOLVED MARKETS", data.totals.resolved],
              [
                "RECENT SOURCE RETRIES",
                data.attempts.filter((a) => a.result === "RETRY").length,
              ],
            ].map(([l, n]) => (
              <div className="stat-card" key={l}>
                <span>{l}</span>
                <strong className="mono">{points(Number(n))}</strong>
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="tile-options" style={{ marginBottom: 24 }}>
              {data.definitions.map((g) => (
                <span key={g.key}>
                  {g.name} · {g.type === "bot" ? "Bot" : "Quick"}
                </span>
              ))}
            </div>
            <h2>
              <Activity size={20} /> Actual gameplay by type
            </h2>
            {data.games.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>GAME</th>
                      <th>ROUNDS</th>
                      <th>PENDING</th>
                      <th>POINTS RETURNED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map((g) => (
                      <tr key={g._id}>
                        <td>{g._id}</td>
                        <td className="mono">{g.rounds}</td>
                        <td className="mono">{g.pending}</td>
                        <td className="mono">{points(g.payouts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                No played rounds yet. All seven engines are available through
                discovery.
              </div>
            )}
          </section>
          <div className="section-title">
            <h2>Scheduled crypto markets</h2>
            <span className="tag">
              <ShieldCheck size={13} /> TERMS ARE IMMUTABLE
            </span>
          </div>
          <p className="muted">
            Disable new entries for operational issues. Existing predictions
            retain their agreed terms and published resolution policy.
          </p>
          <div className="content-market-list">
            {data.markets.map((m) => (
              <MarketControl key={m._id} market={m} reload={reload} />
            ))}
          </div>
          <section className="panel" style={{ marginTop: 24 }}>
            <h2>
              <Clock3 size={20} /> Source verification attempts
            </h2>
            {data.attempts.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>TIME / MARKET</th>
                      <th>RESULT</th>
                      <th>DETAILS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attempts.map((a) => (
                      <tr key={a._id}>
                        <td>
                          {utc(a.at)}
                          <small className="table-sub">{a.marketId}</small>
                        </td>
                        <td>{a.result}</td>
                        <td>{a.error || "Exact completed candle verified"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No resolution attempts yet. The worker waits until after each
                published candle close.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Recent game errors</h2>
            {data.errors?.length ? (
              data.errors.map((e) => (
                <p key={e._id}>
                  {utc(e.at)} · {e.type} · {e.message}
                </p>
              ))
            ) : (
              <p className="muted">No recorded game errors.</p>
            )}
          </section>
          <section className="panel">
            <h2>
              <CheckCircle2 size={20} /> Content audit trail
            </h2>
            {data.audit.length ? (
              data.audit.map((a) => (
                <p key={a._id}>
                  {utc(a.at)} · {a.actorEmail} · {a.action}
                  <br />
                  {a.reason}
                </p>
              ))
            ) : (
              <p className="muted">
                No participation controls have been changed.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function MarketControl({
  market: m,
  reload,
}: {
  market: CryptoMarketUI;
  reload: () => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <details className="content-spec">
      <summary>
        <strong>
          {m.spec.pair} · {utc(m.spec.observationTime)}
        </strong>
        <span className="tag">{m.disabled ? "ENTRY PAUSED" : m.status}</span>
      </summary>
      <p>
        Threshold {m.spec.threshold} · Attempts {m.attempts} ·{" "}
        {m.lastError || "No source error recorded"}
      </p>
      <p className="hash">Specification SHA-256: {m.specHash}</p>
      <pre>{JSON.stringify(m.spec, null, 2)}</pre>
      {m.evidence && <pre>{JSON.stringify(m.evidence, null, 2)}</pre>}
      {!m.disabled && m.status === "OPEN" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!confirm) {
              setConfirm(true);
              return;
            }
            setBusy(true);
            try {
              await api(`/admin/arena/${encodeURIComponent(m._id)}/disable`, {
                reason,
                operation: crypto.randomUUID(),
              });
              setMessage(
                "New participation disabled. Existing terms unchanged.",
              );
              await reload();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Required operational reason
            <input
              minLength={5}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirm(false);
              }}
            />
          </label>
          {confirm && (
            <p>
              Confirm disabling future entry for this market? Existing
              predictions will still resolve using the original specification.
            </p>
          )}
          <button className="button secondary" disabled={busy}>
            {busy
              ? "Recording…"
              : confirm
                ? "Confirm disable entries"
                : "Review participation pause"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
