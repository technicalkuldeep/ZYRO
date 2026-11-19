"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./wallet.module.css";
export function TestnetWalletEntry() {
  const [noirHref, setNoirHref] = useState("/wallet/testnet");
  useEffect(() => {
    if (
      location.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(location.hostname)
    ) {
      const url = new URL("/wallet/testnet", location.origin);
      url.hostname = "localhost";
      setNoirHref(url.href);
    }
  }, []);
  return (
    <section
      className={`${styles.wallet} ${styles.entry}`}
      aria-label="Testnet wallet onboarding"
    >
      <div className={styles.panel}>
        <span className={styles.eyebrow}>ZCASH TESTNET · TAZ</span>
        <h1>
          Your testnet wallet.
          <br />
          <em>Your choice.</em>
        </h1>
        <p>
          Create or restore an encrypted browser wallet, or connect Noir. No
          Google account is required. The existing transaction observer and
          developer tools remain below.
        </p>
        <div className={styles.actions}>
          <Link href="/wallet/testnet" className={styles.primary}>
            Open Zcash Testnet Wallet
          </Link>
          <Link href={noirHref}>Connect Noir Wallet</Link>
        </div>
        <small>
          Noir V1 uses HTTP localhost. Embedded wallets remain on their original
          browser origin. Mainnet and Arena balances are separate.
        </small>
      </div>
    </section>
  );
}
