"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, Moon, Sun, X, Zap } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import styles from "../app/landing.module.css";

const destinations = [
  { href: "/arena", label: "Arena" },
  { href: "/testnet", label: "Testnet" },
  { href: "/markets", label: "Discover" },
  { href: "#how-it-works", label: "How it works" },
];

export function LandingHeader({ themeCookie }: { themeCookie: string }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const accountHref = user ? "/arena/profile" : "/signin";
  const accountLabel = user ? "My profile" : "Sign in";

  useLayoutEffect(() => {
    // The browser may reuse a previously visited homepage from its router cache.
    const landing = header.current?.closest<HTMLElement>("[data-zyro-landing]");
    const saved = document.cookie
      .split(/;\s*/)
      .find((entry) => entry.startsWith(`${themeCookie}=`));
    if (landing)
      landing.dataset.theme =
        saved === `${themeCookie}=light` ? "light" : "dark";
  }, [themeCookie]);

  function toggleTheme(button: HTMLButtonElement) {
    const landing = button.closest<HTMLElement>("[data-zyro-landing]");
    if (!landing) return;
    const theme = landing.dataset.theme === "light" ? "dark" : "light";
    landing.dataset.theme = theme;
    document.cookie = `${themeCookie}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <header
      ref={header}
      className={styles.header}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          setExpanded(false);
          menu.current?.focus();
        }
      }}
    >
      <div className={`${styles.wrap} ${styles.headerInner}`}>
        <Link href="/" className={styles.wordmark} aria-label="ZYRO home">
          <Zap size={19} fill="currentColor" aria-hidden="true" /> ZYRO
          <span>.</span>
        </Link>
        <nav className={styles.desktopNav} aria-label="Main navigation">
          {destinations.map(({ href, label }) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={(event) => toggleTheme(event.currentTarget)}
          >
            <span className={styles.toLight}>
              <Sun size={18} aria-hidden="true" />
              <span className={styles.srOnly}>Switch to light mode</span>
            </span>
            <span className={styles.toDark}>
              <Moon size={18} aria-hidden="true" />
              <span className={styles.srOnly}>Switch to dark mode</span>
            </span>
          </button>
          <Link href={accountHref} className={styles.account}>
            {accountLabel}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
          <button
            type="button"
            ref={menu}
            className={`${styles.iconButton} ${styles.menuButton}`}
            aria-label={expanded ? "Close navigation" : "Open navigation"}
            aria-expanded={expanded}
            aria-controls="landing-mobile-nav"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <X size={21} aria-hidden="true" />
            ) : (
              <Menu size={21} aria-hidden="true" />
            )}
          </button>
        </div>
        <nav
          className={styles.mobileNav}
          id="landing-mobile-nav"
          aria-label="Mobile navigation"
          hidden={!expanded}
        >
          {destinations.map(({ href, label }) => (
            <Link key={href} href={href} onClick={() => setExpanded(false)}>
              {label}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ))}
          <Link href={accountHref} onClick={() => setExpanded(false)}>
            {accountLabel}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
