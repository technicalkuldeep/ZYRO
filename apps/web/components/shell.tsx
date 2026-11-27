"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Compass,
  FlaskConical,
  LayoutDashboard,
  Trophy,
  History,
  UserRound,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { AuthProvider, useAuth, Avatar, points } from "./auth";
import { api } from "./data";
const arenaLinks = [
  ["/arena", "Overview", LayoutDashboard],
  ["/arena/games", "Discover games", Compass],
  ["/arena/history", "My predictions", History],
  ["/arena/leaderboard", "Rankings", Trophy],
  ["/arena/profile", "Player profile", UserRound],
] as const;
const adminLinks = [
  ["/admin", "Overview", LayoutDashboard],
  ["/admin/users", "Players", UserRound],
  ["/admin/arena", "Arena operations", BarChart3],
  ["/admin/audit", "Audit trail", ShieldCheck],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Frame>{children}</Frame>
    </AuthProvider>
  );
}
function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, account, refresh } = useAuth();
  const [mobile, setMobile] = useState(false);
  const profile = useRef<HTMLDetailsElement>(null);
  const isAdmin = path.startsWith("/admin");
  const workspace = path.startsWith("/arena") || (isAdmin && user?.admin);
  useEffect(() => {
    setMobile(false);
    if (profile.current) profile.current.open = false;
    void refresh();
  }, [path]);
  async function logout() {
    await api("/auth/logout", {});
    window.location.assign("/");
  }
  if (path === "/") return children;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar premium-header">
        <Link className="logo" href="/" aria-label="ZYRO home">
          <span className="zyro-symbol" aria-hidden>
            ϟ
          </span>
          ZYRO<span className="brand-period">.</span>
        </Link>
        <nav className="desktop-links" aria-label="Main navigation">
          <Link href="/markets">Discover</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/arena">
            Arena <i />
          </Link>
          <Link href="/wallet">Testnet</Link>
          <Link href="/about">About</Link>
        </nav>
        <div className="header-actions">
          <span className="mainnet-label">
            Mainnet <small>SOON</small>
          </span>
          {user ? (
            <details
              ref={profile}
              className="profile-menu"
              onKeyDown={(e) => {
                if (e.key === "Escape" && profile.current)
                  profile.current.open = false;
              }}
            >
              <summary>
                <Avatar user={user} />
                <span className="profile-name">{user.name.split(" ")[0]}</span>
                <ChevronDown size={14} />
              </summary>
              <div className="profile-dropdown">
                <strong>{user.name}</strong>
                <Link href="/choose">Choose experience</Link>
                <Link href="/arena/profile">Player profile</Link>
                {user.admin && <Link href="/admin">Admin Dashboard</Link>}
                <button onClick={() => void logout()}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            </details>
          ) : (
            <a
              className="button secondary sign-in"
              href="/api/auth/google?returnTo=/choose"
            >
              Sign in <ArrowUpRight size={15} />
            </a>
          )}
          <button
            className="mobile-toggle"
            aria-label={mobile ? "Close navigation" : "Open navigation"}
            aria-expanded={mobile}
            aria-controls="mobile-nav"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {mobile && (
        <nav
          id="mobile-nav"
          className="mobile-menu"
          aria-label="Mobile navigation"
        >
          {[
            ["/markets", "Discover"],
            ["/#how-it-works", "How it works"],
            ["/arena", "Arena"],
            ["/wallet", "Testnet"],
            ["/about", "About"],
            ["/choose", "Choose experience"],
            ...(user?.admin ? [["/admin", "Admin Dashboard"]] : []),
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setMobile(false)}>
              {label}
              <ArrowUpRight size={16} />
            </Link>
          ))}
          <span className="muted">Mainnet · Coming soon</span>
        </nav>
      )}
      <div className={workspace ? "product-layout" : "public-layout"}>
        {workspace && (
          <aside className="product-sidebar">
            <div className="workspace-label">
              <span className="status-dot" />
              {isAdmin ? "OPERATOR CONSOLE" : "ZYRO ARENA"}
            </div>
            <nav aria-label={isAdmin ? "Administration" : "Arena navigation"}>
              {(isAdmin ? adminLinks : arenaLinks).map(
                ([href, label, Icon]) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={path === href ? "page" : undefined}
                    className={path === href ? "active" : ""}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </Link>
                ),
              )}
            </nav>
            <div className="sidebar-card">
              <ShieldCheck size={24} />
              <h3>
                {isAdmin
                  ? "Every point accounted for."
                  : "All instinct. Zero risk."}
              </h3>
              <p>
                {isAdmin
                  ? "Adjustments are recorded in the audit trail."
                  : "Free points. No purchases. No cash value. Your next prediction is yours."}
              </p>
              <Link href={isAdmin ? "/admin/audit" : "/wallet"}>
                {isAdmin ? "Review audit trail" : "Explore Zcash testnet"}
                <ArrowRight size={14} />
              </Link>
            </div>
            <Link className="sidebar-exit" href="/choose">
              <FlaskConical size={16} /> Switch experience
            </Link>
          </aside>
        )}
        <main id="main" className={workspace ? "product-main" : "public-main"}>
          {workspace && (
            <div className="workspace-topline">
              <span>
                {isAdmin ? "Administration /" : "Arena /"}{" "}
                <b>
                  {path === "/arena" || path === "/admin"
                    ? "Overview"
                    : path.startsWith("/arena/crypto/")
                      ? "Crypto market"
                      : path.startsWith("/admin/users/")
                        ? "Player details"
                        : path.split("/").at(-1)?.replaceAll("-", " ")}
                </b>
              </span>
              {!isAdmin && (
                <span className="balance-chip">
                  <span className="status-dot" />
                  <b className="mono">{points(account?.available)}</b> ZYRO
                  Points
                </span>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
      <footer className="premium-footer">
        <div>
          <Link className="logo" href="/">
            ZYRO<span className="brand-period">.</span>
          </Link>
          <p>Independent minds. Private possibilities.</p>
          <small>© 2026 ZYRO · Open-source prototype</small>
        </div>
        <div>
          <span className="overline">EXPLORE</span>
          <Link href="/arena">Arena</Link>
          <Link href="/wallet">Zcash Testnet</Link>
          <Link href="/about">About the project</Link>
        </div>
        <div>
          <span className="overline">BUILD WITH US</span>
          <a href="https://github.com/technicalkuldeep/ZYRO">
            GitHub <ArrowUpRight size={13} />
          </a>
          <a href="https://github.com/technicalkuldeep/ZYRO/tree/main/docs">
            Documentation
          </a>
          <Link href="/privacy">Privacy & terms</Link>
        </div>
        <div className="footer-note">
          <span className="status-dot" /> Play with perspective.
          <p>
            Arena points have no monetary value. Testnet uses valueless TAZ.
            Mainnet wagering is unavailable.
          </p>
        </div>
      </footer>
    </>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="overline green">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export { BarChart3 };
