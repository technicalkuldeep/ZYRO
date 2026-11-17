"use client";
import { useState, type FormEvent } from "react";
import type { Market } from "@zyro/shared";
import { api, useData, DataState } from "./data";
import { Button } from "./ui/button";
export function MarketFunding({ market }: { market: Market }) {
  const session = useData("/session");
  if (
    !session.data ||
    !market.participants.some((p) => p.userId === session.data.id)
  )
    return null;
  return <FundingDetails market={market} />;
}
function FundingDetails({ market }: { market: Market }) {
  const { data, error, reload } = useData("/markets/" + market.id + "/funding");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txid, setTxid] = useState("");
  async function action(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await api("/markets/" + market.id + "/" + path, body);
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action("funding-claim", { txid });
  }
  return (
    <div className="panel">
      <h2>Challenge funding</h2>
      <p className="muted">
        Your accepted terms are recorded. Funding references bind a future
        wallet-recognized note to this challenge and participant. A submitted
        transaction ID alone never credits a deposit.
      </p>
      {!data ? (
        <DataState error={error} retry={reload} />
      ) : (
        <>
          <dl className="details-list">
            <div>
              <dt>Deposit</dt>
              <dd>{data.intent?.state || "NOT REQUESTED"}</dd>
            </div>
            <div>
              <dt>Shielded wallet recognition</dt>
              <dd>
                {data.depositRecognitionConfigured
                  ? "Configured"
                  : "Not configured"}
              </dd>
            </div>
            <div>
              <dt>Threshold authorization</dt>
              <dd>{data.thresholdAuthorization}</dd>
            </div>
            <div>
              <dt>Payout broadcast</dt>
              <dd>{data.payoutBroadcast ? "Broadcast" : "Not broadcast"}</dd>
            </div>
            <div>
              <dt>Settlement eligible</dt>
              <dd>
                {data.settlementEligible ? "Yes" : "No · escrow not integrated"}
              </dd>
            </div>
          </dl>
          {!data.intent ? (
            <Button
              variant="secondary"
              className="full"
              style={{ marginTop: 20 }}
              disabled={busy || market.status !== "MATCHED"}
              onClick={() => action("funding-intent", {})}
            >
              Create funding reference
            </Button>
          ) : (
            <>
              <p className="hash" style={{ marginTop: 20 }}>
                {data.intent.reference}
              </p>
              {data.intent.recipient ? (
                <>
                  <p className="notice">
                    Developer-custodied testnet demonstration. The operator
                    controls this wallet; it is not FROST escrow. Send valueless
                    TAZ only, with the exact memo reference above.
                  </p>
                  <p className="hash">Recipient: {data.intent.recipient}</p>
                  <p className="muted tiny">
                    Expected: {data.intent.expectedZatoshis.toLocaleString()}{" "}
                    zatoshis. Use a shielded memo matching the reference
                    exactly. Refunds require the developer wallet operator; no
                    automatic payout or refund exists.
                  </p>
                </>
              ) : (
                <p className="muted tiny">
                  No escrow address is issued. Do not send funds. This reference
                  does not configure a wallet.
                </p>
              )}
              {data.intent.txid ? (
                <>
                  <p className="hash">Claimed txid: {data.intent.txid}</p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => action("funding-recheck", {})}
                  >
                    Recheck wallet recognition
                  </Button>
                </>
              ) : (
                <form onSubmit={submit}>
                  <div className="field">
                    <label htmlFor="funding-txid">
                      Existing test transaction ID (unverified claim only)
                    </label>
                    <input
                      id="funding-txid"
                      value={txid}
                      onChange={(e) => setTxid(e.target.value)}
                      required
                      pattern="[a-f0-9]{64}"
                      maxLength={64}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                  <Button disabled={busy}>Record unverified claim</Button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </div>
  );
}
