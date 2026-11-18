# Implementation status

## Round 5 Arena expansion — November 19, 2026

Five quick games and two bot games use precommitted server secrets and the existing point ledger. Coinbase-backed BTC/ETH/SOL markets, immutable specifications, completed-candle evidence and MongoDB-backed resolution/recovery are implemented. Six upcoming markets and actual resolved BTC/ETH/SOL outcomes were recorded; a separate future BTC stake/connection-recreation/settlement test passed against live data. The 100-point grant, Google identity binding, admin credits and existing chain interfaces remain intact. [Full Round 5 report](round5-report.md), [redacted public-source evidence](evidence/round5-arena.json).

## Round 4 consumer account foundation — November 19, 2026

Premium landing, chooser, Google OAuth/OIDC implementation, MongoDB-backed 100-point Arena accounts, practice-game accounting, private admin directory and audited grants are implemented. Actual Atlas transaction tests (12), 45 responsive product-browser checks, legacy browser regression, lint/typecheck/build, and three read-only live Zcash checks passed. Interactive Google consent still requires owner verification. Full scope, limitations and execution results: [Round 4 report](round4-report.md). Historical Phase 3 evidence below is preserved.

Last verified: **November 18, 2026, Phase 3 checkpoint**. No GitHub push or funded milestone completion is claimed. The table below retains Phase 2 feature boundaries; Phase 3 additions and verification follow here.

## Phase 3 additions

- Maintained Ironwood signing support confirmed in upstream frost-tools; no new cryptographic patch introduced.
- Genuine unsigned 1,000,000-zatoshi PCZT created using the existing testnet developer wallet after syncing. Nothing signed or broadcast.
- New read-only Rust PCZT binary computes the v6 digest from actual effects; upstream redacted fixture reproduces the known digest. Rejects malformed/noncanonical/trailing data. Always reports authorizationAllowed=false.
- Strict normalized policy runtime validation and integer/unknown-field/invalid-outcome rejection tests. These do not validate actual PCZT outputs or independently authenticate signer context.
- Broader secret-file exclusions, publication-inventory heuristic scanner, release checklist, architecture diagram, environment guidance and recording walkthrough.
- **53 offline tests passed, 5 external skips; 3 opt-in live tests passed; 4 project Rust tests passed** (one FROST, one transaction decoder, two PCZT diagnostics). Typecheck, lint and production build passed.
- Maintained upstream `cargo test --locked -p zcash-sign --lib`: **3 passed**, separately from the four ZYRO Rust tests.
- Fresh PCZT cross-stack probe: **blocked**, parse succeeds but effects extraction returns `UnknownConsensusBranchId` under maintained frost-tools' older consensus stack. [Compatibility receipt](evidence/pczt-compatibility-phase3.json). No consensus branch rewrite or cryptographic patch applied.
- Browser regression passed: create, two-party signed matching, Arena reserve/reveal, eight routes at three widths, no page errors. Production dependency audit: **0 vulnerabilities**; full development audit not rerun.
- Both historical funding notes re-recognized against the actual read-only wallet database and live testnet chain: exact 1,000,000 zatoshis each, 1,901 / 1,895 confirmations. [Redacted receipt](evidence/funding-recheck-phase3.json).
- PostgreSQL runner failed explicitly for missing TEST_DATABASE_URL after retrying outside the sandbox. Docker/PostgreSQL absent; no regtest verification.
- Fresh transfer observation: height 4,633,072, tip 4,634,955, 1,884 confirmations. [Receipt](evidence/shielded-transfer-phase3.json).
- Initial live checks failed in the network sandbox; the permitted external rerun passed. Initial new Rust rejection test exposed trailing-byte acceptance; wrapper fixed and suite passed. No unresolved failure in the project offline/Rust suites.
- Full independent signer policy, final consent manifest, durable signer replay/nonce journal, process separation, settlement states, threshold custody/funding and on-chain payout remain unfinished. No signing endpoint enabled.

See [engineering checkpoint](phase3-checkpoint.md) and [bounty preparation](bounty-release.md).

## Phase 2 feature inventory

