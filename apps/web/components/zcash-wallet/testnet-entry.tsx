"use client";
import Link from "next/link";
import { ArrowUpRight, Wallet, Plug } from "lucide-react";
import styles from "./wallet.module.css";
export function TestnetWalletEntry() {
  return (
    <section
      className={styles.wallet + " " + styles.entry}
      aria-label="Testnet wallet onboarding"
    >
      <header className={styles.top}>
        <Link href="/" className={styles.wordmark}>
          ZYRO<span>/ wallet</span>
        </Link>
        <span className={styles.network}>TESTNET · TAZ</span>
      </header>
      <div className={styles.entryIntro}>
        <span className={styles.eyebrow}>PRIVATE PAYMENTS, YOUR WAY</span>
        <h1>
          Your wallet.
          <br />
          <em>Your space.</em>
        </h1>
      </div>
      <div className={styles.entryChoices}>
        <a href="/wallet/testnet" className={styles.entryChoice}>
          <Wallet size={28} />
          <h2>Open ZYRO Wallet</h2>
          <p>Create, unlock, or restore a Zcash testnet wallet.</p>
          <ArrowUpRight size={20} />
        </a>
        <a
          href="/wallet/testnet?connect=noir"
          className={styles.entryChoice}
          onClick={() => {
            try {
              sessionStorage.setItem("zyro:noir-connect-intent", "yes");
            } catch {
              /* The connection view still offers manual approval. */
            }
          }}
        >
          <Plug size={28} />
          <h2>Connect Noir Wallet</h2>
          <p>Use Noir, the Zcash wallet browser extension.</p>
          <ArrowUpRight size={20} />
        </a>
      </div>
      <footer className={styles.footer}>
        Zcash Testnet only. TAZ has no monetary value.
      </footer>
    </section>
  );
}
