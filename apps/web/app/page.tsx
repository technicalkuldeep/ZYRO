import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  EyeOff,
  Fingerprint,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { Button } from "../components/ui/button";
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="overline green">
            A DIFFERENT KIND OF PREDICTION MARKET
          </span>
          <h1>
            Predict freely.
            <br />
            <em>Settle privately.</em>
          </h1>
          <p>
            Your perspective has value. Your financial history deserves privacy.
            Explore a new way to make predictions, built natively for Zcash.
          </p>
          <div className="actions">
            <Button asChild>
              <Link href="/markets">
                Explore markets <ArrowRight size={17} />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/arena">
                Try the free Arena <ArrowUpRight size={17} />
              </Link>
            </Button>
          </div>
          <span className="muted tiny">
            <ShieldCheck size={14} /> Testnet only · Open source · No wallet
            needed to practice
          </span>
        </div>
        <div className="hero-preview">
          <div className="preview-label">
            <span className="network">
              <i /> THE ZYRO WAY
            </span>
            <Fingerprint size={22} />
          </div>
          <div className="preview-art">
            <EyeOff size={80} strokeWidth={1} />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
          </div>
          <span className="overline">YOUR NEXT CHAPTER</span>
          <h2>
            A little conviction.
            <br />A lot more privacy.
          </h2>
          <div className="preview-options">
            <Link href="/arena" className="outcome yes">
              Practice for free <ArrowRight size={18} />
            </Link>
            <Link href="/wallet" className="outcome no">
              Explore testnet <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
      <div className="principle-strip">
        <span>BUILT ON ZCASH</span>
        <strong>
          <ShieldCheck /> Privacy by design
        </strong>
        <strong>
          <GitBranch /> Open by default
        </strong>
        <strong>
          <Fingerprint /> Your keys, your control
        </strong>
      </div>
      <section className="section-heading">
        <div>
          <p className="overline green">FROM CURIOSITY TO CONVICTION</p>
          <h2>Start with a question. Learn by doing.</h2>
        </div>
      </section>
      <div className="three-grid">
        {[
          [
            "01",
            "Find your perspective",
            "Explore clear YES/NO questions with fixed stakes and published resolution rules.",
            "/markets",
          ],
          [
            "02",
            "Build your instincts",
            "Practice with virtual credits and a rule-based forecasting bot. No wallet, no purchases.",
            "/arena",
          ],
          [
            "03",
            "Discover shielded payments",
            "Learn about self-custody, testnet TAZ, and the shielded settlement architecture we are building.",
            "/wallet",
          ],
        ].map(([n, title, body, href]) => (
          <Link className="info-card" key={n} href={href}>
            <span className="mono green">
              {n} <ArrowUpRight size={16} />
            </span>
            <h3>{title}</h3>
            <p className="muted">{body}</p>
          </Link>
        ))}
      </div>
      <section className="manifesto">
        <span className="overline">TRANSPARENCY ABOUT PRIVACY</span>
        <h2>
          Private payments are the goal.
          <br />
          Honest engineering is the starting point.
        </h2>
        <p>
          ZYRO runs off-chain challenge matching and free practice today. Real
          shielded transfers and developer-custodied funding are demonstrated on
          testnet. FROST escrow remains integration work. A market agreement is
          a commitment to terms, not an on-chain smart contract.
        </p>
        <Link href="/about" className="text-link">
          Understand the architecture <ArrowRight size={16} />
        </Link>
      </section>
    </>
  );
}
