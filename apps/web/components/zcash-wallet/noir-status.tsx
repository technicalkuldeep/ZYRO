"use client";
import { noirMessages, type NoirStatus } from "../../lib/zcash-wallet/noir";
import styles from "./wallet.module.css";
export function NoirStatusPanel({
  status,
  version,
  localhost,
  retry,
}: {
  status: NoirStatus;
  version?: string;
  localhost?: string;
  retry: () => void;
}) {
  return (
    <aside className={styles.notice} aria-label="Noir Wallet connection">
      <strong role="status">{noirMessages[status]}</strong>
      {version && <small>Noir {version}</small>}
      {localhost && status === "unavailable" && (
        <div>
          <p>
            Noir 1.0.41 injects on HTTP localhost, but not HTTP 127.0.0.1. Host
            permissions alone do not change its content-script matches.
          </p>
          <a className={styles.textButton} href={localhost}>
            Open this wallet on localhost for Noir
          </a>
          <small>
            These are separate origins. Your encrypted embedded wallet stays on
            its original origin; this link does not move or erase it.
          </small>
        </div>
      )}
      {status === "unavailable" && (
        <p>
          Check that Noir is enabled in this Chrome profile with site access for
          this origin. If two Noir builds are enabled, disable the unused build
          for this profile and reload; ZYRO cannot select between conflicting
          injected providers.
        </p>
      )}
      {status === "unsupported" && (
        <p>
          Use the verified Noir 1.0.41 testnet extension. Noir V2 has not been
          verified with ZYRO.
        </p>
      )}
      {status === "wrong-network" && (
        <p>
          Choose the Noir testnet extension, unlock, then reconnect. ZYRO will
          not switch the extension to mainnet or import its keys.
        </p>
      )}
      {(status === "locked" || status === "unauthorized") && (
        <p>
          Unlock Noir in its extension window, then select Connect Noir Wallet.
          A silent account read cannot distinguish an unauthorized origin from a
          locked wallet unless Noir emits a lock event.
        </p>
      )}
      <button
        onClick={retry}
        disabled={status === "searching" || status === "approval"}
      >
        Retry Detection
      </button>
      <a
        className={styles.textButton}
        href="https://github.com/NoirWallet/noir-wallet/releases"
        target="_blank"
        rel="noreferrer"
      >
        Official Noir releases
      </a>
    </aside>
  );
}
