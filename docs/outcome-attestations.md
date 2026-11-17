# Trusted outcome attestations

This is a testable off-chain resolution mechanism. It is not an independent oracle network, dispute system or payment authorization.

Configure `ORACLE_PUBLIC_KEY` with the oracle's Ed25519 public key encoded as base64 DER SPKI. The oracle private key remains outside ZYRO. No live oracle is configured or claimed.

The oracle constructs this strict object:

```json
{
  "marketId": "a challenge UUID",
  "agreementHash": "64 lowercase hex digits",
  "outcome": "YES",
  "evidenceUrl": "the exact agreed HTTPS source URL",
  "evidenceHash": "SHA-256 of the evidence snapshot, 64 lowercase hex digits",
  "observedAt": "an ISO-8601 UTC timestamp at or after the resolution deadline"
}
```

Sign the UTF-8 result of `resolutionMessage(value)` from `@zyro/shared`, which prefixes sorted-key canonical JSON with `ZYRO resolution v1\n`. Submit `{ "attestation": value, "signature": "base64 Ed25519 signature" }` to POST `/api/markets/:id/resolve`, with the same origin/client headers as other app writes. Server checks trusted key, exact challenge/terms/source, MATCHED state, two acceptances, elapsed deadline, observation time and duplicate recording. It persists both the receipt and RESOLVED outcome atomically. GET `/api/markets/:id/resolution` returns the public receipt.

The signer must independently inspect and archive the evidence snapshot. The server does not fetch arbitrary URLs or claim that a matching URL/digest proves an outcome. Final escrow policy must verify the configured oracle identity, evidence and market-specific rules itself. Receipt key rotation, disputes and fallback cancellation rules remain future work. Current unversioned oracle configuration is suitable for local prototypes only; future market specifications must bind oracle keys before consent.