| Component                                                                           | Status                             | Actual evidence / remaining boundary                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Markets, Arena, guest sessions, signed acceptances, matching, cancellation | Implemented / Tested               | Baseline 27 tests independently reproduced before changes; integrated app preserved                                                                                                                  |
| Node/npm/Git                                                                        | Verified                           | Windows Node 22.19.0, npm 10.9.3, Git 2.51.0                                                                                                                                                         |
| WSL2 / Rust                                                                         | Verified                           | Existing Ubuntu 24.04; rustc/Cargo 1.99.0; no system installation needed                                                                                                                             |
| Docker / Compose / PostgreSQL                                                       | Blocked                            | Absent from Windows and WSL; system-change approval requested, not performed                                                                                                                         |
| PostgreSQL persistence verification                                                 | Partially Implemented / Blocked    | Two integration tests cover migrations, API recreation, markets/history/balance and cross-connection concurrency. Explicit runner fails without TEST_DATABASE_URL. No PostgreSQL success claimed     |
| SQLite persistence                                                                  | Implemented / Tested               | App/API restart preserved actual market and funding intents; local recovery used existing on-disk records                                                                                            |
| Public testnet connectivity                                                         | Implemented / Tested live          | TLS lightwalletd chain identity, height and reported software versions; [connection evidence](evidence/chain-connection.json)                                                                        |
| JSON-RPC transport                                                                  | Implemented / Tested with fixtures | Read-method allowlist, bounded retry/timeout, response ID checks, mainnet refusal, expected network and optional genesis fingerprint                                                                 |
| Public transaction lookup                                                           | Implemented / Tested live          | Actual serialized bytes parsed by pinned librustzcash; computed txid, reported compact-block inclusion and confirmations                                                                             |
| Signed shielded public-testnet transfer                                             | Implemented / Verified live        | `0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c`; 0.01 TAZ from developer wallet; mined 4,633,072; observed 3 confirmations; two Ironwood actions, zero transparent inputs/outputs |
| Wallet UI live status and monitoring                                                | Implemented / Tested live          | Actual confirmed transaction displayed, persisted after reload, desktop/mobile screenshots; pending polling and stale/error/manual recheck states                                                    |
| Wallet onboarding / custody                                                         | Partially Implemented              | Maintained external CLI wallet demonstrated. No production self-custodial browser wallet or user key handling. Demo operator controls funds                                                          |
| Challenge references / unverified claims                                            | Implemented / Tested               | Participant-only intents, immutable reference and submitted txid; browser claims cannot supply amount/confirmation evidence                                                                          |
| Developer-custodied shielded note recognition                                       | Implemented / Verified live        | Two real 0.01 TAZ notes recognized against exact receiver/reference/value and chain state; duplicate rechecks did not double-credit; [funding evidence](evidence/market-funding.json)                |
| Funding rejection policy                                                            | Implemented / Tested               | Wrong recipient/reference/network, unsafe or insufficient/excess amount, duplicate output, reorg downgrade, expired/cancelled handling; fixtures explicitly labeled                                  |
| Independent custody / final funding consent manifest                                | Planned                            | Current funding demo is developer-controlled; accepted v1 terms do not constitute consent to integrated threshold escrow                                                                             |
| Real 2-of-3 FROST                                                                   | Implemented / Tested in isolation  | Three-party DKG; all signing pairs; single-share and altered-message rejection; Orchard RedDSA verification; [public evidence](evidence/frost-lab.json)                                              |
| FROST-controlled PCZT / Ironwood spend                                              | Blocked on integration             | Wallet and FROST-tool dependency graphs differ; no transaction threshold signature or independent signer transport demonstrated                                                                      |
| Threshold refund / market settlement                                                | Planned / Not Executed             | Quorum-dependent refunds and actual payouts are unavailable; funding summary always reports settlementEligible=false and payoutBroadcast=false                                                       |
| Signed outcome attestations and normalized payout policy                            | Implemented / Tested               | Independent from wallet/FROST signing; trusted oracle unconfigured by default                                                                                                                        |
| Z3 regtest                                                                          | Blocked                            | Source pinned and inspected; Docker required; public-testnet work proceeded independently                                                                                                            |
| CI and docs                                                                         | Implemented                        | Existing workflow retained; PostgreSQL runner improved; Rust checks added. Hosted execution not claimed                                                                                              |

## Checks actually executed

- Baseline: 27 passing tests, 1 PostgreSQL skip; lint/typecheck passed before edits.
- Expanded ordinary suite: **49 passing**, **5 deliberate external skips** (2 PostgreSQL, 3 opt-in live-chain tests).
- Opt-in live public-testnet suite: **3 passing**; actual chain identity/height, real signed transfer decoding/inclusion/confirmation, unknown-tx rejection.
- Rust FROST suite: **1 passing**, covering DKG and all three signing pairs plus rejection cases.
- Rust transaction-parser suite: **1 passing**, mainnet/invalid-encoding rejection. Actual valid Ironwood bytes were parsed successfully during live checks.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed after integration.
- Browser regression: all eight routes at 375/768/1440 widths, two-party matching and Arena passed. Live wallet browser check displayed actual testnet confirmations and preserved the observation after reload; 375px overflow check passed.
- `npm run test:postgres`: **blocked/fails explicitly** because TEST_DATABASE_URL/server are unavailable. This is not reported as a passing persistence test.
- `npm audit --omit=dev`: **0 vulnerabilities**. Full audit still reports **11 high development-tool dependency findings** through picomatch. No downgrade to an older vulnerable test runner or claim of a fully clean development dependency tree is made.
- Upstream checkout tests were briefly picked up by default Vitest discovery. `vitest.config.ts` now limits discovery to ZYRO's `tests/**/*.test.ts`; the intended suite was rerun.
- The first market-funding polling process hit a development API restart after broadcasting. Local recovery reused the recorded txid and persisted intent; no payment was resent. The connector was adapted to the actual pinned wallet schema's trimmed memos and external-scope self-payment records, then tested and verified against both live notes.

## Next concrete actions

Approve/install Docker in WSL, run PostgreSQL integration tests and Z3 regtest. Then pin a proven compatible threshold-PCZT stack, bind final participant/address/funding manifests and oracle identity to renewed consent, inspect actual transaction sighashes in independent signers, and demonstrate a threshold-authorized payout/refund. No mainnet operations are enabled.
