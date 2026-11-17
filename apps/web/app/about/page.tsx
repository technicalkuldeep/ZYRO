import Link from "next/link";
import { PageHeading } from "../../components/shell";
export default function About() {
  return (
    <>
      <PageHeading
        eyebrow="OPEN SOURCE. HONEST ABOUT THE EDGES."
        title="A more private perspective."
        description="ZYRO explores prediction markets and conditional shielded payments on Zcash."
      />
      <div className="panel prose">
        <h2>Why Zcash?</h2>
        <p>
          Transparent payment networks can expose financial relationships. Zcash
          provides shielded payment primitives. ZYRO aims to use those
          primitives for two-participant, fixed-stake YES/NO challenges, with
          market execution off-chain.
        </p>
        <h2>What works today</h2>
        <p>
          Create and browse persistent challenges, accept terms with a
          verifiable browser signature, practice with a rule-based bot, reveal
          committed draws, and track credit balances and prediction history.
          Arena uses no cryptocurrency.
        </p>
        <h2>What is still being built</h2>
        <p>
          A developer-controlled wallet has completed real shielded testnet
          transfers and recognized challenge-specific notes. The isolated Rust
          lab verifies 2-of-3 rerandomized FROST signatures. These
          demonstrations are separate: threshold escrow, integrated payout
          authorization and on-chain market settlement still need further
          integration.
        </p>
        <h2>FROST is signing infrastructure</h2>
        <p>
          A planned 2-of-3 signer quorum would authorize escrow spends after
          checking an accepted agreement and verified outcome. Signers must
          inspect the actual transaction outputs and fees. FROST does not turn
          Zcash into a smart-contract platform. Two colluding signers could
          bypass application policy; unavailable signers could delay refunds.
        </p>
        <h2>Privacy has layers</h2>
        <p>
          Shielded payments would protect payment details at the chain layer.
          ZYRO's server currently sees guest identifiers, prediction choices,
          agreement signatures and request metadata. This is not anonymous
          matching. Public challenge data and participation receipts are visible
          to other app users. Guest sessions are pseudonymous and can be lost
          when browser cookies are cleared.
        </p>
        <h2>Built in the open</h2>
        <p>
          MIT licensed. Testnet only. Work completed before funding is tracked
          separately from the proposed $12,000 ZCG Phase 1 milestones. Future
          work includes independently operated signers, improved matching
          privacy, and an independent audit.
        </p>
        <a
          href="https://github.com/technicalkuldeep/ZYRO"
          className="text-link"
        >
          Read and contribute on GitHub →
        </a>
        <p style={{ marginTop: 20 }}>
          <Link href="/arena">Start in the free Arena →</Link>
        </p>
      </div>
    </>
  );
}
