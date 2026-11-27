import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  Crosshair,
  ScanLine,
  Wallet,
} from "lucide-react";
import { LandingHeader } from "../components/landing-controls";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "ZYRO — Prediction Arena & Zcash Testnet",
  description:
    "Make predictions with virtual points in Arena and explore shielded payments with the ZYRO Zcash Testnet wallet.",
};

const steps = [
  {
    icon: ScanLine,
    title: "Find a market",
    copy: "Browse crypto price predictions and check the rules and closing time.",
  },
  {
    icon: Crosshair,
    title: "Make your call",
    copy: "Choose an outcome and commit virtual points before the round closes.",
  },
  {
    icon: CircleCheck,
    title: "Follow the result",
    copy: "When Arena settles the round, review the result and your points history.",
  },
];

function MarketPreview() {
  return (
    <figure className={styles.market}>
      <figcaption className={styles.marketHeader}>
        <span>
          <i /> Arena / Crypto
        </span>
        <span className={styles.previewLabel}>Interface preview</span>
      </figcaption>
      <div className={styles.marketBody}>
        <div className={styles.instrument}>
          <span className={styles.assetIcon} aria-hidden="true">
            ₿
          </span>
          <div>
            <strong>Bitcoin</strong>
            <small>BTC / USD</small>
          </div>
        </div>
        <h2>Will Bitcoin close above the reference price?</h2>
        <div
          className={styles.outcomes}
          role="group"
          aria-label="Example outcomes"
        >
          <div>
            <ArrowUpRight size={17} aria-hidden="true" />
            <strong>Yes</strong>
            <span>Above reference</span>
          </div>
          <div>
            <ArrowDownLeft size={17} aria-hidden="true" />
            <strong>No</strong>
            <span>At or below reference</span>
          </div>
        </div>
        <div className={styles.marketRule}>
          <span>Example resolution source</span>
          <strong>Coinbase Exchange candles</strong>
        </div>
      </div>
      <Link href="/arena/crypto" className={styles.marketLink}>
        Browse crypto markets <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </figure>
  );
}

function ProductLinks() {
  return (
    <section className={styles.products} aria-label="Explore ZYRO">
      <article className={styles.product}>
        <div className={styles.productHeading}>
          <span className={styles.productIcon}>
            <Crosshair size={23} aria-hidden="true" />
          </span>
          <span className={styles.label}>Arena</span>
        </div>
        <h2>Put your forecasts to the test.</h2>
        <p>
          Predict price moves on BTC, ETH and SOL, or try quick practice games.
          Crypto rounds resolve against Coinbase Exchange price data.
        </p>
        <ul>
          <li>
            <Check size={16} aria-hidden="true" /> 100 starting points with
            Google sign-in
          </li>
          <li>
            <Check size={16} aria-hidden="true" /> Settled results and
            prediction history
          </li>
        </ul>
        <Link href="/arena" className={styles.textLink}>
          Explore Arena <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </article>
      <article className={styles.product}>
        <div className={styles.productHeading}>
          <span className={styles.productIcon}>
            <Wallet size={22} aria-hidden="true" />
          </span>
          <span className={styles.label}>Zcash Testnet</span>
        </div>
        <h2>Try shielded payments on Testnet.</h2>
        <p>
          Create or restore a ZYRO wallet, or connect the Noir browser
          extension. Use the wallet to receive and send Zcash testnet funds.
        </p>
        <ul>
          <li>
            <Check size={16} aria-hidden="true" /> Built-in wallet or Noir
            extension
          </li>
          <li>
            <Check size={16} aria-hidden="true" /> Testnet TAZ has no monetary
            value
          </li>
        </ul>
        <Link href="/testnet" className={styles.textLink}>
          Explore Testnet <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </article>
    </section>
  );
}

export default async function Home() {
  const themeCookie = "zyro_landing_theme";
  const theme = (await cookies()).get(themeCookie)?.value;

  return (
    <div
      className={styles.landing}
      data-zyro-landing=""
      data-theme={theme === "light" ? "light" : "dark"}
    >
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <LandingHeader themeCookie={themeCookie} />
      <main id="main" className={styles.main} tabIndex={-1}>
        <section
          className={`${styles.wrap} ${styles.hero}`}
          aria-labelledby="landing-title"
        >
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>
              <i /> Prediction Arena & Zcash Testnet
            </span>
            <h1 id="landing-title">
              Make your call.
              <br />
              <span>Follow the outcome.</span>
            </h1>
            <p>
              Make predictions with virtual points in Arena, and explore
              shielded payments with the ZYRO Zcash Testnet wallet.
            </p>
            <div className={styles.actions}>
              <Link href="/arena" className={styles.primary}>
                Explore Arena <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/testnet" className={styles.secondary}>
                Explore Testnet <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <small>Arena uses free virtual points. No wallet required.</small>
          </div>
          <MarketPreview />
        </section>
        <div className={styles.wrap}>
          <section
            className={styles.workflow}
            id="how-it-works"
            aria-labelledby="workflow-title"
          >
            <h2 id="workflow-title">How Arena works</h2>
            <ol className={styles.steps}>
              {steps.map(({ icon: Icon, title, copy }) => (
                <li key={title}>
                  <Icon size={23} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
          </section>
          <ProductLinks />
          <section className={styles.closing}>
            <h2>See what’s open in Arena.</h2>
            <Link href="/arena" className={styles.primary}>
              Explore Arena <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <Link href="/" className={styles.wordmark} aria-label="ZYRO home">
            ZYRO<span>.</span>
          </Link>
          <nav aria-label="Footer navigation">
            <Link href="/arena">Arena</Link>
            <Link href="/testnet">Testnet</Link>
            <Link href="/about">About</Link>
            <Link href="/privacy">Privacy & terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
