# Round 5 — Arena expansion

This extends the existing Round 4 application. Google login was confirmed working by the owner before this round; authentication and the one-time 100-point initialization were preserved. No commit or push is authorized or performed.

## A. Games implemented

All seven are working server-authoritative games, tested through their UI and real isolated-Atlas ledger transactions:

| Experience                    | Status                                                                     | Tie policy             |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Above or Below 50             | Working; version 2 uniform mapping, old version 1 records still resolvable | No tie                 |
| Coin Flip                     | Working                                                                    | No tie                 |
| Dice Duel                     | Working; both dice uniform                                                 | Total 7 refunds        |
| Red or Black                  | Working; all 52 cards mapped                                               | No tie                 |
| Triple Flip                   | Working; three independent flips                                           | Majority always exists |
| Rock Paper Scissors vs Signal | Working; bot commits before player confirmation                            | Equal choices refund   |
| Lucky Number Duel             | Working; independent 1–100 numbers                                         | Equal numbers refund   |

Preparation precedes final choice; secret/rule commitments, labelled HMAC-SHA256 rejection sampling, recorded choices and idempotent settlement are described in [fairness documentation](arena-fairness.md). Commitment verification demonstrates non-alteration, not independent proof of honest secret generation.

## B. Real-world markets

Public Coinbase Exchange integration was verified for all three USD pairs. Six upcoming market records existed in `zyro` at the **2026-11-18 21:34 UTC** evidence snapshot (November 19 local time). These are historical report timestamps; the running worker replenishes schedules relative to its current UTC clock.

| Pair    | Fixed threshold | Entry cutoff UTC | Observation/candle end UTC |
| ------- | --------------- | ---------------- | -------------------------- |
| BTC-USD | $62,406.92      | Nov 18 21:59:55  | Nov 18 22:01:00            |
| ETH-USD | $1,759.41       | Nov 18 21:59:55  | Nov 18 22:01:00            |
| SOL-USD | $72.95          | Nov 18 21:59:55  | Nov 18 22:01:00            |
| BTC-USD | $62,392.97      | Nov 18 22:29:55  | Nov 18 22:31:00            |
| ETH-USD | $1,753.76       | Nov 18 22:29:55  | Nov 18 22:31:00            |
| SOL-USD | $73.05          | Nov 18 22:29:55  | Nov 18 22:31:00            |

**Live scheduled verification actually completed:** an isolated BTC market was published before entry at a real $62,442.39 threshold. A YES stake reduced available points from 100 to 90. After recreating the connection/service and waiting through the real specified candle, the verified close was $62,437.02, outcome NO, payout zero, available 90, committed zero. Repeated processing left exactly one settlement ledger entry. No test clock or invented provider response was used in this check.

The running application worker also resolved its initial BTC/ETH/SOL markets from genuine source candles: BTC close $62,356.85 → NO; ETH close $1,760.17 → YES; SOL close $73.01 → NO. Evidence, immutable hashes, exact specifications and source rows are in [the redacted receipt](evidence/round5-arena.json). Provider-creation and settlement behavior is therefore live-verified; future scheduled observations remain pending until they occur.

YES means strictly greater than the fixed threshold, NO includes equality. Use the exact completed one-minute candle's close and verify at least ten seconds afterward. Missing data stays Pending Verification, retries at 60-second intervals, and follows the defined unavailable-source refund policy after 24 hours. No price is generated randomly. [Detailed data, worker and recovery policy](arena-market-data.md).

## C. Design work

New Arena home/discovery, five short-game detail experiences, two bot experiences, crypto discovery/detail and admin operations. The Round 4 landing design remains; its FAQ now reflects scheduled crypto support. Custom code-native coin, dice, playing-card, triple-flip, number-dial and versus compositions replace a single generic game form. Result motion starts only after server confirmation and loaded result data. Reduced motion remains supported.

Discovery has category navigation, search, gameplay/status filters, closing/newest sorting and backend-derived availability counts. Home includes actual profile/balance/statistics, pending continuation, recent predictions and real leaderboard data. Mobile uses touch-friendly cards and controls rather than compressed desktop tables. Source charts use actual completed candle closes, a fixed threshold line, source/cache retrieval timestamp and explicit non-live labeling.

Screenshots under ignored `artifacts/round5/` cover home/discovery at 1440/1024/390px, each game, pending crypto, real random win/loss outcomes, empty categories and admin operations. Final browser reports record checks rather than treating screenshots as proof of backend correctness. Visual review corrected a legacy class collision, focus restoration after commitment, sticky-header screenshot positioning and overly tall market-card title space.

## D. Categories

All, Crypto, Quick Predictions and Challenge the Bot have working filters. Politics, Sports, Games, Technology and Economics each have **zero playable challenges** and intentional empty states. The Games topic remains separate from quick-game mechanics. No politics/sports example markets were added to Arena.

## E. Point accounting

The same MongoDB users, sessions, accounts, predictions, results and ledger are reused. New Google identities still receive exactly 100 points once. No resets, daily rewards, automatic top-ups, purchases or cash functionality were added.

Stakes debit available/increase committed points once. Win returns 2× stake; loss returns zero; tie/refund returns the stake. Account/result/ledger updates commit atomically with majority durability and unique operation IDs. Scheduled jobs cannot be resolved or cancelled through quick-game APIs. Independent scheduled predictions do not block a quick round.

All pending predictions remain visible even when older than the latest 100 completed history records. Earnings, losses and ties derive from persistent results, including earlier records, without rewriting old ledger entries. Admin grants stay separate from net gameplay rankings. Screenshots use synthetic accounts funded by an explicit, audited test-admin grant in disposable databases; the application does not grant those extra fixture points to ordinary users.

