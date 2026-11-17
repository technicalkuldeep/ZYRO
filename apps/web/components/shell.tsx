"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  Compass,
  FlaskConical,
  LayoutDashboard,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Button } from "./ui/button";
const links = [
  ["/markets", "Explore markets", Compass],
  ["/arena", "ZYRO Arena", Sparkles],
  ["/dashboard", "My predictions", LayoutDashboard],
  ["/wallet", "Zcash wallet", Wallet],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link className="logo" href="/" aria-label="ZYRO home">
          <span className="logomark">Z</span> ZYRO
          <span className="testnet">TESTNET</span>
        </Link>
        <nav className="topnav">
          <Link href="/markets">Markets</Link>
          <Link href="/arena">
            Arena <span className="tiny green">FREE</span>
          </Link>
          <Link href="/about">How it works</Link>
        </nav>
        <Button asChild variant="secondary">
          <Link href="/wallet">
            <Wallet size={16} /> Explore Zcash
          </Link>
        </Button>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <p className="overline">WORKSPACE</p>
          <nav>
            {links.map(([href, label, Icon]) => (
              <Link
                key={href}
                href={href}
                className={path.startsWith(href) ? "active" : ""}
              >
                <Icon size={18} />
                {label}
                {href === "/arena" && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <Button asChild variant="secondary">
            <Link href="/create">
              <Plus size={17} /> Create challenge
            </Link>
          </Button>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <ShieldCheck size={22} />
              <strong>Your edge is yours.</strong>
              <p>Explore prediction markets built around privacy.</p>
              <Link href="/about">
                Meet ZYRO <ArrowUpRight size={14} />
              </Link>
            </div>
            <span className="network">
              <i /> Zcash testnet only
            </span>
            <p className="muted tiny">Open source. Open possibilities.</p>
          </div>
        </aside>
        <main id="main">{children}</main>
      </div>
      <footer>
        <span>© 2026 ZYRO · Predict Freely. Settle Privately.</span>
        <Link href="https://github.com/technicalkuldeep/ZYRO">
          Open source <ArrowUpRight size={14} />
        </Link>
        <span>
          <FlaskConical size={14} /> Testnet prototype · No real funds
        </span>
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
