"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
export default function SignIn() {
  const [destination, setDestination] = useState("/arena");
  const [error, setError] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("returnTo");
    if (p?.startsWith("/") && !p.startsWith("//")) setDestination(p);
    if (q.has("error"))
      setError(
        q.get("error") === "cancelled"
          ? "Sign-in was cancelled. You can try again whenever you’re ready."
          : "Google identity could not be verified. Please start sign-in again.",
      );
  }, []);
  return (
    <div className="signin-layout">
      <div>
        <span className="overline green">
          A LITTLE CONVICTION GOES A LONG WAY
        </span>
        <h1>
          Your perspective.
          <br />
          <em>Your place to play.</em>
        </h1>
        <p>
          100 free points to start. A saved track record.
          <br />
          An Arena built for curious minds.
        </p>
        <div className="hero-assurance">
          <ShieldCheck size={18} /> No wallet. No purchases. No cash value.
        </div>
      </div>
      <section className="signin-card">
        <Sparkles size={32} className="green" />
        <h2>Step into the Arena.</h2>
        <p className="muted">
          Use your Google account to save your points and predictions across
          browsers.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <a
          className="button primary"
          href={`/api/auth/google?returnTo=${encodeURIComponent(destination)}`}
        >
          <span className="google-g">G</span> Continue with Google{" "}
          <ArrowUpRight size={17} />
        </a>
        <p className="tiny muted">
          By continuing, you agree to the{" "}
          <Link href="/privacy">prototype terms and privacy notice</Link>.
        </p>
        <hr />
        <Link className="text-link" href="/wallet">
          Just exploring Zcash? No login needed <ArrowUpRight size={15} />
        </Link>
      </section>
    </div>
  );
}
