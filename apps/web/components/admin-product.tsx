"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  ShieldCheck,
  UsersRound,
  Plus,
  History,
  CheckCircle2,
} from "lucide-react";
import { points, Avatar, type Balance } from "./auth";
import { api, useData, DataState, date } from "./data";
import { PageHeading } from "./shell";
import { Ledger, RoundHistory, type ArenaData, Stats } from "./arena-product";
type AdminUser = {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
  sub: string;
  emailVerified: boolean;
  createdAt: string;
  lastLogin: string;
  lastActivity: string;
  account: Balance;
};
type Audit = {
  _id: string;
  actorEmail: string;
  userId: string;
  amount: number;
  reason: string;
  before: number;
  after: number;
  createdAt: string;
  result: string;
};
type Overview = {
  users: number;
  registrations: number;
  active: number;
  pending: number;
  totals: { available: number; committed: number; played: number };
  recent: Audit[];
};
export function AdminProduct() {
  const path = usePathname();
  return path.startsWith("/admin/users/") ? (
    <UserDetail id={path.split("/")[3]} />
  ) : path === "/admin/users" ? (
    <Directory />
  ) : path === "/admin/audit" ? (
    <AuditPage />
  ) : (
    <Overview />
  );
}
function Overview() {
  const { data, error, reload } = useData<Overview>("/admin");
  return (
    <>
      <PageHeading
        eyebrow="PRIVATE / OPERATOR CONSOLE"
        title="A clear view of the Arena."
        description="Real accounts, transparent accounting, and deliberate control."
        action={
          <span className="tag">
            <ShieldCheck size={14} /> AUTHORIZED ADMIN
          </span>
        }
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <div className="stat-grid admin-stats">
            {[
              ["REGISTERED PLAYERS", data.users],
              ["NEW / LAST 7 DAYS", data.registrations],
              ["ACTIVE / LAST 7 DAYS", data.active],
              ["COMPLETED ROUNDS", data.totals.played],
              [
                "OUTSTANDING POINTS",
                data.totals.available + data.totals.committed,
              ],
              ["PENDING ROUNDS", data.pending],
            ].map(([label, n]) => (
              <div className="stat-card" key={label}>
                <span>{label}</span>
                <strong className="mono">{points(Number(n))}</strong>
              </div>
            ))}
          </div>
          <div className="admin-banner">
            <div>
              <UsersRound size={26} />
              <h2>Look after your players.</h2>
              <p>
                Search accounts, review gameplay, and grant virtual points with
                a recorded reason.
              </p>
            </div>
            <Link className="button primary" href="/admin/users">
              Manage players <ArrowUpRight size={17} />
            </Link>
          </div>
          <p className="tiny muted">
            Active means a login or gameplay mutation within seven days.
            Outstanding points include available and committed balances. All
            figures come from MongoDB.
          </p>
          <section className="panel">
            <div className="section-title">
              <h2>Recent administrative adjustments</h2>
              <Link className="text-link" href="/admin/audit">
                Full audit trail <ArrowRight size={15} />
              </Link>
            </div>
            <AuditTable rows={data.recent} />
          </section>
        </>
      )}
    </>
  );
}
function Directory() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("recent");
  const { data, error, reload } = useData<{
    users: AdminUser[];
    total: number;
    page: number;
  }>(
    `/admin/users?search=${encodeURIComponent(query)}&page=${page}&sort=${sort}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION / PLAYERS"
        title="The people behind the predictions."
        description="Private account directory. Search by verified email or display name."
      />
      <section className="panel">
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search);
          }}
        >
          <label className="search-input">
            <Search size={18} />
            <span className="sr-only">Search users by email or name</span>
            <input
              type="search"
              placeholder="Search email or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
            />
          </label>
          <button className="button primary">Search</button>
          <label className="sort-label">
            Sort
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="recent">Newest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </form>
        {!data ? (
          <DataState error={error} retry={reload} />
        ) : (
          <>
            <div className="directory-count mono">
              {points(data.total)} players · Page {page}
            </div>
            {data.users.length ? (
              <div className="table-wrap">
                <table className="admin-user-table">
                  <thead>
                    <tr>
                      <th>PLAYER / ID</th>
                      <th>AVAILABLE / COMMITTED</th>
                      <th>PLAYED / W / L</th>
                      <th>JOINED / LAST LOGIN</th>
                      <th>LAST ACTIVITY</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u._id}>
                        <td>
                          <div className="table-user">
                            <Avatar user={u} />
                            <div>
                              <Link href={`/admin/users/${u._id}`}>
                                <strong>{u.name}</strong>
                              </Link>
                              <small>{u.email}</small>
                              <code>{u._id}</code>
                            </div>
                          </div>
                        </td>
                        <td className="mono">
                          {points(u.account?.available)}
                          <small className="table-sub">
                            {points(u.account?.committed)} committed
                          </small>
                        </td>
                        <td className="mono">
                          {points(u.account?.played)} /{" "}
                          {points(u.account?.wins)} /{" "}
                          {points(
                            (u.account?.played || 0) - (u.account?.wins || 0),
                          )}
                        </td>
                        <td>
                          {date(u.createdAt)}
                          <small className="table-sub">
                            {date(u.lastLogin)}
                          </small>
                        </td>
                        <td>{date(u.lastActivity)}</td>
                        <td>
                          <Link
                            className="table-open"
                            href={`/admin/users/${u._id}`}
                            aria-label={`Open ${u.name}`}
                          >
                            <ArrowUpRight size={19} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty premium-empty">
                <UsersRound size={30} />
                <h3>
                  {query
                    ? "No matching players."
                    : "The Arena is ready for its first players."}
                </h3>
                <p>
                  {query
                    ? "Try another name or email."
                    : "Google-authenticated accounts will appear here."}
                </p>
              </div>
            )}
            <div className="pagination">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span className="mono">
                {page} / {Math.max(1, Math.ceil(data.total / 20))}
              </span>
              <button
                className="button secondary"
                disabled={page * 20 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
function UserDetail({ id }: { id: string }) {
  const { data, error, reload } = useData<
    ArenaData & { user: AdminUser; adjustments: Audit[] }
  >(`/admin/users/${id}`);
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState(false);
  const op = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  async function grant() {
    setBusy(true);
    setMessage("");
    try {
      const r = await api<Audit>(`/admin/users/${id}/grants`, {
        amount: Number(amount),
        reason: reason.trim(),
        operation: op.current,
      });
      await reload();
      dialog.current?.close();
      setSuccess(
        `Grant recorded. ${points(r.amount)} points added. Balance: ${points(r.after)}.`,
      );
      op.current = "";
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="text-link muted" href="/admin/users">
        ← All players
      </Link>
      <PageHeading
        eyebrow="PRIVATE / PLAYER DETAILS"
        title={data?.user.name || "Player account"}
        description="Identity, gameplay, and a complete accounting trail."
        action={
          data && (
            <button
              className="button primary"
              onClick={() => {
                setConfirm(false);
                setMessage("");
                setReason("");
                setAmount("100");
                op.current = crypto.randomUUID();
                dialog.current?.showModal();
              }}
            >
              <Plus size={17} /> Add credits
            </button>
          )
        }
      />
      {success && (
        <div className="notice" role="status">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <div className="panel profile-hero">
            <Avatar user={data.user} />
            <div>
              <h2>{data.user.name}</h2>
              <p>
                {data.user.email} ·{" "}
                {data.user.emailVerified
                  ? "Google verified"
                  : "Unverified email"}
              </p>
              <code className="hash">
                User ID: {data.user._id}
                <br />
                Google sub: {data.user.sub}
              </code>
              <p className="tiny muted">
                Registered {date(data.user.createdAt)} · Last login{" "}
                {date(data.user.lastLogin)}
              </p>
            </div>
          </div>
          <Stats a={data.account} />
          <div className="panel">
            <h2>Gameplay statistics</h2>
            <p className="mono">
              Wins {data.account.wins} · Losses{" "}
              {data.account.played -
                data.account.wins -
                (data.account.ties || 0)}{" "}
              · Current streak {data.account.streak} · Net gameplay points{" "}
              {data.account.net}
            </p>
            <p className="muted">
              Additional admin grants: {points(data.account.grants)}. Excluded
              from competitive rankings.
            </p>
            <RoundHistory rounds={data.rounds} />
          </div>
          <Ledger entries={data.ledger} />
          <section className="panel">
            <h2>Administrative adjustments</h2>
            <AuditTable rows={data.adjustments} />
          </section>
        </>
      )}
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
            if (!confirm) setConfirm(true);
            else void grant();
          }}
        >
          <span className="overline green">ADMINISTRATIVE POINT GRANT</span>
          <h2>
            {confirm
              ? "Confirm this adjustment."
              : "A little more room to play."}
          </h2>
          <p className="muted">
            {data?.user.name} · {data?.user.email}
          </p>
          {!confirm ? (
            <>
              <label className="field" htmlFor="grant-amount">
                Points to add (required)
                <input
                  id="grant-amount"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    op.current = crypto.randomUUID();
                  }}
                />
              </label>
              <label className="field" htmlFor="grant-reason">
                Reason (required, 5–500 characters)
                <textarea
                  id="grant-reason"
                  minLength={5}
                  maxLength={500}
                  required
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    op.current = crypto.randomUUID();
                  }}
                />
              </label>
              <p className="tiny muted">
                Positive whole points only. Default server limit: 10,000 per
                grant; deployment configuration may differ.
              </p>
            </>
          ) : (
            <>
              <div className="grant-summary">
                <span>
                  Add{" "}
                  <b className="mono green">{points(Number(amount))} points</b>
                </span>
                <span>
                  Before{" "}
                  <b className="mono">{points(data?.account.available)}</b>
                </span>
                <span>
                  Expected after{" "}
                  <b className="mono">
                    {points((data?.account.available || 0) + Number(amount))}
                  </b>
                </span>
              </div>
              <p>Reason: {reason}</p>
              <p className="tiny muted">
                The actual transaction records the current balance at commit
                time. Your verified administrator identity and reason will be
                retained in the audit log.
              </p>
            </>
          )}
          {message && (
            <div className="notice error" role="alert">
              {message}
            </div>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                confirm ? setConfirm(false) : dialog.current?.close()
              }
            >
              {confirm ? "Go back" : "Cancel"}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !/^\d+$/.test(amount) ||
                Number(amount) < 1 ||
                reason.trim().length < 5
              }
            >
              {busy
                ? "Applying grant…"
                : confirm
                  ? "Confirm point grant"
                  : "Review grant"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
function AuditPage() {
  const { data, error, reload } = useData<Audit[]>("/admin/audit");
  return (
    <>
      <PageHeading
        eyebrow="PRIVATE / ACCOUNTABILITY"
        title="Every adjustment has a story."
        description="The latest 100 administrative grant events. Records are append-only through the application."
      />
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <section className="panel">
          <AuditTable rows={data} />
        </section>
      )}
    </>
  );
}
function AuditTable({ rows }: { rows: Audit[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>TIME / OPERATION</th>
            <th>ADMIN / TARGET</th>
            <th>POINTS</th>
            <th>BEFORE → AFTER</th>
            <th>REASON / RESULT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td>
                {new Date(r.createdAt).toLocaleString()}
                <code className="table-sub">{r._id}</code>
              </td>
              <td>
                {r.actorEmail}
                <Link
                  className="table-sub green"
                  href={`/admin/users/${r.userId}`}
                >
                  {r.userId}
                </Link>
              </td>
              <td className="mono green">+{points(r.amount)}</td>
              <td className="mono">
                {points(r.before)} → {points(r.after)}
              </td>
              <td>
                {r.reason}
                <small className="table-sub">{r.result}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty premium-empty">
      <History size={30} />
      <h3>No adjustments yet.</h3>
      <p>
        Authorized point grants will appear here with their reason and operation
        ID.
      </p>
    </div>
  );
}