## F. Administration

`/admin/arena` adds all seven definitions, real rounds/payouts by game type, database-derived resolved/waiting totals, market specs/evidence, verification attempts and sanitized recent game errors. The verified Google owner binding remains authoritative. A required reason and confirmation precede participation pauses; each pause has an immutable application audit event and idempotent operation key. Terms and outcomes are not editable through this interface. Existing user search, grants and credit audit remain intact.

## G. Testing

Actual final execution results are recorded below. Fixture-based provider tests are explicitly separate from the live verification above.

| Command/check                        | Result                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                           | 68 passed; 33 opt-in skips                                                                                                                                      |
| `npm run test:mongo`                 | 29 passed (existing account/outage tests plus 16 expansion tests); zero failures                                                                                |
| Live read-only Zcash tests           | 3 passed                                                                                                                                                        |
| `npm run typecheck` / `npm run lint` | Passed                                                                                                                                                          |
| `npm run build`                      | Passed                                                                                                                                                          |
| `npm run test:browser`               | Passed: create, two-party signed matching, account gate, eight routes at three widths                                                                           |
| `npm run test:product-browser`       | Passed: 45 responsive checks and existing account/admin grant flow                                                                                              |
| `npm run test:arena-browser`         | 45 responsive captures, every game at 1440/1024/390px, seven UI game flows, genuine-price pending prediction, verified source-evidence screen; zero page errors |
| `npm run test:crypto-live`           | Actual future BTC close verified after connection recreation; saved evidence and exactly one settlement                                                         |

Offline skips are 28 Atlas-dependent tests, three live Zcash tests and two PostgreSQL tests. Atlas and Zcash were run explicitly above; PostgreSQL was not reverified. Existing Rust modules were not changed or rebuilt.

Initial failed checks were fixed: a race-sensitive assertion expected only one of two valid rejection messages; a legacy `experience-number` class placed the new number-game page behind its parent; a native-dialog focus target disappeared after entry. Later browser review corrected focus and capture position. No unresolved failure is reported as passing.

## H. External dependencies

No package dependency or provider API key was added. Existing Google and Atlas credentials remain in the ignored root `.env`; public Coinbase HTTPS access is required. Atlas replica-set transactions remain mandatory. Chart requests are cached and bounded. There is no fake-data or in-memory account fallback when services fail.

## I. Known limitations

This is a virtual practice platform, not a wagering deployment or independently audited randomness system. Coinbase is one trusted HTTPS provider and may delay, omit or revise data. A completed candle plus ten-second delay is not a decentralized oracle or guarantee against later provider revisions. A final stored outcome is not silently revised. The API process must run for scheduled work; restart recovery comes from MongoDB. Multi-process deployments should coordinate the shared provider-IP rate budget. History/ledger views remain bounded to the latest 100 completed entries; all pending entries are retained in the view. Market discovery/admin lists retain the most recent 100 market records. Game preparation expiry is 15 minutes.

Wallet create/import/connect, advanced live 60-second charts, mainnet wagering, on-chain escrow and FROST payouts remain future work. No Zcash wallet, Rust, PCZT, signing-share or historical chain-evidence implementation was modified.

## J. Local testing guide

```powershell
Set-Location D:\ZYRO
npm ci
npm run dev
# In a second terminal:
npm test
npm run test:mongo
npm run test:arena-browser
npm run test:crypto-live
```

Use the existing `.env`; do not overwrite it. `test:crypto-live` intentionally waits roughly two to three minutes through an upcoming real candle and cleans up its uniquely named test database. Browser scripts use isolated Atlas databases and a separate 3100/4100 preview; run those browser scripts sequentially.

- Home: `http://127.0.0.1:3000/arena`
- Quick discovery: `/arena/games`
- Games: `/arena/games/quick-draw`, `/coin-flip`, `/dice-duel`, `/red-black`, `/triple-flip` (each latter slug under `/arena/games/`).
- Bots: `/arena/bot`; game details `/arena/games/rock-paper-scissors` and `/arena/games/lucky-number`.
- Crypto: `/arena/crypto`; open any currently published card for its actual detail URL.
- Empty topics: `/arena/games?category=Politics`, `Sports`, `Games`, `Technology`, or `Economics`.
- History/rankings: `/arena/history`, `/arena/leaderboard`.
- Operations: `/admin/arena`, restricted to the existing verified owner identity.

## K. Git and security

Work began with a clean Git tree. No commit or push was performed. The final status/file inventory is recorded separately with this report. New collections/indexes extend the existing `zyro` model; the migration replaces the one-global-pending index with a partial quick-game index and does not delete accounts or records. Existing transaction evidence and Rust files remain unchanged. Credentials were neither printed nor copied into source. Publication and client-secret scan results are recorded at final verification; heuristic scanning is not a universal secret-detection guarantee.

Changed files and final Git status: [round5-git-status.txt](round5-git-status.txt). Production dependency audit: zero vulnerabilities. Exact-value scanning of the production client assets found no configured Google client secret, MongoDB URI or session secret. The publication scanner reported zero findings. New source areas are game definitions/randomness, MongoDB game/market services, the worker and provider adapter, discovery/game/crypto/admin UI, routes, and isolated tests/QA scripts. No dependency packages were added and no credentials were copied into frontend files.

Final scanner counts: **177 publication files**, **27 production client assets**, **zero findings / secret-value matches**. The final majority-durability Atlas regression also passed all **29 tests**. The built frontend and API were left running on ports 3000 and 4000.
