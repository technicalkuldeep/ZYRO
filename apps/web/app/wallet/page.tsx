"use client";
import Link from "next/link";
import { ArrowUpRight, KeyRound, ShieldCheck } from "lucide-react";
import { PageHeading } from "../../components/shell";
import { useData, DataState } from "../../components/data";
import { Button } from "../../components/ui/button";
import { WalletObserver } from "../../components/wallet-observer";
export default function Wallet() {
  const { data, error, reload } = useData("/zcash/status");
  return (
    <>
      <PageHeading
        eyebrow="YOUR KEYS. YOUR CONTROL."
        title="Discover shielded Zcash."
        description="Start with testnet. Learn the flow. Keep your wallet secrets to yourself."
      />
      <div className="detail-layout">
        <div className="panel steps">
          <h2>Your path to private payments</h2>
          <div className="step">
            <div>
              <h3>Get comfortable in the Arena</h3>
              <p>
                Start without cryptocurrency. Learn how prediction commitments
                and payouts work using free practice credits.
              </p>
              <Button asChild variant="secondary">
                <Link href="/arena">Try the Arena</Link>
              </Button>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Set up maintained testnet wallet tooling</h3>
              <p>
                Use a self-custodial wallet that explicitly supports Zcash
                testnet and shielded addresses. The Zcash Foundation's Z3 stack
                includes Zallet wallet infrastructure; setup requires local
                tooling. ZYRO does not generate or store wallet keys.
              </p>
              <a
                className="text-link"
                href="https://github.com/ZcashFoundation/z3"
                target="_blank"
                rel="noreferrer"
              >
                Z3 and Zallet setup <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Obtain testnet TAZ</h3>
              <p>
                Verify that your wallet and node are on testnet before obtaining
                test coins. TAZ has no monetary value. Mainnet ZEC is never
                needed for this prototype.
              </p>
              <a
                className="text-link"
                href="https://zcash.readthedocs.io/en/latest/rtd_pages/testnet_guide.html"
                target="_blank"
                rel="noreferrer"
              >
                Official testnet guide <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Verify a shielded test transaction</h3>
              <p>
                Use a maintained wallet to sign and broadcast. ZYRO can retrieve
                actual transaction status from configured testnet
                infrastructure. An opt-in local demo wallet can recognize market
                notes; its operator controls spending. Threshold escrow and
                automated payouts are not connected.
              </p>
              <span className="tag">READ-ONLY CHAIN OBSERVATION</span>
            </div>
          </div>
        </div>
        <aside>
          <div className="panel">
            <ShieldCheck size={28} className="green" />
            <h3 style={{ marginTop: 20 }}>Integration status</h3>
            {!data ? (
              <DataState error={error} retry={reload} />
            ) : (
              <dl className="details-list">
                <div>
                  <dt>Network</dt>
                  <dd className="green">
                    {data.chain?.network || data.configuredNetwork}{" "}
                    {data.chain ? "· observed" : "· configured only"}
                  </dd>
                </div>
                <div>
                  <dt>Wallet</dt>
                  <dd>
                    {data.wallet === "developer-custodial-demo"
                      ? "Developer demo · operator custody"
                      : "Not configured · use external wallet"}
                  </dd>
                </div>
                <div>
                  <dt>Node connection</dt>
                  <dd>
                    {data.chain?.connected
                      ? "Connected · " + data.chain.provider
                      : data.rpcConfigured || data.lightwalletConfigured
                        ? "Unreachable"
                        : "Not configured"}
                  </dd>
                </div>
                {data.chain && (
                  <>
                    <div>
                      <dt>Observed height</dt>
                      <dd>{data.chain.height.toLocaleString("en-US")}</dd>
                    </div>
                    <div>
                      <dt>Checked</dt>
                      <dd>
                        {new Date(data.chain.checkedAt).toLocaleTimeString()}
                      </dd>
                    </div>
                    <div>
                      <dt>Service version</dt>
                      <dd>
                        {data.chain.software?.version ||
                          data.chain.software?.subversion ||
                          "Not reported"}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>In-app wallet signing</dt>
                  <dd>Unavailable · external CLI only</dd>
                </div>
                <div>
                  <dt>FROST escrow</dt>
                  <dd>Not integrated</dd>
                </div>
              </dl>
            )}
            {data?.connectionError && (
              <p className="notice error" role="alert">
                {data.connectionError}
              </p>
            )}
            {data && (
              <Button
                variant="secondary"
                className="full"
                style={{ marginTop: 16 }}
                onClick={reload}
              >
                Recheck chain connection
              </Button>
            )}
            {data?.chain && (
              <p className="muted tiny" style={{ marginTop: 16 }}>
                Read-only {data.chain.network} observation from configured
                infrastructure. This connection does not configure a wallet or
                verify market funding.
              </p>
            )}
          </div>
          <WalletObserver />
          <div className="notice">
            <KeyRound size={18} />
            <span>
              Never paste a seed phrase or private key into ZYRO. No support
              agent or API needs your wallet secrets.
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}
