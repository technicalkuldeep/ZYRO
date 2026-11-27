# Phase 3 TAZ custody and settlement foundation

Milestone 1 supports an isolated, operator-controlled BTC/USD accounting fixture on a MongoDB replica set. One TAZ is 100,000,000 zatoshis. The fixture stakes are 1,000,000 zatoshis per side, the winning obligation is 2,000,000 zatoshis, and cancellation returns 1,000,000 zatoshis to each qualified participant. Operator fee inputs are separate from participant principal.

Live wallet integration and public participation are blocked. The fixture adapter has no spending key, Zcash transaction encoder, prover, or network broadcaster. A fixture receipt, transaction ID, or confirmation is simulated evidence. The existing phase checkpoint documents historical developer-wallet note recognition and an unsigned transaction proposal. Those receipts belong to the earlier wallet work. [Phase 3 engineering checkpoint](phase3-checkpoint.md) · [Deposit recognition evidence](evidence/funding-recheck-phase3.json)

## Trust model

The intended pilot uses a dedicated wallet controlled by the operator. The operator holds its spending keys and can delay or withhold funds. Participants trust the operator to implement the published terms and honor refund and payout obligations. Shielded payments hide some information from the public chain. The operator can associate a ZYRO account, recorded addresses, and wallet-decrypted memo with a position. The pilot uses centralized custody and has no FROST custody or decentralized escrow. Treat it as a testnet engineering exercise.

## Data and execution

| Collection      | Contents and indexes                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| taz_markets     | Unique candle bucket and primary key. Holds versioned terms and digest, cutoff, frozen output IDs and block identities, outcome evidence and cancellation or review reason.                                                                                                      |
| taz_positions   | Unique market plus owner, market plus side, owner plus request ID, and memo. Binds the position to a reviewed pair of fixture destinations, exact amount, testnet wallet receiver, account, terms hash, and deadline.                                                            |
| taz_deposits    | Primary key over network, transaction ID, pool and output or action index. Checks the separately stored commitment for identity conflicts. Indexes market, position and status. Stores canonical block evidence, attribution, review reason, and input reservation.              |
| taz_obligations | Primary key over market payout or output refund identity. Indexes owner and market and enforces unique signed fixture transaction IDs. Stores principal sources, destination, plan, authenticated approval receipt, signed artifact, submission state and confirmation evidence. |
| taz_controls    | Single fixture document for the intake pause, incident, recent canonical scan evidence, spendable principal, unsettled principal and available operator fee reserve.                                                                                                             |
| taz_audit       | Primary key for transition events and an index on subject and time. Records actor, operation, timestamp and evidence digest.                                                                                                                                                     |

Accounting uses validated exact JavaScript integers, with BigInt aggregation and safe-integer checks at representation boundaries. A shared control-document write serializes fixture mutations across MongoDB workers. Transactions use snapshot reads and majority writes. No TAZ path calls Arena's credit ledger. This design intentionally serializes the small fixture and expects a bounded, complete wallet inventory.

Intents use a unique, random memo associated with the authenticated owner and shared custody receiver. The fixture scan models account-owned outputs that the wallet has already decrypted. A transaction hint is immutable once recorded and has no effect on eligibility. An owned output with an unknown memo, wrong recipient, wrong amount, repeated payment, conflict, or late inclusion goes to review. Partial deposits stay separate. A reviewed refund destination must come from the recorded intent. Unattributed funds remain held pending an operator procedure. There is currently no mutation to release an invalid deposit from review.

Funding close uses the first fresh full scan observed in the immutable close window. Its tip height and hash become the cutoff. The scanner waits until that block reaches the configured depth and qualifies a position only if it has a single eligible, exact, spendable output. Missed cutoff evidence, a reorg affecting the frozen funding, or a terms hash mismatch holds the market. An unmatched market cancels and refunds any qualifying stake. A matched market uses one completed exact UTC Coinbase candle bucket and integer close-price comparison. Equality resolves to NO. Missing, malformed, or conflicting observations hold finalization. The fixture supplies observations directly and never queries the live price feed.

