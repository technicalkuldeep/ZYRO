import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Fingerprint,
  Github,
  Sparkles,
  FlaskConical,
  LockKeyhole,
  Zap,
  Crosshair,
  CheckCircle2,
} from "lucide-react";
import { HeroVisual } from "../components/hero-visual";
import { FeaturedPredictions } from "../components/featured-predictions";
export default function Home() {
  // Entrance: copy 0ms → instrument 100ms → lower sections in normal document flow.
  return (
    <>
      <section className="landing-hero wrap">
        <div className="hero-editorial">
          <span className="eyebrow">
            <span className="status-dot" /> A LITTLE CONVICTION GOES A LONG WAY
          </span>
          <h1>
            Predict freely.
            <br />
            <em>Settle privately.</em>
          </h1>
          <p>
            Big questions. Independent thinking.
            <br />
            Find your forecasting instinct in a free Arena.
            <br className="desktop-break" /> Explore a more private future with
            Zcash.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/arena">
              Enter the Arena <ArrowUpRight size={18} />
            </Link>
            <Link className="text-link" href="#discover">
              Explore predictions <ArrowRight size={16} />
            </Link>
          </div>
          <div className="hero-assurance">
            <span>
              <CheckCircle2 size={14} /> 100 free starting points
            </span>
            <span>
              <ShieldCheck size={14} /> No wallet needed
            </span>
          </div>
        </div>
        <HeroVisual />
      </section>
      <div className="brand-strip">
        <div className="wrap">
          <span>CURIOUS MINDS WELCOME.</span>
          <strong>Free to play</strong>
          <i />
          <strong>Open by design</strong>
          <i />
          <strong>Privacy in progress</strong>
          <span className="strip-end">EXPLORING ZCASH.</span>
        </div>
      </div>
      <section className="landing-section wrap" id="discover">
        <div className="section-title">
          <div>
            <span className="overline green">
              THE WORLD IS FULL OF QUESTIONS
            </span>
            <h2>Have a point of view?</h2>
          </div>
          <Link className="text-link" href="/markets">
            Discover challenges <ArrowUpRight size={17} />
          </Link>
        </div>
        <p className="section-description">
          Questions from the public challenge explorer. Example records are
          labeled; on-chain settlement is not live.
        </p>
        <FeaturedPredictions />
      </section>
      <section className="landing-section wrap" id="experiences">
        <div className="section-title">
          <div>
            <span className="overline green">
              ONE PLATFORM. THREE HORIZONS.
            </span>
            <h2>Choose your kind of possibility.</h2>
          </div>
          <p className="muted">
            Start with a game.
            <br />
            Stay for what comes next.
          </p>
        </div>
        <div className="experience-grid">
          <article className="experience arena-experience">
            <div className="experience-top">
              <Sparkles />
              <span className="tag">AVAILABLE NOW</span>
            </div>
            <span className="experience-number">01</span>
            <h3>Arena</h3>
            <p>
              Your instinct. A worthy opponent.
              <br />A completely free place to make your call.
            </p>
            <ul>
              <li>100 starting ZYRO Points</li>
              <li>Quick rounds against Signal, the rule-based bot</li>
              <li>Personal history, ranks & milestones</li>
            </ul>
            <Link className="button primary" href="/arena">
              Play for free <ArrowUpRight size={17} />
            </Link>
            <small>Google sign-in · No monetary value</small>
          </article>
          <article className="experience testnet-experience">
            <div className="experience-top">
              <FlaskConical />
              <span className="tag">DEVELOPER PROTOTYPE</span>
            </div>
            <span className="experience-number">02</span>
            <h3>Testnet</h3>
            <p>
              A closer look at the technology
              <br />
              behind a more private future.
            </p>
            <ul>
              <li>Real Zcash testnet observation</li>
              <li>Shielded transactions with valueless TAZ</li>
              <li>User-controlled wallet support is planned</li>
            </ul>
            <Link className="button secondary" href="/wallet">
              Explore testnet <ArrowUpRight size={17} />
            </Link>
            <small>Independent of your Google account</small>
          </article>
          <article className="experience mainnet-experience">
            <div className="experience-top">
              <LockKeyhole />
              <span className="tag">COMING SOON</span>
            </div>
            <span className="experience-number">03</span>
            <h3>Mainnet</h3>
            <p>
              The long-term vision.
              <br />
              Built carefully, one step at a time.
            </p>
            <ul>
              <li>Potential real-ZEC functionality</li>
              <li>Subject to legal & independent security review</li>
              <li>No real-money wagering available</li>
            </ul>
            <span className="future-action">
              A future worth building toward <LockKeyhole size={15} />
            </span>
            <small>Research today. Possibility tomorrow.</small>
          </article>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="wrap">
          <div className="section-title">
            <div>
              <span className="overline green">
                SIMPLE CHOICES. CLEAR OUTCOMES.
              </span>
              <h2>
                From a hunch to <em>a little insight.</em>
              </h2>
            </div>
            <Link className="text-link" href="/arena/games">
              Try a practice round <ArrowRight size={16} />
            </Link>
          </div>
          <div className="steps">
            {[
              [Crosshair, "Discover", "Find a question worth asking."],
              [Zap, "Choose", "Make your YES or NO call."],
              [LockKeyhole, "Commit", "Lock a virtual point stake."],
              [CheckCircle2, "Verify", "Wait, reveal, review your result."],
            ].map(([Icon, title, copy], i) => {
              const I = Icon as typeof Crosshair;
              return (
                <div className="step" key={String(title)}>
                  <span className="step-index mono">0{i + 1}</span>
                  <I size={24} />
                  <h3>{String(title)}</h3>
                  <p>{String(copy)}</p>
                </div>
              );
            })}
          </div>
          <p className="how-footnote">
            Arena settles virtual points in your account. Zcash testnet
            transactions are a separate developer experience.
          </p>
        </div>
      </section>
      <section className="landing-section wrap arena-story">
        <div>
          <span className="overline green">MEET YOUR PRACTICE GROUND</span>
          <h2>
            Small stakes.
            <br />
            <em>Sharper thinking.</em>
          </h2>
          <p>
            Make a call against Signal. Watch the commitment reveal. Build a
            track record that belongs to you, across browsers and beyond a
            single session.
          </p>
          <Link className="button secondary" href="/arena">
            Find your rhythm <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="arena-preview">
          <div className="section-title">
            <span className="overline">THE FIRST-ROUND PLAYBOOK</span>
            <span className="tag">EXAMPLE</span>
          </div>
          <div className="preview-balance">
            <small>STARTING POINTS</small>
            <strong className="mono">
              100<span> ZYRO</span>
            </strong>
            <Sparkles size={30} />
          </div>
          <div className="matchup">
            <div>
              <span className="avatar">Y</span>
              <strong>Your call</strong>
              <small>Independent thinking</small>
            </div>
            <span className="mono muted">VS</span>
            <div>
              <span className="avatar bot-avatar">S</span>
              <strong>Signal</strong>
              <small>Rule-based opponent</small>
            </div>
          </div>
          <div className="example-equation">
            <span>
              Stake 10
              <br />
              <b>90 available</b>
            </span>
            <ArrowRight size={20} />
            <span>
              Win returns 20
              <br />
              <b className="green">110 available</b>
            </span>
          </div>
          <p className="tiny muted">
            Illustrative accounting. A loss leaves 90 points. Random practice
            draws cannot be predicted from past results.
          </p>
          <Link className="text-link" href="/arena/leaderboard">
            See real practice rankings <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
      <section className="privacy-story wrap">
        <div className="privacy-art" aria-hidden>
          <div className="privacy-ring ring-one" />
          <div className="privacy-ring ring-two" />
          <Fingerprint size={110} strokeWidth={0.8} />
          <span className="privacy-art-label">
            LESS EXPOSURE.
            <br />
            MORE POSSIBILITY.
          </span>
        </div>
        <div>
          <span className="overline green">PRIVACY IS A PRINCIPLE</span>
          <h2>
            Your perspective is public.
            <br />
            <em>Your financial life needn’t be.</em>
          </h2>
          <p>
            Shielded Zcash transactions can protect payment details that
            transparent blockchains expose. Application choices and metadata
            remain visible to the operator.
          </p>
          <p>
            We’ve demonstrated real testnet transfers and isolated FROST
            research. Integrated threshold escrow, private payouts, and refunds
            are still unfinished.
          </p>
          <Link className="text-link" href="/about">
            Explore the research <ArrowUpRight size={17} />
          </Link>
        </div>
      </section>
      <section className="landing-section wrap faq-grid">
        <div>
          <span className="overline green">GOOD QUESTIONS. CLEAR ANSWERS.</span>
          <h2>A little more clarity.</h2>
          <p className="muted">
            No fine-print surprises.
            <br />
            Here’s where we stand today.
          </p>
          <a
            className="text-link"
            href="https://github.com/technicalkuldeep/ZYRO"
          >
            <Github size={18} /> Built in the open <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="faq-list">
          {[
            [
              "Are ZYRO Points money?",
              "No. They are free, nontransferable game points. You cannot buy, withdraw, redeem, or exchange them. New Google accounts receive 100 points once.",
            ],
            [
              "Do I need a crypto wallet?",
              "Arena only needs Google sign-in. The separate Testnet interface does not require Google and currently provides developer-demo capabilities, not complete self-custodial onboarding.",
            ],
            [
              "Does Arena predict live cryptocurrency prices?",
              "No. The working quick game uses a committed random draw. Real-world event settlement and live price oracles are future work.",
            ],
            [
              "Is private settlement live?",
              "No. Real testnet transfers and isolated FROST signatures have been demonstrated, but threshold market payouts and refunds are not integrated.",
            ],
            [
              "What happens when I sign out?",
              "Your Google-linked Arena balance and history stay in MongoDB. Sign in with the same Google account to continue.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span>+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="closing-cta wrap">
        <div>
          <span className="overline">
            YOUR NEXT GREAT CALL STARTS WITH A QUESTION.
          </span>
          <h2>Trust your curiosity.</h2>
        </div>
        <Link className="button primary" href="/arena">
          Let’s play <ArrowUpRight size={18} />
        </Link>
      </section>
    </>
  );
}
