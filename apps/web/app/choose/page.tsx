"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Sparkles,
  FlaskConical,
  LockKeyhole,
} from "lucide-react";
import { useAuth, Avatar, points } from "../../components/auth";
export default function Choose() {
  const { user, account } = useAuth();
  return (
    <section className="choose-page">
      <div className="choose-intro">
        <Avatar user={user} />
        <span className="overline green">YOUR NEXT CHAPTER</span>
        <h1>
          Welcome, {user?.name.split(" ")[0] || "forecaster"}.<br />
          <em>Where will curiosity take you?</em>
        </h1>
        <p className="muted">
          One identity for Arena. A separate path into Zcash.
          <br />
          Choose your experience.
        </p>
      </div>
      <div className="experience-grid">
        <article className="experience arena-experience">
          <div className="experience-top">
            <Sparkles />
            <span className="tag">AVAILABLE NOW</span>
          </div>
          <h2>Arena</h2>
          <strong className="choose-points mono">
            {points(account?.available)}
            <small> ZYRO POINTS</small>
          </strong>
          <p>
            Your free prediction playground. Quick rounds, a rule-based bot, and
            a track record of your own.
          </p>
          <Link className="button primary" href="/arena">
            Play now <ArrowUpRight size={18} />
          </Link>
          <small>Virtual points · No cash value</small>
        </article>
        <article className="experience testnet-experience">
          <div className="experience-top">
            <FlaskConical />
            <span className="tag">PROTOTYPE</span>
          </div>
          <h2>Testnet</h2>
          <div className="choose-art">
            TAZ<span>VALUELESS / REAL TECHNOLOGY</span>
          </div>
          <p>
            Explore existing Zcash transaction observation. The current demo is
            developer-controlled; self-custodial onboarding is planned.
          </p>
          <Link className="button secondary" href="/wallet">
            Explore testnet <ArrowUpRight size={18} />
          </Link>
          <small>Google identity is independent of wallet custody</small>
        </article>
        <article className="experience mainnet-experience">
          <div className="experience-top">
            <LockKeyhole />
            <span className="tag">COMING SOON</span>
          </div>
          <h2>Mainnet</h2>
          <div className="choose-art">
            ZEC<span>A LONG-TERM VISION</span>
          </div>
          <p>
            Potential real-ZEC functionality, subject to legal review and
            independent security work. Real-money wagering is unavailable.
          </p>
          <span className="future-action">
            Something worth waiting for <LockKeyhole size={16} />
          </span>
          <small>Not available in this prototype</small>
        </article>
      </div>
    </section>
  );
}
