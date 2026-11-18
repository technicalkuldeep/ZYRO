# Bounty release and recording checklist

Target submission: November 27, 2026. This checklist prepares a truthful release;
it does not assert bounty acceptance or public repository visibility.

## Submission status

| Requirement                                 | Status                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Implemented application                     | Markets, acceptances, Arena, persistence and testnet observation implemented                                   |
| License                                     | Root MIT license present; copied upstream fixture retains MIT attribution                                      |
| README/setup/env/database/tests/screenshots | Present in repository                                                                                          |
| Real Zcash activity                         | Ordinary shielded transfer and two funding notes, documented with custody boundaries                           |
| FROST                                       | Real DKG and all 2-of-3 signatures in isolated lab; no threshold market spend                                  |
| Public GitHub                               | Origin is https://github.com/technicalkuldeep/ZYRO; visibility/public access must be checked before submission |
| PostgreSQL/regtest                          | Not locally verified; infrastructure unavailable                                                               |
| Video                                       | Walkthrough below; recording not yet produced                                                                  |
| Push                                        | Requires owner's review; no automatic push                                                                     |

## Reproducible 3 minute recording

Start `npm run dev` after [README setup](../README.md). Use
`http://127.0.0.1:3000` consistently. Use a second browser profile for participant B.
The two browser participants demonstrate acceptance, not real independent wallet
ownership. Do not open developer tools, `.env`, wallet files or shell history.

1. **0:00–0:25 — `/markets`**: explain fixed-stake YES/NO challenges and show
   search/filter behavior. Identify example markets as examples.
2. **0:25–1:00 — `/create`**: enter a specific question, explicit HTTPS source,
   deterministic rules and future deadlines. Create the challenge and sign YES.
3. **1:00–1:20 — same URL in profile B**: review accepted terms and sign NO.
   Show MATCHED and explain that acceptance alone has not transferred funds.
4. **1:20–1:40 — `/arena`**: lock a free-credit prediction, reveal after five
   seconds, show commitment/reveal and updated balance. Credits have no cash value.
5. **1:40–2:10 — `/wallet`**: check txid
   `0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c`.
   Show actual check time, mined height and confirmations. If infrastructure fails,
   show the saved receipt with its date and identify it as historical evidence.
6. **2:10–2:30 — `docs/evidence/market-funding.json`**: show the two actual 0.01
   TAZ wallet-recognized notes and duplicate checks. Say that both wallets were
   developer-operated and no market payout has happened. Shielded amounts are
   wallet evidence, not established by an explorer txid alone.
7. **2:30–2:50 — terminal**: run the real FROST lab test. Explain DKG and 2-of-3
   rerandomized signatures, clearly labeled standalone rather than a market spend.
8. **2:50–3:15 — terminal**: run
   `node node_modules/vitest/vitest.mjs run tests/engine.test.ts` and the PCZT
   inspector tests from [checkpoint](phase3-checkpoint.md). Explain invalid
   normalized payouts are rejected and the redacted PCZT diagnostic cannot grant
   signing authorization. End with the precise remaining integration work.

Existing `npm run test:browser` captures local screenshots and checks the UI with
Edge; it does not produce a video. The flow above can be recorded with the OS
screen recorder. No recording was fabricated or claimed.

## Before owner approves a push

```sh
git status --short
git diff --check
node scripts/release-scan.mjs
npm test
npm run lint
npm run typecheck
npm run build
cargo test --locked --manifest-path services/zcash/Cargo.toml
cargo test --locked --manifest-path services/zcash/transaction-inspect/Cargo.toml
```

Review both tracked and untracked files. `.env.*` (except `.env.example`), local
wallets, databases, private-key files, encrypted wallet material and PCZTs are
ignored; only the attributed public upstream redacted fixture is allowed.
`release-scan.mjs` checks the publication inventory without printing secret values.
It is a heuristic, not proof that arbitrary mnemonics/shares or screenshots are
safe. Review screenshots visually and the exact staged diff. Never stage `.local`
or use `git add -f` to bypass these exclusions.

Only stage intended source/docs after review. `apps/web/next-env.d.ts` was already
modified at the start of this phase; build tools regenerate it. Review generated
changes separately from intended source changes.
Do not rewrite history, delete wallet data, or push without owner approval.
