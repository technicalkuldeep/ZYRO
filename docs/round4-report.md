# Round 4 — implementation and verification

## A. Visual redesign

Obsidian surfaces, jade actions, restrained mint, fine borders, editorial serif accents and system UI typography. Public storytelling includes an interactive, explicitly illustrative quick-draw card, public database-backed challenge previews, three distinct experiences, game accounting, privacy research, FAQ and footer. Authenticated routes provide desktop navigation and a compact mobile navigation strip. Native dialogs provide focus trapping and Escape handling. Motion uses opacity/transform and respects reduced motion. Initials are the avatar fallback; Google avatar URLs are retained but not fetched by the current UI.

Routes: `/`, `/signin`, `/choose`, `/arena`, `/arena/games`, `/arena/games/quick-draw`, `/arena/history`, `/arena/leaderboard`, `/arena/profile`, `/admin`, `/admin/users`, `/admin/users/[id]`, `/admin/audit`, `/privacy`. Existing market, create, wallet, dashboard and about routes remain available.

## B. Authentication

The first-party Next proxy forwards `/api` to Express. `/api/auth/google` generates random state and nonce, a PKCE S256 challenge, a ten-minute MongoDB OAuth attempt and an HttpOnly SameSite=Lax browser-binding cookie. Callback requires matching browser state and atomically consumes the unexpired attempt. Google's library exchanges the code with the verifier and validates the ID token signature, issuer, audience and expiration; the application additionally checks nonce. The immutable `sub` is the unique identity key.

Only required profile data is retained. Google access/refresh tokens are not stored. Successful login rotates the opaque session token; only its SHA-256 hash is stored in MongoDB, expiring in seven days. Cookies are Secure in production. Logout deletes the session; expiration is checked on every lookup independently of TTL cleanup. First login redirects to `/choose`; returning login uses a restricted same-site destination. Server-rendered account/admin layouts independently check the backend session, while every privileged API checks authorization again. No browser role, email field, or spoofed identity header is trusted.

Automated OAuth callback tests inject a verified identity fixture into a router created only by the test. Production does not inject a verifier. **Interactive Google consent and a real owner login are not claimed by automated testing.**

## C. MongoDB

Actual Atlas connectivity and transactional support were confirmed against the configured `zyro` database. Collections: `users`, `sessions`, `arena_accounts`, `arena_ledger`, `arena_games`, `arena_predictions`, `arena_results`, `admin_audit_logs`, `admin_identity`.

Indexes include unique Google sub, email/name/activity/registration lookup, session TTL, net earnings/wins ranking, per-user history, unique prediction operation, a partial unique pending-round-per-user constraint, pending resolution lookup, unique ledger operation, ledger history and audit history. Internal IDs are server-generated UUIDs. Account writes use majority-committed MongoDB snapshot transactions and conditional balance updates. Replica-set transaction support is mandatory; no silent fallback exists.

Existing SQLite/PostgreSQL market, observation, funding and guest data remains in its original adapter. No migration was necessary to create the separate account foundation. Do not automatically import legacy guest balances. A future migration should export/validate legacy records, retain stable IDs, back up the source, reconcile counts and evidence hashes, and only switch an adapter after comparison.

## D. Arena

First account creation, the 100-point balance and initial ledger event commit together. Concurrent/repeated logins cannot issue an additional initial grant. Google-linked balances survive session changes and process/connection recreation. Games reuse the existing committed random algorithm and shared rule-based bot choice. Stakes debit available points once and increase committed points. Reveal releases commitment and credits twice the stake for wins; losses credit zero. Cancellation returns the original stake once and cannot settle later. Idempotency keys, unique indexes and transactional state changes prevent duplicate debits/payouts and concurrent overspending.

History and ledger display the latest 100 records each. Rankings use net settled gameplay earnings with at least one completed round, exclude starting/admin grants, and publish aliases rather than Google names/emails. User stats include wins, losses, win rate, current streak and net earnings. Milestones derive from actual completed games. Random practice is clearly separate from disabled real-world event previews.

## E. Administration

Default authorized email: `web3kuldeep@gmail.com`, configurable using server-only `ADMIN_GOOGLE_EMAIL`. The first Google-verified login for that email inserts the singleton `admin_identity/owner` sub binding. Authorization requires both the currently verified configured email and matching bound sub. Another sub cannot overwrite that binding. Browser-supplied roles never grant rights.

Recovery: stop the application, verify the intended owner's Google identity independently, back up the `admin_identity` document and relevant audit records, and have a trusted database operator deliberately replace the singleton binding. Changing the configured email alone does not rebind ownership. There is no public recovery or role-assignment endpoint. Record any manual recovery separately in the operator's change log; never edit existing financial/point ledger entries.

Directory supports literal email/name search, newest/name sorting, 20-row pages and private account details. Positive integer grants require a reason, target UUID and UUID operation key. Default maximum: 10,000; configurable with `ADMIN_GRANT_LIMIT`, capped at 1,000,000. A confirmation dialog precedes submission. A transaction updates balance, ledger and audit together, recording verified actor ID/sub/email, target, amount, reason, actual before/after balances, time, operation ID and result. Repeated identical operations return the prior receipt; mismatched reuse is rejected. Audit events have no update/delete API; database administrators still have underlying database authority.

## F. Verification

