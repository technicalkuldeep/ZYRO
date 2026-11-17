# Architecture

Browser → Next.js same-origin `/api` proxy → Express → Store → PostgreSQL (deployment) or SQLite (local).

`packages/shared` owns request schemas, agreement schema, canonical serialization, acceptance text, integer payout calculations, and bot rule. `apps/api/src/engine.ts` implements challenge and Arena state. `policy.ts` checks normalized settlement proposals; it is deliberately independent of signing. `zcash.ts` is a read-only node adapter. Frontend components share tokens, panels, buttons, navigation, states and data helpers.

## Persistence and consistency

Records use a typed application JSON payload plus indexed kind and primary ID. PostgreSQL JSONB and Drizzle provide a minimal initial schema; normalize tables and add database-level state constraints before scaling. No financial values use floating point. Stakes are capped at 100,000,000 zatoshis. PostgreSQL mutations use a dedicated connection, transaction and advisory transaction lock. SQLite uses WAL and BEGIN IMMEDIATE. Each Store serializes in-process transactions. Multiple SQLite application processes are not supported for deployment.

Guest initialization is serialized to prevent duplicate balance creation. Arena debit and pending-round creation are atomic, as are reveal and credit award. Duplicate reveal returns the existing result. Only one unresolved round per guest. Internal round secrets never leave the API until resolution; list endpoints redact them.

## Challenge state

OPEN → MATCHED when two opposite sides sign; OPEN → CANCELLED after funding deadline if unmatched. Cancellation is evaluated on listing/detail access. MATCHED → RESOLVED accepts an Ed25519 attestation under a configured trusted oracle public key, after the agreed deadline. The attestation binds agreement hash, outcome, exact evidence URL, evidence digest and observation time. Signature, deadline, URL, state and duplicate checks are tested. This proves the oracle's report, not independent truth. No oracle is configured by default. Funding intents have a separate verified-note lifecycle; MATCHED/RESOLVED do not imply funded or settled.

Agreement v1 uses deterministic sorted-key JSON over explicit immutable terms (including network, source, deadlines, fee/payout and cancellation policy). SHA-256 commits terms. A participant signs `ZYRO acceptance v1`, hash, public guest ID and chosen side, separated by newlines. Node's standard Ed25519 verifier checks it. The guest's public SPKI key and signature form a verifiable receipt. Private acceptance keys are ephemeral; recovery/account linking are future work. Replay to another challenge, side, or guest fails verification; duplicate guest, public key, side or full challenge is rejected.

Version 1 intentionally commits market terms without fixed counterparties. Actual escrow needs a version 2 funding manifest binding both acceptance receipts, payout addresses, funding commitments and signer policy. Both participants must sign that final manifest before funding. There is no claim that the current agreement alone authorizes escrow spends.

## Boundaries

No EVM, Solana, AMM, order book, custom cryptography, or claimed Zcash smart contracts. All blockchain observation checks the connected chain and rejects mainnet before transaction lookup. RPC URLs are server configuration, never user-controlled URLs. No send/broadcast endpoint exists. Future Rust services must decode/inspect actual PCZT data, bind it to verified funding and oracle evidence, and enforce durable duplicate-spend protection before invoking maintained rerandomized FROST implementations.

## Phase 2 verified integration

Live lightwalletd TLS connectivity and a pinned librustzcash subprocess now decode actual public testnet transaction bytes, compute the txid, and check inclusion in the service-reported compact block before reporting confirmations. This trusts the remote chain view, not independently validated consensus. The process receives only public transaction bytes; it never receives wallet secrets.

`FundingService` separates unverified claims from recognized deposits. An optional developer-custodied adapter reads recognized notes from the pinned local wallet database, requires exact receiver/reference/value/external key scope, and combines that with real chain evidence. Output identity is unique across intents; duplicate checks update rather than add balances. Reorgs downgrade funding status, and late notes require operator-dependent refunds. Both actual demo payments were verified. This adapter is disabled by default and forbidden in production. All settlement/payout capability flags remain false.

The actual wallet's signing and broadcast are performed by a separate local CLI, never an API endpoint. The RedPallas FROST lab is cryptographically real but isolated from those wallet spends. Its independent DKG states all run in one lab process; neither distributed signer operation nor threshold PCZT spending is claimed.
