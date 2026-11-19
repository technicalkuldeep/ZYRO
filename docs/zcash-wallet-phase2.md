# ZYRO Phase 2 — Zcash public-testnet wallet

Status: implemented browser-wallet integration with real Ironwood spending and
chain confirmation evidence. **The complete definition of done is not verified**:
receiving-wallet observation of the final payment and funded external spending
remain unverified. Real Noir 1.0.41 authorization is now verified. Do not represent
this as an audited production wallet.

## Architecture and isolation

- `/wallet/testnet` is anonymous. It is outside the Arena access layout.
- Embedded keys, mnemonic, decryption, scanning, fee estimation, proving and signing
  run in a dedicated browser worker. There is no key-owning ZYRO backend.
- The worker owns a Web Lock, so another tab cannot concurrently unlock or mutate
  the same wallet. RPC operations are serialized. Termination releases the lock,
  stops fetches and disposes the worker and its child threads.
- IndexedDB `zyro-zcash-testnet-v1` stores one encrypted seed/database checkpoint.
  Public faucet receipts and external-send intents use wallet-specific localStorage
  keys; these contain no seeds, spending keys, passwords or memos.
- Noir uses the published `@noir-wallet/sdk` API and its extension's own signing
  approval. No external private key or mnemonic is requested.
- `/api/zcash/testnet/faucet/*` maps to isolated Next Node route handlers. Nothing
  was registered in Express; no Arena middleware or authentication was weakened.
- The original Express `/api/*` proxy remains the `afterFiles` rewrite. An exact
  wallet namespace rewrite runs first, because the original proxy otherwise
  intercepts dynamic Next API handlers. All other API destinations are unchanged.
- Only the wallet document and wallet assets receive WASM isolation headers.
  Existing global styles, Shell, Google login, Arena UI, price feeds, market APIs,
  MongoDB schemas and settlement code remain unchanged.

The enclosing pre-existing Shell still makes its normal account-status request;
the wallet never reads that session, waits for it, or uses its result.

## Engine selection and compatibility

Selected engine: NoirWallet's browser WASM wallet, built on its librustzcash and
memory-wallet integration. It exposes actual `WebWallet` scanning, account import,
ZIP-32 derivation, transaction proposals, fee estimation and `oneclick_transfer`.
It is not an address-helper-only library or an EVM wallet.

| Component                                   | Pin                                                                |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Noir source checkout                        | `db5457327d082b38b9d2617d35cbb5693d6145f5`                         |
| Engine source revision declared by upstream | `cb8da9dc60d51dbf3958657be35427210d544541`                         |
| WASM package / ABI                          | `0.1.0` / `zcash-wallet-cb8da9d-v1`                                |
| WASM SHA-256                                | `0b83c3963486310a881a1ebdd24d241c0e595496b60aa1b154c853ad47f71a8e` |
| Noir dApp SDK                               | `2.0.0`                                                            |
| QR encoder                                  | `qrcode 1.5.4`, types `1.5.6`                                      |
| Independent transaction decoder             | existing librustzcash `eb38d7a373661179dbc083a2fd58b3a6c9b25818`   |

The 66,472,202-byte binary and its generated bindings were copied after verifying
all eight declared artifact hashes. They remain byte-for-byte intact. A tiny
wallet-only module-root route resolves wasm-bindgen-rayon's nested worker import;
the upstream helper was not patched. The worker verifies the binary hash again
before instantiation. See `public/zcash-wallet/PROVENANCE.md` and the upstream
integrity manifest, license and third-party notices.

The actual engine reports testnet NU6.3 activation at height **4,134,000**. Source
review confirmed Ironwood input selection, transfer construction and signing.
Real scanning reached the public chain tip and real spending produced a mined
transaction with **five Ironwood actions and zero transparent inputs/outputs**.
There is no transparent fallback. No custom proof, address or signing cryptography
was implemented.

Official librustzcash and zcash-devtool were also reviewed. The existing native
devtool is suitable for local developer custody, not browser-user onboarding;
wrapping its wallet keys in ZYRO's backend would violate this phase's boundary.
Native gRPC lightwalletd alone also does not provide browser key ownership or
proving. The selected WASM package supplies those missing operations.

Licensing is a deployment constraint: Noir-owned code is BUSL-1.1 with no
Additional Use Grant before the 2029-01-01 change date. This work is for
non-production development; production deployment requires the applicable
license or a separately validated compatible replacement. The older published
BlockSec audit is not an audit of this exact artifact or ZYRO's integration.
Artifact hash verification does not prove reproducible source-to-binary builds.

