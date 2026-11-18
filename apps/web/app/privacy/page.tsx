import { PageHeading } from "../../components/shell";
export default function Privacy() {
  return (
    <>
      <PageHeading
        eyebrow="PROTOTYPE NOTICE"
        title="Privacy & terms"
        description="Clear boundaries for an experimental, open-source product."
      />
      <section className="panel prose">
        <h2>Arena account data</h2>
        <p>
          Google provides your immutable account identifier, name, email,
          email-verification status and optional avatar URL. We store this
          profile, a hashed session token, virtual point balances, predictions,
          ledger records and authorized admin adjustments in MongoDB. Google
          access tokens are not retained. The application operator can access
          account activity.
        </p>
        <h2>Points are a game score</h2>
        <p>
          ZYRO Points have no monetary value. They cannot be purchased,
          redeemed, withdrawn or transferred. Practice results are random
          exercises. This prototype makes no financial or investment promises.
        </p>
        <h2>Separate Zcash experience</h2>
        <p>
          Google identity does not provide wallet custody. Testnet TAZ has no
          monetary value. Existing developer wallet demonstrations are not
          complete self-custodial wallet support. Mainnet wagering is disabled.
        </p>
        <h2>Security and retention</h2>
        <p>
          HttpOnly cookies identify your session. Signing out revokes that
          session but retains your account and gameplay history. Administrative
          grants are recorded in an append-only application ledger. This
          prototype has not received an independent security audit. Contact the
          project owner through the linked GitHub repository for data requests;
          do not post private account information publicly.
        </p>
      </section>
    </>
  );
}