The worker creates obligations and records the outcome in one database transaction. Preparation reserves the principal inputs and a separate confirmed fee input. A fixture plan has one beneficiary output and optional wallet-internal fee change. Input IDs, the destination, principal, fee, and change are checked before authorization and rechecked before signing and broadcast. Preparation currently requires a single fee note large enough to cover the payment. Spent or reserved inputs and fee change are excluded from available reserves. The fixture also caps total issued stake conservatively for its lifetime. Resume cannot clear a scanner or balance incident.

The operator credential is separate from Arena roles and enters the fixture through its process boundary, outside Express. It authenticates the planned transaction digest. The simulator seals an approval receipt and derives a stable mock signed artifact using an HMAC. Both operations are process-local, with no live key material. The live boundary must enforce service identity, narrow authorization, durable replay state and least-privilege access independently of application code and MongoDB.

A worker records the signed identity before submission. It atomically claims the initial attempt by moving the obligation to ambiguous before calling the transport. Restart or timeout leaves reconciliation keyed to the same ID. A single operator-approved replay can reuse the identical stored artifact when the adapter proves absence and continued validity at the current tip. Confirmation requires canonical block identity and the configured depth. A reorg can revoke it. An invalidity observation requires matching tip evidence and verified absence. Reservations remain in place and the fixture has no replacement-transaction path. A future replacement requires durable proof of invalidity and non-inclusion and a new explicit approval.

## Access and controls

ZYRO_TAZ_FIXTURES must equal 1 in a non-production testnet process. The main API and Next.js server do not mount the fixture router. An internal fixture host can supply an authenticated account resolver and mount the read-only router at /api/taz. Available routes are GET /markets, GET /markets/:id, GET /positions/:id, and GET /activity. Position and obligation queries are scoped to the authenticated owner. Responses omit addresses, memos, receipts, and raw evidence. The router rate-limits reads and has no state-changing HTTP endpoints.

The fixture requires at least two confirmations, a positive fee cap of at most 100,000 zatoshis, at most a 1,000,000-zatoshi stake per position, at most 10,000,000 zatoshis exposure, and scan freshness within at most 120 seconds. The integration fixture uses a 4,000,000-zatoshi exposure cap and 10,000-zatoshi fee cap. Intake starts paused. A manual intake pause leaves already-recorded refund and payout obligations processable when the custody checks pass. A wrong-network, stale, incomplete, or inconsistent scan records an incident and blocks custody progression until inspected.

## Wallet selection and live blockers

Zallet with Zebra is the preferred candidate for live custody validation. Zallet 0.1.0-beta.4 advertises NU7 testnet support at height 4,465,026. Zebra records the corresponding activation and branch ID 0x77190ad9. Zallet offers account-scoped discovery, a review-first PCZT workflow, proof generation, signing and extraction. Zallet is upstream dual MIT/Apache-2.0. Select and pin a compatible wallet/node pair and review the exact build's dependencies and notices. [Zallet releases](https://github.com/zcash/zallet/releases) · [Zallet licenses](https://github.com/zcash/zallet) · [Zebra NU7 branch](https://github.com/ZcashFoundation/zebra/issues/11445) · [Zallet RPC reference](https://zcash.github.io/zallet/rpc/index.html)

The current ZYRO adapter is FixtureCustody. A live adapter needs to prove a complete restartable inventory of mined and spent owned notes, canonical reorg handling, exact input selection, input spendability, and output disclosure validation. Zallet's documented PCZT construction selects inputs by wallet funding source. Its inspection output includes creator-supplied metadata. That surface alone cannot establish exact note reservations or independently authenticate the shielded recipient and value. Verify a pinned librustzcash-based path or a Zallet extension that enforces those requirements before enabling funds. The signer must also journal the validated final transaction and derive its canonical identity before broadcast. Zallet's extraction updates the wallet's pending-spend state, so recovery across the extraction/journal boundary needs specific testing. [Zallet PCZT RPC reference](https://zcash.github.io/zallet/rpc/index.html#pczt_create) · [librustzcash wallet construction](https://github.com/zcash/librustzcash/blob/main/zcash_client_backend/src/data_api/wallet.rs)