References: [librustzcash](https://github.com/zcash/librustzcash),
[lightwalletd](https://github.com/zcash/lightwalletd),
[zcash-devtool](https://github.com/zcash/zcash-devtool),
[Noir source](https://github.com/NoirWallet/noir-wallet),
[pinned wallet implementation](https://github.com/NoirWallet/zcash-wallet-wasm/blob/cb8da9dc60d51dbf3958657be35427210d544541/src/wallet.rs).

## Network, synchronization and amounts

The browser connects directly to the current Noir testnet registry endpoint,
`https://zcash-wallet-grpc-testnet.deltarpc.com`, using gRPC-web. It was verified
with real tip reads, account creation, scanning, receipt of funds and broadcasting.
It is fixed to public testnet; arbitrary browser-provided endpoints are not accepted.
The separate existing read-only chain observer uses its unchanged configured
testnet lightwalletd endpoint for independent transaction inclusion checks.

The worker uses `test`, ZIP-32 account index zero and an empty BIP-39 passphrase.
New wallets have a 20-block safety margin for their birthday. Restoration requires
the saved birthday or an earlier height (at least testnet Sapling activation,
280,000). A recent birthday must never be substituted for an old wallet's actual
birthday. There is no claim to import every other wallet's derivation convention.

Three confirmations are configured for trusted and untrusted funds. The engine
handles its own note scanning, commitment trees and reorganization logic. Each
batch persists an encrypted database checkpoint. Missing or lagging scan data is
unknown, not zero. The UI shows chain tip, scanned height and last successful
sync. Syncs do not overlap, pause while the page is hidden, and retry with capped
backoff. Worker HTTP requests have 45-second deadlines. Lock/disposal stops work.

Amounts use bigint zatoshis: 100,000,000 zatoshis per TAZ. Display formatting is
separate from accounting. The engine calculates a specific transfer proposal's
fee using ZIP-317's 5,000-zatoshi marginal-fee policy; the total fee is not assumed
to be a constant. Amount, destination, fee, total, network and memo are shown before
authorization. Quotes expire after 60 seconds. Funding is explicitly shielded.

History uses the engine's `TransactionHistoryEntry`, including little-endian txid
bytes, direction, amount, known fee, height and timestamp. It never infers private
amounts from an explorer. Mined transactions are only labelled Confirmed after
three confirmations. A reorganization can downgrade that status.

## Key management and recovery

The engine generates a cryptographically random 24-word BIP-39 phrase. Recovery
uses the engine's BIP-39 validator and the same account/network derivation. The
backup flow requires acknowledgement of saving the phrase and birthday before
sending. If refreshed before acknowledgement, unlocking presents the unfinished
backup again. Recovery phrases are never submitted to a ZYRO server.

Persistent secrets and scanned database are encrypted together with AES-256-GCM,
a fresh 96-bit nonce per checkpoint, authenticated application/network/version
metadata, and a random 128-bit salt. PBKDF2-HMAC-SHA-256 uses 600,000 iterations.
The minimum password length is 12 characters. The derived CryptoKey is
non-extractable; the password is not persisted. Plaintext byte buffers are cleared
where practical. JavaScript strings cannot be guaranteed zeroized; worker
termination and prompt backup dismissal limit their lifetime.

Manual lock terminates the worker. Inactivity locks after five minutes once no
sensitive operation is running. Clearing browser storage still removes local
wallet state: the offline phrase/birthday backup is essential. Wrong passwords
do not overwrite stored data. A second tab is refused rather than racing writes.

Before a send, an encrypted durable intent is saved. Signing/broadcasting never
silently retries. A known submitted txid is reconciled against wallet history;
unknown submissions remain blocked. An interruption with no recoverable txid
requires manual recovery/reconciliation and is deliberately not auto-cleared.
The bundled SDK performs proving/signing/broadcasting as one operation, so the UI
labels those stages together rather than pretending to expose nonexistent hooks.

Noir's SDK has meaningful limitations: confirmed balance, detailed scan progress
and private transaction history are unavailable through the reviewed dApp API.
These remain unknown in ZYRO. Fixed decimal payments and an explicit Send Max
action are supported. Arbitrary-amount fees are labelled as reference estimates;
Noir's approval is authoritative for the final fee and total. Explicit rejection
code 4001, or the exact official V1 rejection message, clears the external intent;
ambiguous failures retain it. Web Locks serialize authorization across tabs.
The installed official 1.0.41 testnet extension was tested in an isolated profile:
real approval, refresh, disconnect and rejection passed. Funded external signing
and broadcasting remain unverified. See the completion review below.

## Fauzec

The implementation was checked against the live
[OpenAPI schema](https://fauzec.com/.well-known/openapi.json) and
[official faucet](https://fauzec.com/).

- GET `/api/zcash/testnet/faucet/network` reads live drip/cooldown configuration.
- POST `/api/zcash/testnet/faucet/claim` accepts only `network: testnet`, a receiving
  address and the client's UUID request ID. Extra fields, including secrets, fail
  strict validation. The browser first fully decodes its UA with the actual engine;
  Fauzec independently validates the submitted address. The proxy's syntactic
  filter is not claimed to be a complete address decoder.
- GET `/api/zcash/testnet/faucet/status/:requestId` resumes the same receipt.

The UUID is persisted before POST, sent to Fauzec, and never regenerated after a
timeout. POSTs are not automatically retried. Status polling is sequential,
bounded to 60 attempts with a 60-second maximum interval, and can be resumed by
the user. Confirmed faucet receipts trigger wallet scanning, never a balance
credit. Response schemas reject network and request-identity mismatches. Unknown
fields, including private receipt memo data, are stripped by the proxy.

The proxy has same-origin/custom-header checks, strict methods/paths, bounded
body sizes, 15-second upstream deadlines, no redirect following, per-address and
instance rate limits, and no credential forwarding. Requester-level faucet
limits apply to the proxy's outbound IP, not a fabricated forwarded identity.
For multi-instance hosting, add a wallet-only distributed limiter or use the
official website; the in-memory limiter is per process and not a durable global
quota. Captcha, cooldown, dry faucet, unavailable service and ambiguous receipt
states have explicit recovery messages and an official-site fallback. Human
verification is never bypassed.

## Local development and deployment

Use the existing supported Node runtime and `npm ci`. No existing `.env` variable
was edited and no new Arena configuration is required. Start the existing API
and web development commands, then open `/wallet/testnet` directly without Google.
For an isolated check without disturbing the primary frontend:

```powershell
$env:ZYRO_NEXT_DIST='.next-qa6'
node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3202
```

Deploy only with the engine licensing resolved and a reviewed noncustodial threat
model. HTTPS or localhost, WebAssembly, workers, SharedArrayBuffer, Web Locks,
IndexedDB, and wallet-scoped COOP/COEP headers are required. Serve every pinned
asset unchanged, including the approximately 66.5 MB WASM file and nested worker
helper. Do not strip the module-root resolver. Native Node runtime is required
for the faucet proxy. Endpoint outages may delay scanning and proving can be
expensive on mobile. Restrictive deployments must allow the verified HTTPS
gRPC-web endpoint; no unsafe browser security flags are required.

Same-origin script compromise can access an unlocked browser wallet. This is not
a hardware-wallet security boundary. Browser extensions and injected providers
must also be trusted by the user. No current integration security audit is claimed.

## Initial implementation verification and evidence (historical)

Before implementation: clean working tree on `main`; empty initial diff; baseline
lint, typecheck and build passed; **101 tests passed, 43 skipped**. Branch creation
needed filesystem approval because `.git` was read-only in the workspace sandbox.
The dedicated branch is `feat/zyro-zcash-wallet-phase2`.

The baseline manifest records SHA-256 hashes of 118 protected original source and
test files. Shared Next configuration and the web package manifest are deliberate
integration exceptions. Generated `next-env.d.ts` is restored after tool runs.
The guard reports **118 checked, zero changed**. No Arena source, test/mock,
Coinbase lifecycle, settlement, authentication or MongoDB model was modified.

Checks performed:

- Final lint, typecheck and production build: passed.
- Full suite: **145 passed, 43 opt-in tests skipped**, including 44 wallet tests.
- Unchanged real MongoDB Round 6 suite: **30 passed**, isolated test database.
- Anonymous browser: real creation, live synchronization, valid decoded UA,
  wrong-password rejection, refresh/unlock, deterministic phrase restoration,
  encrypted storage checks and responsive widths 390/768/1440 passed.
- Isolated Arena browser regression passed: existing sessions, Arena pages,
  Google OAuth 302, real live prices, outage/recovery, API availability and
  continued login protection. Its isolated database was dropped afterward.
- Deliberate live faucet/send run: genuine claim confirmed and embedded wallet
  spendability enabled; 0.01 TAZ requested through the UI and a real transfer
  submitted. The receiving-wallet observation check **failed** when its inactive
  tab auto-locked. The runner now re-unlocks normally instead of disabling the
  production auto-lock, but this funded run was not repeated or replaced with
  another faucet claim. Its original failure is preserved in the evidence.

Real evidence:

- Fauzec request `2bc45f41-2ca0-4600-914e-b28a54d8d1a4`.
- Faucet txid `9edc565516b23c73eb2b3df7cb52355383bdae57944f187c420a2be460e581be`,
  faucet-reported confirmed height 4,639,494.
- Shielded spend txid
  `3ddbfbede6ab2d522879a89eef1c6707a056dfc7a1ae2b6b523d1a5356ef7e93`.
- Independently observed mined height 4,639,499, tip 4,639,513, 15 confirmations
  at `2026-11-19T14:30:51.247Z`. Five Ironwood actions, zero transparent inputs
  and outputs. The txid was computed from actual bytes by librustzcash and found
  in the reported compact block. This is remote-provider inclusion evidence,
  not local consensus proof verification or public proof of private amounts.
- The two controlled QA addresses are in
  [the preserved live attempt](evidence/zcash-wallet-phase2-live-attempt.json).
  No recovery phrase, key or password is published.

See [decoded transfer evidence](evidence/zcash-wallet-phase2-transfer.json),
[baseline hashes](evidence/zcash-wallet-phase2-baseline.json), and the ignored
`artifacts/zcash-wallet/` browser screenshots/reports.

Reproduce non-spending checks:

```powershell
npm run lint
npm run typecheck
npm run build
npm run test -- --maxWorkers=2
node --import tsx scripts/zcash-wallet-guard.ts
node --import tsx scripts/zcash-wallet-browser.ts
node --env-file=.env --import tsx scripts/zcash-wallet-arena-regression.ts
```

The browser runner uses port 3202 unless `ZYRO_WALLET_QA_ORIGIN` is supplied.
Live claims/sends require the explicit `ZYRO_WALLET_LIVE=1` opt-in. They never run
in ordinary Vitest/CI. Respect the existing live claim and Fauzec cooldown;
do not rerun by rotating addresses. The QA runner uses disposable contexts and
in-memory credentials, not production wallet backups. For future long-lived
funded QA, retain a controlled encrypted backup and an operator-owned password.

## Remaining limitations and next phase

Unverified: receiving-wallet scan of the final 0.01 TAZ payment and funded external
signing/broadcasting. External private history/confirmed balances remain unavailable;
fixed-amount sending is implemented but its funded live test is outstanding.
Completely ambiguous sends with no known txid need manual reconciliation;
licensing/security review is required before production. The original funded
browser attempt is not labelled a pass.

Phase 3 can consume the wallet adapter's public address, exact amounts, explicit
approval and confirmed transaction records through a separate boundary. No Arena
deposit, escrow, FROST signing, oracle settlement, payout, mainnet support or
conversion of virtual points was added.

## File inventory

Modified integration/configuration files (no Arena source):

- apps/web/next.config.ts
- apps/web/package.json
- eslint.config.js
- package-lock.json

New wallet modules, tests, evidence and documentation:

- apps/web/app/wallet/testnet/api/faucet/[...action]/route.ts
- apps/web/app/wallet/testnet/page.tsx
- apps/web/app/zcash-wallet/engine/route.ts
- apps/web/components/zcash-wallet/testnet-wallet.tsx
- apps/web/components/zcash-wallet/wallet.module.css
- apps/web/lib/zcash-wallet/client.ts
- apps/web/lib/zcash-wallet/faucet-server.ts
- apps/web/lib/zcash-wallet/faucet.ts
- apps/web/lib/zcash-wallet/noir.ts
- apps/web/public/zcash-wallet/PROVENANCE.md
- apps/web/public/zcash-wallet/engine/LICENSE.md
- apps/web/public/zcash-wallet/engine/README.md
- apps/web/public/zcash-wallet/engine/THIRD_PARTY_NOTICES.md
- apps/web/public/zcash-wallet/engine/package.json
- apps/web/public/zcash-wallet/engine/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js
- apps/web/public/zcash-wallet/engine/wasm-integrity.json
- apps/web/public/zcash-wallet/engine/zcash_wallet_wasm.d.ts
- apps/web/public/zcash-wallet/engine/zcash_wallet_wasm.js
- apps/web/public/zcash-wallet/engine/zcash_wallet_wasm_bg.wasm
- apps/web/public/zcash-wallet/engine/zcash_wallet_wasm_bg.wasm.d.ts
- apps/web/public/zcash-wallet/history.mjs
- apps/web/public/zcash-wallet/vault.mjs
- apps/web/public/zcash-wallet/wallet.worker.mjs
- docs/evidence/zcash-wallet-phase2-baseline.json
- docs/evidence/zcash-wallet-phase2-live-attempt.json
- docs/evidence/zcash-wallet-phase2-transfer.json
- docs/zcash-wallet-phase2.md
- scripts/zcash-wallet-arena-regression.ts
- scripts/zcash-wallet-browser.ts
- scripts/zcash-wallet-guard.ts
- tests/zcash-wallet/address-engine.test.ts
- tests/zcash-wallet/faucet-client.test.ts
- tests/zcash-wallet/faucet.test.ts
- tests/zcash-wallet/history.test.ts
- tests/zcash-wallet/lifecycle.test.ts
- tests/zcash-wallet/noir.test.ts
- tests/zcash-wallet/vault.test.ts

## Completion review — 2026-11-19

This review continues the existing implementation. The working branch was already
`feat/zyro-zcash-wallet-phase2`, with uncommitted Phase 2 files. All of that work was
preserved. A fresh initial patch, file hashes, protected hashes and baseline logs
are retained under ignored `.local/phase2-completion-baseline/`. Baseline lint,
typecheck and build passed; the baseline full suite was 145 passed / 43 skipped.
The historical numbers above describe the initial implementation, not this review.

### Noir detection: root cause and fix

The actual official unpacked **1.0.41 testnet** manifest was inspected. Its
`host_permissions` contain 127.0.0.1, but both provider content scripts match only
`https://*/*` and `http://localhost/*`. Consequently the provider is never injected
on HTTP 127.0.0.1. The SDK was already the official 2.0.0 API; replacing it with
Ethereum discovery would not fix this manifest mismatch.

Discovery now uses browser-only `getNoirWallet()`, the real
`noirwallet#initialized` event and a bounded four-second fallback search. Cleanup
removes event listeners, timers and obsolete asynchronous work. Retry Detection
does not open authorization. Only Connect Noir Wallet calls `zcash.connect()`.
Previously authorized external mode restores silently with `zcash.getAccounts()`.
Account changes invalidate address-scoped quotes, balances, faucet receipts and QR
before rereading authorization. Unsupported providers, wrong networks, locking,
missing authorization, explicit rejection and disconnection have distinct states.
V1 sometimes drops numeric errors; its exact rejection message is recognized.
An unconnected silent `null` cannot conclusively distinguish locked from
unauthorized, and the UI says so rather than inventing lock information.

On HTTP 127.0.0.1 the UI offers the same wallet URL on localhost and explains that
the two origins have separate encrypted storage and permissions. No secrets or
wallet database are copied between origins. With simultaneous Noir builds, disable
the unused build in that Chrome profile and reload: both compete for the same
nonconfigurable `window.noirwallet`; there is no documented Zcash provider selector.
Do not edit the official extension manifest or reinstall merely to hide this issue.

Compatibility gate: V1 >= 1.0.27 through 1.x, or V2, using SDK 2.0.0 and explicit
shielded funding. **Only the actual V1 1.0.41 testnet build was live-tested.** Other
V1 releases and V2 are API targets, not verified extension releases. V1 requires its
testnet build; V2 requires the user to choose Testnet Mode in Developer Settings.
ZYRO never calls deprecated `switchNetwork()` and rejects non-testnet addresses
before the real WASM decoder validates their receivers.

Real extension evidence, isolated from the user's Chrome profile:

- Official installed ZIP directory, unchanged; fresh QA wallet, encrypted QA backup.
- Localhost: installed provider, real Connect Request popup, selected-account
  approval, real authorized UA and Wallet Overview passed.
- Silent reload restored the real account without a second approval popup.
- Disconnect returned `getAccounts() === null`; a subsequent actual Reject action
  displayed Connection rejected.
- Port 3000 was also checked directly: localhost injected 1.0.41; 127.0.0.1 did not.
- Initial headless popup creation failed with “Bounds must be at least 50% within
  visible screen space.” A larger virtual screen resolved this QA-only issue;
  approval was never bypassed or synthetically granted.
- The new unfunded QA public address is
  `utest13e3repn93er8mgukn5xf2z5d9ex85r0heavx8vnw5vv9kjwn4wewqhkukft5p9kp3me34d5nfyxk6mhy746wdju0a0dgzdsmzk5dpl8408s0lm52zhecvm52qpfacm4lfxsfyz5ms59r3vpapymwszgjquuyn0pnc56hwerlysnxm52n`.
  It is evidence, never a hardcoded recipient in the application.

### Website, synchronization and sending

Original homepage, Shell, selection page and `/wallet/page.tsx` are all protected
and remain untouched. The old Testnet destination contains working observer and
developer tools. A new `/testnet` wrapper renders a wallet entry followed by the
complete original page. One exact `/wallet` rewrite routes existing Testnet links
through that wrapper. The wallet implementation remains at `/wallet/testnet`.
Back to Testnet tools and ZYRO home links prevent a dead end. Arena links, Google
flows, Mainnet's existing coming-soon destination and global styles are unchanged.
The legacy observer's explanatory copy is preserved with its original source.

The previous receiving failure occurred when an unattended recipient tab locked;
that historical test runner waited for balances without unlocking. No evidence of
a changed derivation path or overwritten birthday was found. The worker already
encrypts database checkpoints after batches and unlocks from those exact bytes.
The new lifecycle fix removes the busy-sync exemption from the five-minute embedded
idle lock. Lock immediately resets operation state, terminates the worker and
invalidates obsolete completions. Late progress cannot resurrect an unlocked
wallet. The security timeout was neither extended nor disabled. Real anonymous
create, sync, refresh, incorrect password, lock, unlock and deterministic restore
were rerun successfully; funded recipient recovery remains outstanding.

Fixed-amount external payments now pass the requested decimal string, such as
`0.01000000`, to `sendTransaction({to, amount, memo, fundingSource:"shielded"})`.
Send Max remains an explicit alternative. Because this SDK has no exact arbitrary
payment-fee endpoint, getMaxTransfer's fee is visibly a reference for fixed amounts;
the final fee and total require Noir's actual approval. No maximum replaces the
requested amount. Quotes expire; account identity is rechecked before signing;
Web Locks prevent concurrent authorization across tabs; durable intents precede
the popup. Only explicit rejection clears an unsigned intent. Ambiguous outcomes
remain blocked, including after refresh. Legacy receipts without timestamps can
still be reconciled.

New public GET `/api/zcash/testnet/transactions/:txid` checks TLS lightwalletd
`testnet.zec.rocks:443`, verifies testnet identity and compact-block inclusion, then
reports confirmations. Eight-second request budget, bounded concurrency/rate limits,
strict txids and no secret inputs apply. Three confirmations permit explicit
acknowledgement of a known external submission; a public receipt is retained.
Polling is sequential and bounded. Missing/reorged transactions never manufacture
confirmation. This is trusted remote inclusion metadata, not local consensus
validation or a source of shielded amounts, memos or balances. Noir remains the
source for private external-wallet data. Completely ambiguous sends without a txid
still require manual reconciliation in Noir; there is no unsafe “clear and retry.”

The web workspace now declares already-installed `@grpc/grpc-js` 1.14.7 and
`@grpc/proto-loader` 0.8.1 directly. Existing resolved versions were not upgraded.
`lightwalletd.json` is generated unchanged from the existing official vendored
protocol at commit `faaf7aa1f917f41ad41def61d7095330078c8a8d`; the ECC MIT notice is
copied as `lightwalletd.LICENSE`. JSON avoids filesystem-import failures in bundled
Next route handlers. There are no new Express routes or Arena API changes.

### Faucet and live blockchain results

The current published Fauzec OpenAPI schema was fetched and compared to the strict
claim/status adapter. Caller request IDs remain supported, including ambiguous
202 responses. The current live configuration reports testnet, 100,000,000 zatoshis,
24-hour cooldown and **Turnstile**. ZYRO now disables tokenless API claims when live
configuration requires verification and points to official Fauzec. It does not
retry claims, rotate addresses or bypass verification. The selected account's
address and receipt keys remain isolated; no receipt credits a wallet balance.

The original request ID `2bc45f41-2ca0-4600-914e-b28a54d8d1a4` was queried again:
confirmed, faucet txid `9edc565516b23c73eb2b3df7cb52355383bdae57944f187c420a2be460e581be`,
height 4,639,494. No fresh claim was submitted in this review.

The previous shielded send
`3ddbfbede6ab2d522879a89eef1c6707a056dfc7a1ae2b6b523d1a5356ef7e93`
was independently rechecked: mined height 4,639,499, tip 4,639,756, **258 confirmations**
at `2026-11-19T16:15:05.552Z`. Its preserved earlier decoder evidence reports five
Ironwood actions and no transparent inputs or outputs. This does not prove the
receiver scanned its private note. No fresh payment, recipient recognition or
external transaction signing/broadcast was verified in this review. The isolated
QA extension has no funds; a funded controlled test wallet has not been supplied.
The old disposable browser contexts cannot be assumed recoverable without their
backups. Existing Arena/developer-wallet funds were not touched.

### Security and licensing findings

All eight declared engine artifact hashes match again, including the 66,472,202-byte
WASM. Engine/source/ABI pins above remain unchanged. SDK and public protocol retain
their separate notices. `npm audit --omit=dev` reported zero known vulnerabilities
on this review; it does not audit WASM, prove cryptographic correctness or establish
source-to-binary reproducibility. Third-party notices are an upstream inventory,
not a complete independently verified compiled-engine SBOM.

Reviewed boundaries: encrypted IndexedDB, nonextractable AES keys, PBKDF2-SHA256
600,000 iterations, random salt/IV, authenticated encryption, worker-only key
operations, no backend spending keys, memo/seed logging suppression, exact integer
amounts, account-scoped state, network decoder, explicit authorization, durable
duplicate protection and browser-origin isolation. QA passwords and backups for
the new extension are Windows-DPAPI encrypted under ignored local storage; neither
appears in screenshots or reports. No existing user extension key store was read.
JavaScript cannot promise forensic erasure of immutable strings; local script or
extension compromise remains a trust assumption. Provider flags are discovery
hints, not cryptographic proof of extension identity. Keep only trusted extensions
enabled and verify the payment details inside Noir itself.

The exact engine license is BUSL-1.1, Additional Use Grant **None**, change date
2029-01-01, eventual Apache-2.0. A public testnet product is not automatically
non-production merely because TAZ is valueless. Obtain applicable production rights
from NoirWallet before deployment, or separately review a lawful replacement based
on official MIT/Apache librustzcash or a supported external-wallet-only architecture.
No cryptographic engine was replaced and no production deployment was performed.
This scoped engineering review is not an independent security or legal sign-off.

### Current verification matrix

| Criterion | Status | Evidence / limit |
| --- | --- | --- |
| Arena source unchanged and all protected hashes | VERIFIED | 118 matched; final guard report |
| Original Arena functionality | VERIFIED | Isolated browser, session, OAuth, Coinbase interruption/recovery |
| Testnet website entry and preserved existing content | VERIFIED | Anonymous navigation and back/forward browser regression |
| Wallet creation, restoration and real testnet UA | VERIFIED | Actual WASM and live anonymous browser run |
| Installed Noir detected and real account authorized | VERIFIED | Official V1 1.0.41 testnet popup and account |
| Noir refresh, rejection and disconnection | VERIFIED | Actual extension, not only mocks |
| Wrong-network rejection | VERIFIED | Adapter/decoder tests; actual mainnet extension approval not tested |
| Anonymous onboarding without Google | VERIFIED | Clean browser contexts and homepage navigation |
| Confirmed/spendable balance rendering and sync | VERIFIED | Real fresh-wallet sync; nonzero receiver case outstanding |
| Fresh faucet claim | BLOCKED | Current Turnstile requires official human verification |
| Original faucet request status | VERIFIED | Same persisted request ID confirmed by live API |
| Embedded shielded send under current review | UNVERIFIED | Historical mined transaction rechecked; no fresh funded run |
| Recipient independently recognizes shielded payment | BLOCKED | Need controlled funded sender and retained recipient backup |
| Actual external transaction approval/broadcast | BLOCKED | Fresh isolated Noir account has no spendable TAZ |
| Fixed-amount external send | UNVERIFIED | Implemented and regression-tested; funded live execution outstanding |
| Send Max preservation | UNVERIFIED | Implemented/tested; funded live execution outstanding |
| Lock/unlock checkpoint and identity preservation | VERIFIED | Actual browser plus termination/late-progress regression |
| Existing lint/typecheck/build/tests | VERIFIED | Results below; original assertions untouched |
| Licensing restriction documented | VERIFIED | Exact unchanged upstream license and integrity files |
| V2 / other V1 live compatibility | UNVERIFIED | No actual matching V2 runtime tested |

Current results: lint passed; typecheck passed; production build passed;
**170 tests passed, 43 unchanged opt-in tests skipped**; real MongoDB Round 6
**30 passed**; anonymous embedded browser passed; mocked provider/navigation browser
passed on localhost and 127.0.0.1; real Noir 1.0.41 approval/lifecycle passed;
isolated Arena regression passed (OAuth 302, session 200, liveFeed true,
recovered true, Arena still requires login). Initial sandbox Atlas access timed
out; the same unchanged suite passed when network access was allowed. An initial
Next build exposed proto filesystem bundling; generated protocol JSON fixed it
and the final build passed. No assertions were weakened to address those failures.

Ignored evidence is under `artifacts/zcash-wallet/`: `integration.json`,
`noir-live-status.json`, `noir-lifecycle.json`, `browser-evidence.json`, `arena-guard.json`
and the Arena regression report. The committed-ready completion summary is in
`docs/evidence/zcash-wallet-phase2-completion.json`. Nothing was committed or pushed.

### Exact manual checks before sign-off

1. Run the normal local web/API commands from the working tree. Test the reviewed
   source after the local server loads these changes; QA used isolated port 3202
   and did not replace the running user service. Open
   `http://localhost:3000/wallet/testnet` in the Chrome profile containing the official
   Noir testnet extension. Enable its localhost site access; disable the other
   conflicting Noir build in this profile. Expected: installed/unauthorized state,
   then one approval popup only after Connect Noir Wallet. Approve: a decoded
   `utest1` account appears. Reject: Connection rejected and no connected account.
2. Open `http://127.0.0.1:3000/wallet/testnet`. With the inspected V1 manifest,
   expected: unavailable with a localhost link, never a fake connected state.
   Existing embedded storage stays on 127.0.0.1. HTTPS and each local origin need
   their own Noir authorization. V2 must be checked separately in Testnet Mode.
3. From the homepage click Testnet. Expected: wallet entry followed by the original
   observer/tools. Open wallet, use Back to Testnet tools, then browser back/forward.
   Expected: no Google redirect; Arena still requires its original login and Mainnet
   remains unchanged.
4. Retain encrypted backups and birthdays for two operator-controlled testnet wallets.
   Fund the sender deliberately through official Fauzec human verification or an
   identified QA funding wallet. Wait for wallet-observed spendable funds. Enter the
   second controlled wallet's shielded testnet UA and 0.01 TAZ. Review exact recipient,
   amount, fee and total in Noir; reject once and verify no txid/payment. Review again,
   approve once, record the actual txid, and wait for chain confirmation. Never repeat
   an ambiguous request or rotate faucet addresses. Pass only when the receiver's
   own scan records the incoming note, correct amount, history, confirmed and
   spendable balances; a sender confirmation alone is a fail for this check.
5. While the receiving embedded wallet scans, leave it idle for five minutes.
   Expected: locked even during background work, no exposed balance/phrase. Unlock
   using its password. Expected: same address/birthday and checkpoint resume; after
   scanning, the same incoming transaction appears once. Refresh and unlock again:
   confirmed funds persist. Never disable auto-lock to obtain a passing result.

### Files changed in this completion review

Modified existing Phase 2 files (all outside the 118-file protected set):

- `apps/web/components/zcash-wallet/testnet-wallet.tsx`
- `apps/web/components/zcash-wallet/wallet.module.css`
- `apps/web/lib/zcash-wallet/client.ts`
- `apps/web/lib/zcash-wallet/noir.ts`
- `docs/zcash-wallet-phase2.md`

Narrow shared integration changes:

- `apps/web/next.config.ts` — exact Testnet wrapper rewrite only beyond prior Phase 2 work.
- `apps/web/package.json` — two already-resolved public gRPC dependencies declared.
- `package-lock.json` — matching workspace declarations; no resolved dependency upgrades.

New wallet-specific files:

- `apps/web/app/testnet/page.tsx`
- `apps/web/app/wallet/testnet/api/transactions/[txid]/route.ts`
- `apps/web/components/zcash-wallet/noir-status.tsx`
- `apps/web/components/zcash-wallet/noir-transaction.tsx`
- `apps/web/components/zcash-wallet/testnet-entry.tsx`
- `apps/web/lib/zcash-wallet/external-send.ts`
- `apps/web/lib/zcash-wallet/lightwalletd.json`
- `apps/web/lib/zcash-wallet/lightwalletd.LICENSE`
- `apps/web/lib/zcash-wallet/transaction-status.ts`
- `apps/web/lib/zcash-wallet/use-noir.ts`
- `scripts/zcash-wallet-integration.ts`
- `tests/zcash-wallet/client-lifecycle.test.ts`
- `tests/zcash-wallet/discovery.test.ts`
- `tests/zcash-wallet/external-send.test.ts`
- `tests/zcash-wallet/transaction-status.test.ts`
- `docs/evidence/zcash-wallet-phase2-completion.json`

Pre-existing `eslint.config.js`, other wallet files and original evidence were
preserved; their uncommitted status predates this completion work. Generated
`next-env.d.ts` is restored to its initial bytes after verification. No protected
Arena file changed. Later escrow work may consume the separate wallet interface
only after the live receiving, funded external sending and licensing gates close;
no Phase 3 integration was implemented here.

## Premium wallet UX follow-up

See [ZYRO Wallet premium UX](zcash-wallet-premium-ux.md) for current flows, recovery compatibility, and verification. Historical Phase 2 evidence remains preserved.
