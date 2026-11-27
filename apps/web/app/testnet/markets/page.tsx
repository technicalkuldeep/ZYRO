import Link from "next/link";
import { MarketPanel } from "./market-panel";
import styles from "./markets.module.css";

const evidence = [
  { side: "YES", txid: "949aca173914433db7bb0868aaa3b162b3c170c36ce23ed7e2791a1d242e8d36", height: "4,633,084", confirmations: "4 when recognized" },
  { side: "NO", txid: "7743128f018b5b4e33be17b7d8d0c6fba54430746ac5d289dd67921556d64df1", height: "4,633,090", confirmations: "3 when recognized" },
];

export default function TestnetMarketsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>ZYRO<span>/ TESTNET</span></Link>
        <Link href="/wallet/testnet" className={styles.walletLink}>Open Testnet wallet</Link>
      </header>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>BTC / USD · PREDICTION MARKET</p>
        <div className={styles.status}><span aria-hidden="true" /> LIVE FUNDING DISABLED</div>
        <h1>Will BTC/USD close above its reference price?</h1>
        <p className={styles.lede}>
          Choose a side and review how the round will work. Funding is currently
          disabled; no receiver is issued and this page cannot take a deposit.
        </p>
        <div className={styles.metrics}>
          <div><span>Fixed stake</span><strong>0.01 TAZ each</strong></div>
          <div><span>Market format</span><strong>One YES · one NO</strong></div>
          <div><span>Potential winner amount</span><strong>0.02 TAZ</strong></div>
        </div>
      </section>
      <MarketPanel />
      <section className={styles.rules} aria-labelledby="rules-title">
        <div><p className={styles.eyebrow}>HOW A LIVE ROUND WOULD SETTLE</p><h2 id="rules-title">One candle. One clear result.</h2></div>
        <ul>
          <li>A specific completed Coinbase BTC/USD candle sets the result.</li>
          <li>Above the agreed reference is YES; equality resolves to NO.</li>
          <li>Missing or conflicting candle evidence pauses settlement.</li>
          <li>A real payout would require separate operator review and wallet authorization.</li>
        </ul>
      </section>
      <section className={styles.evidence} aria-labelledby="evidence-title">
        <div className={styles.evidenceHeading}>
          <div><p className={styles.eyebrow}>PUBLIC TESTNET HISTORY</p><h2 id="evidence-title">Real notes observed. No payout claimed.</h2></div>
          <span className={styles.network}>ZCASH TESTNET · TAZ HAS NO MONETARY VALUE</span>
        </div>
        <p className={styles.caveat}>
          These two 0.01 TAZ notes were recognized by the developer-operated
          wallet with their position references and confirmed chain inclusion.
          The same developer operated both demo participants. They were not two
          independent players, and neither note was paid out.
        </p>
        <div className={styles.receipts}>
          {evidence.map((item) => (
            <article className={styles.receipt} key={item.txid}>
              <div className={styles.receiptTop}><strong>{item.side} · 0.01 TAZ</strong><span>{item.confirmations}</span></div>
              <dl>
                <div><dt>Block</dt><dd>{item.height}</dd></div>
                <div><dt>Chain transaction</dt><dd><a href={`https://testnet.zcashexplorer.app/transactions/${item.txid}`} target="_blank" rel="noreferrer">{item.txid}</a></dd></div>
              </dl>
            </article>
          ))}
        </div>
        <p className={styles.notice}>Historical test evidence is not an active market or a promise of custody, refund, or settlement.</p>
      </section>
      <footer className={styles.footer}><span>Operator-assisted prototype · no live intake</span><Link href="/testnet">Testnet wallet details</Link></footer>
    </main>
  );
}