Existing recognition uses a developer wallet database and a supplied transaction hint. The embedded Noir engine has BUSL-1.1 terms and was excluded from this subsystem. The legacy wallet, Noir extension and FROST lab have no authority in this custody flow. [Noir engine provenance](../apps/web/public/zcash-wallet/PROVENANCE.md)

## Reproduce the isolated tests

From the repository root in PowerShell, run the unit suite with:

```powershell
node node_modules/vitest/vitest.mjs run tests/taz-markets.test.ts
```

For the integration suite, start a dedicated loopback MongoDB replica set. Use a database credential restricted to disposable test databases where possible. The integration suite creates and drops its own randomly named database. Set the URI for that replica set, then run:

```powershell
$env:ZYRO_TAZ_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?replicaSet=zyro-fixture'
node node_modules/vitest/vitest.mjs run tests/taz-markets.test.ts tests/taz-markets-mongo.test.ts
```

The test wallet transport uses only in-memory fixture observations. SQLite, live Testnet RPC, production credentials, and Google sign-in configuration are unnecessary for these two files.

## Operator acceptance for one controlled Testnet refund

This acceptance begins after the live adapter, verifier, durable signer journal, and isolated backends are implemented and pass offline negative tests. Keep intake disabled. Obtain explicit operator approval before any real transfer and before constructing, signing, or broadcasting the outgoing Testnet transaction.

1. Provision a private Zebra Testnet backend and pinned Zallet instance under a dedicated service account. Set the wallet network to test, verify public Testnet identity and consensus branch independently, and verify wallet scan freshness. Use a new wallet and a capped, dedicated test payer. [Zallet wallet setup](https://zcash.github.io/zallet/guide/setup.html) · [Zallet network configuration](https://zcash.github.io/zallet/config/index.html)
2. Generate a disposable seed and a passphrase-protected encryption identity in the private signer datadir. Confirm the mnemonic backup locally. Back up the encrypted database and identity separately and verify recovery in an isolated copy. Keep all keys, wallet secrets and backups outside the repository and application process. [Zallet backup and restore](https://zcash.github.io/zallet/guide/backup.html)
3. Approve a total funding cap covering one exact 1,000,000-zatoshi deposit plus a separately recorded operator fee reserve. Cap outgoing fees before provisioning. Pre-review the payer's shielded Testnet Unified Address for the refund.
4. Fund the designated fee reserve and send one approved controlled payment to the recorded intent receiver with its memo, or to its dedicated diversified receiver if supported. Omit the client transaction hint. Record the real owned output identity, commitment, exact amount, block hash, depth, wallet ownership and spendability after synchronization.
5. Close or cancel the private one-position fixture and verify it creates one refund obligation for the full 1,000,000 zatoshis. The operator checks the reserved principal and fee inputs against the wallet state.
6. Prepare one unsigned refund. Independently verify the precise destination, amount, inputs, fee, change ownership and network against the recorded obligation. Reject additional outputs, substituted inputs, out-of-policy fees and unverified disclosures. The separate signer operator authorizes the verified artifact digest, then proves and signs it using the pinned stack.
7. Journal the exact signed transaction identity and store its bytes in the signer boundary before a single authorized broadcast. Use chain and wallet observations to resolve ambiguity. A timeout leaves the same signed transaction pending reconciliation.
8. Confirm canonical inclusion and required depth, then independently verify receipt in the payer wallet. Restart the scanner, signer, and application. Confirm the same obligation, input identities, confirmation, and balance totals are recovered without issuing a second payment. Record redacted evidence containing no keys, viewing capabilities, or private memo.

This refund acceptance is mandatory before enabling live market participation.

## Two participant pilot acceptance

After the refund passes, run one private scheduled BTC/USD market. Give two controlled accounts opposing positions, separate reviewed destinations, and ample funding time. Require two independently qualified 1,000,000-zatoshi outputs and a persisted cutoff block and funding digest. Use a worker that retrieves the exact scheduled Coinbase bucket and persists its evidence. Exercise the missing and conflicting evidence holds before proceeding. Authorize one independently verified payout of 2,000,000 zatoshis, with the operator paying fees separately. Verify the winner receives the exact amount, the losing side has no payout, the payout reaches confirmation depth, and restart recovers the same transaction without duplicate submission. Any later public pilot requires a separate enablement decision.
