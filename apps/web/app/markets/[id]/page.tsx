"use client";
import { use, useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import {
  acceptanceMessage,
  type Market,
  type Side,
  type Agreement,
} from "@zyro/shared";
import { useData, api, DataState, zec, date } from "../../../components/data";
import { Button } from "../../../components/ui/button";
import { MarketFunding } from "../../../components/market-funding";
function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export default function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    data: m,
    error,
    reload,
  } = useData<Market & { agreement: Agreement }>("/markets/" + id);
  const [side, setSide] = useState<Side>("YES");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("side");
    if (requested === "YES" || requested === "NO") setSide(requested);
  }, [id]);
  async function join() {
    setBusy(true);
    setMessage("");
    try {
      const session = await api("/session");
      const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const publicKey = base64(
        await crypto.subtle.exportKey("spki", keys.publicKey),
      );
      const signature = base64(
        await crypto.subtle.sign(
          "Ed25519",
          keys.privateKey,
          new TextEncoder().encode(
            acceptanceMessage(m!.agreementHash, session.id, side),
          ),
        ),
      );
      await api("/markets/" + id + "/join", { side, publicKey, signature });
      setMessage("Acceptance recorded and verified. No funds have moved.");
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!m) return <DataState error={error} retry={reload} />;
  return (
    <>
      <Link href="/markets" className="text-link">
        <ArrowLeft size={15} /> All challenges
      </Link>
      <div className="detail-layout" style={{ marginTop: 28 }}>
        <div>
          <div className="card-top">
            <span className="tag">{m.category}</span>
            <span className="tag">
              {m.example ? "EXAMPLE LISTING" : m.status} ·{" "}
              {m.network || "testnet"}
            </span>
          </div>
          <h1 className="detail-title">{m.question}</h1>
          <p className="muted">{m.description}</p>
          {m.status === "RESOLVED" && (
            <div className="result">
              <strong>Recorded outcome: {m.outcome}</strong>
              <p className="muted">
                Signed by the configured trusted oracle. No on-chain payout has
                been executed.
              </p>
              <p className="hash">Evidence commitment: {m.evidence}</p>
              <a
                className="text-link"
                href={"/api/markets/" + m.id + "/resolution"}
                target="_blank"
                rel="noreferrer"
              >
                Inspect signed outcome receipt <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          <div className="panel">
            <h2>Resolution rules</h2>
            <p className="muted">{m.rules}</p>
            <a
              className="text-link"
              href={m.source}
              target="_blank"
              rel="noreferrer"
            >
              Resolution source <ArrowUpRight size={15} />
            </a>
            <dl className="details-list">
              <div>
                <dt>Funding deadline</dt>
                <dd>{date(m.fundingDeadline)}</dd>
              </div>
              <div>
                <dt>Resolution deadline</dt>
                <dd>{date(m.resolutionDeadline)}</dd>
              </div>
              <div>
                <dt>Cancellation</dt>
                <dd>Unmatched at funding deadline</dd>
              </div>
            </dl>
          </div>
          <div className="panel">
            <h2>Agreement commitment</h2>
            <p className="muted">
              Version 1 · Sorted-key UTF-8 JSON · SHA-256. Acceptance uses a
              browser-generated, ephemeral Ed25519 key. This proves the recorded
              signature, not wallet ownership or identity.
            </p>
            <p className="hash">{m.agreementHash}</p>
            <details>
              <summary>Read the exact committed terms</summary>
              <pre className="hash">{JSON.stringify(m.agreement, null, 2)}</pre>
            </details>
          </div>
          <MarketFunding market={m} />
          <div className="panel">
            <h2>Challenge activity</h2>
            <p className="muted">Created {date(m.createdAt)}</p>
            {m.participants.length ? (
              m.participants.map((p) => (
                <div className="notice" key={p.side}>
                  <Check size={17} />
                  {p.side} accepted · Signature verified{" "}
                  <details>
                    <summary>Receipt</summary>
                    <p className="hash">
                      Public key: {p.publicKey}
                      <br />
                      Signature: {p.signature}
                    </p>
                  </details>
                </div>
              ))
            ) : (
              <p className="muted">
                No acceptances yet. There is no funding activity.
              </p>
            )}
          </div>
        </div>
        <aside>
          <div className="panel">
            <span className="overline green">FIXED-STAKE CHALLENGE</span>
            <h2 style={{ marginTop: 16 }}>
              {zec(m.stake)} <small className="muted">per side</small>
            </h2>
            <dl className="details-list">
              <div>
                <dt>Participants</dt>
                <dd>{m.participants.length} / 2</dd>
              </div>
              <div>
                <dt>Planned winner payout</dt>
                <dd>{zec(m.stake * 2 - 10000)}</dd>
              </div>
              <div>
                <dt>Funding</dt>
                <dd>Not connected</dd>
              </div>
            </dl>
            <div className="choice-buttons">
              {(["YES", "NO"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={
                    "outcome " +
                    s.toLowerCase() +
                    (side === s ? " selected" : "")
                  }
                  aria-pressed={side === s}
                  disabled={m.participants.some((p) => p.side === s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <label
              className="muted tiny"
              style={{
                display: "flex",
                gap: 10,
                alignItems: "start",
                marginBottom: 20,
              }}
            >
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                style={{ minHeight: 20 }}
              />{" "}
              I have reviewed the committed terms above and accept this side.
              This records an agreement only.
            </label>
            <Button
              className="full"
              disabled={!accepted || busy || m.example || m.status !== "OPEN"}
              onClick={join}
            >
              {busy
                ? "Signing acceptance…"
                : m.example
                  ? "Example · create your own"
                  : "Sign acceptance · " + side}
            </Button>
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
          </div>
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              Escrow and shielded settlement are not available. Never send funds
              to an address supplied by an unofficial operator.
            </span>
          </div>
          {m.example && (
            <Button
              asChild
              variant="secondary"
              className="full"
              style={{ marginTop: 20 }}
            >
              <Link href="/create">Create a real challenge</Link>
            </Button>
          )}
        </aside>
      </div>
    </>
  );
}