See the final execution results appended below. Tests use unique `zyro_test_` databases and remove only their own database after completion. No real Google identities are fabricated in the application database. The Atlas suite covers concurrent initialization, returning identity, session expiry/revocation, persistence across connections, ordinary-user/admin isolation, spoofed cookies/headers, invalid grants, CSRF origin enforcement, duplicate grants, accounting, duplicate settlement, cancellation and concurrent overspending. Provider consent remains an interactive owner check.

Final executions, November 19, 2026 (local time):

| Check                                | Actual result                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `npm test`                           | 54 passed, 17 opt-in skips (12 MongoDB, 3 live Zcash, 2 PostgreSQL)                                                     |
| `npm run test:mongo`                 | 12 Atlas integration tests passed; the subsequently added storage-outage test also passed in the ordinary suite         |
| Opt-in `tests/live-testnet.test.ts`  | 3 passed against actual public testnet                                                                                  |
| `npm run lint` / `npm run typecheck` | Passed                                                                                                                  |
| `npm run build`                      | Passed after the final dialog styling correction                                                                        |
| `npm run test:browser`               | Passed: create, two-party signed matching, account gate, eight routes at three widths                                   |
| `npm run test:product-browser`       | Passed after final correction: 45 route/viewport checks, zero page errors, real isolated-Atlas stake/reveal/grant flows |
| Publication scanner                  | 150 files checked, zero findings at execution time                                                                      |
| Production client assets             | 25 files scanned for exact configured Google client secret, MongoDB URI and session-secret values; zero matches         |
| `npm audit --omit=dev`               | Zero vulnerabilities                                                                                                    |

Initial failed runs were corrected: Atlas test database name exceeded its 38-byte limit; the browser harness initially did not wait for streamed redirects/data; an encoded test label needed a robust selector; generated QA output needed excluding from lint; a PowerShell-added JSON BOM broke the Tailwind build. Final browser review also caught and corrected inherited step layout and an uncentered native dialog. There are no unresolved failures in the checks listed as passed. PostgreSQL was not reverified; interactive Google consent was not completed by automation. Rust tests were not rerun because no Rust implementation changed.

## G. Screenshots

Browser screenshots and machine-readable report are local, ignored artifacts under `artifacts/round4/`. They use clearly named synthetic QA accounts in an isolated Atlas database. Browser automation starts its own API and Next servers at ports 4100/3100; it does not introduce a production authentication bypass. Desktop, tablet and mobile targets are 1440/1024/390px. The existing browser regression continues to cover legacy market creation and two-party signed matching separately.

Verified captures include `landing-{1440,1024,390}.png`, `mobile-menu-390.png`, `choose-*`, `arena-*`, `game-*`, `game-pending-390.png`, `game-result-*`, `history-*`, `leaderboard-*`, `profile-*`, `admin-*`, `admin-users-*`, `admin-user-*`, `admin-audit-*`, and `admin-grant-dialog-{1440,390}.png`. `browser-report.json` records each viewport check. Screenshots were opened and inspected, including the full landing page, mobile gameplay, tablet chooser, admin overview, mobile directory/details, and centered grant confirmation.

## H. Existing Zcash functionality

No Rust source, wallet database, signing share, PCZT fixture, historical transaction evidence, transaction decoder, funding recognition or observation implementation was modified for this round. Existing TypeScript tests cover those interfaces. Live non-destructive verification is reported separately from historical evidence. Threshold market settlement, FROST custody, self-custodial onboarding and mainnet wagering remain unavailable.

## I. Limitations

Interactive provider consent and verified owner identity binding require a real Google login in the owner's browser. No real-money functionality, live-price oracle, scheduled real-world settlement, transferable points or integrated threshold payout/refund is enabled. Application operators can see account choices and metadata. Retention/deletion support is an operator process, not a self-service product feature. History/ledger are bounded to the latest 100 records; the application is a local prototype, not an independently audited production deployment. Public access requires HTTPS, correctly configured OAuth origin/callback, deployment proxy/rate-limit review, abuse controls and operational database access policies.

## J. Local operation

```powershell
Set-Location D:\ZYRO
npm ci
npm run dev
```

Use the existing root `.env`; do not overwrite it. Homepage: `http://127.0.0.1:3000/`; chooser: `http://127.0.0.1:3000/choose`; Arena: `http://127.0.0.1:3000/arena`; rankings: `http://127.0.0.1:3000/arena/leaderboard`; administration: `http://127.0.0.1:3000/admin`.

Checks: `npm test`, `npm run test:mongo`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:browser`, `npm run test:product-browser`, `node scripts/release-scan.mjs`.

## K. Git and security

No commit or push is authorized or performed. `apps/web/next-env.d.ts` was already modified when work began; Next regenerates it during development/build. Its development type references were retained for the final working tree. Credentials stay in the ignored root `.env`; `.env.example` contains safe placeholders. The existing publication scanner remains intact. Its result is a heuristic inventory check, not a guarantee that no possible secret exists.

Changed source groups: `apps/api/src/accounts.ts`, `account-routes.ts`, `app.ts`, `server.ts`; web shell/auth/access/hero/featured/Arena/admin components; landing, chooser, sign-in, privacy, Arena and admin routes; `premium.css`, `proxy.ts`, Next configuration; the shared round cancellation state; npm manifests/lockfile, safe environment example, brand and README, lint/ignore configuration, browser/MongoDB checks and account tests. No files under `services/zcash` or historical evidence were changed. Full final file inventory: [round4-git-status.txt](round4-git-status.txt).
