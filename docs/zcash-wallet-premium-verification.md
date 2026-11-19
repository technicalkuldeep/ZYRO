# Premium wallet verification

Branch: `feat/zyro-wallet-premium-ux`, created from updated `main` at `b7e75c1`.
The original tree was clean. No commit, push, merge into main, or deployment was
performed. The initial local main was fast-forwarded to the already merged Phase
2 main before this branch was created.

## Executed results

| Verification | Passed | Failed | Skipped / unverified |
| --- | ---: | ---: | --- |
| Full Vitest suite | 176 | 0 | 43 existing environment-gated tests skipped |
| Deterministic browser UX cases | 16 | 0 | 0 |
| Real recovery browser assertions | 8 | 0 | Funded historical note recovery unverified |
| Noir integration groups | 3 | 0 | Real installed extension unverified |
| Existing wallet browser script, non-spending mode | 1 run | 0 | Funded opt-in branch not run |
| Existing Arena browser regression | 1 run | 0 | 0 |
| Lint / typecheck / production build | 3 commands | 0 | 0 |
| Arena SHA-256 protected-file guard | 118 files | 0 changed | 0 |

The JSON evidence and screenshots live in `artifacts/zcash-wallet/`:
`premium-unit.json`, `premium-browser.json`, `premium-recovery.json`,
`integration.json`, `browser-evidence.json`, `arena-guard.json`,
`arena-regression.json`, and
`premium-engine-integrity.json`. The source scripts are reproducible; artifacts
are intentionally ignored by Git. No recovery material is included here.

The browser UX checks cover the two entry choices, absence of diagnostics,
onboarding, password/phrase masking, rejected invalid import, masked creation
backup, hidden default panels, active-address QR, Escape/focus return, human
verification gating, real supplied activity entries, lack of scan restarts from
panels, send form without submission, cached balance freshness, Tab containment,
320/390/768/1440px layout and lock/vault protection. The fixture worker exists
only in Playwright routing, never in production code.

Real recovery assertions: entry document isolation, creation and live sync,
restored receiving identity, completed recovery scan, re-lock/reload/unlock
identity, absence of plaintext persistence, rejection of existing-vault import,
and absence of phrase/password strings in observed console/HTTP traffic. These
use isolated temporary browser contexts, the actual pinned engine and actual
testnet service. They do not access the user's browser profile or vault.

Noir tests use a mocked 1.0.41 provider on localhost and 127.0.0.1. They exercise
approval/rejection, silent reconnect, lock, network mismatch and disconnect.
They are adapter/UI regression evidence, not installed-extension certification.

The pending 0.2 TAZ → confirmed 0.2 TAZ assertion is a deterministic worker
balance fixture. No new blockchain transfer, faucet claim or funded send was
performed. The user's previous successful external receipt remains preserved as
historical evidence; no wallet records were reset, deleted or migrated.

Earlier attempts exposed test setup issues: worker fixture responses needed
COEP headers; entry links needed document navigation for actual WASM isolation;
the Noir test raced a legitimate silent reconnect; and the legacy multi-profile
script waited on a background tab whose scans were intentionally deferred.
The final runs pass after fixing navigation and the test setup.
The explicit entry-card check also found React Strict Mode replay consuming
the connection intent twice; the intent is now consumed once and the approval
flow passes on both hosts, including closure of Receive when Noir locks.
The first lint attempt with an ad hoc `.next-premium` output directory also scanned generated
code; that temporary directory was removed and final lint passed with the
existing ignored QA output directory. These intermediate failures are not
counted as final passes.

## Protection and limits

The unchanged baseline is
`docs/evidence/zcash-wallet-phase2-baseline.json`. The existing
`scripts/zcash-wallet-guard.ts` computes SHA-256 for all **118** entries and
reports **zero changed files**. The existing Arena browser regression passed
live-feed, OAuth redirect, session/recovery and login-protection checks. No
Arena, admin, authentication, MongoDB, settlement, market or Coinbase logic was
edited. Mainnet was not modified. No wallet engine, worker, storage schema,
Noir adapter/hook, network API or signing implementation was changed.

All eight vendor manifest artifacts remain unchanged relative to Git. The
66,472,202-byte WASM matches its exact pinned SHA-256
`0b83c3963486310a881a1ebdd24d241c0e595496b60aa1b154c853ad47f71a8e`.
The raw-byte manifest comparison passes for WASM and workerHelpers.js. Six text
files have inherited Windows CRLF conversion: raw hashes differ, while their
LF-normalized hashes match the upstream manifest. No vendor bytes were rewritten
to conceal that distinction; runtime binary verification remains untouched.

Four real-world cases remain unverified in this session: the user's actual
existing browser profile after upgrade, historical funded-note recovery, a real
installed Noir extension, and a newly funded send/receive. Existing v1 vault
format compatibility is supported by unchanged code and isolated persistence
checks, rather than a claim that the user's vault was opened.

Single embedded-vault storage remains intentional: another embedded wallet uses
a separate browser profile. There is no in-place vault replacement/migration,
existing-phrase export, new password-change workflow, or guessed explorer link.
The engine's existing BUSL production licensing restriction still applies; see
the wallet's retained provenance/license links before any production deployment.

## Changed-file inventory

- `apps/web/app/testnet/page.tsx`: entry-only composition.
- `apps/web/components/zcash-wallet/testnet-entry.tsx`: two branded entry cards,
  full-document wallet navigation and explicit Noir connection intent.
- `apps/web/components/zcash-wallet/testnet-wallet.tsx`: action-driven dashboard,
  onboarding/restore, safe secret visibility, session-only freshness cache and
  account/panel cleanup, retaining existing wallet operations.
- `apps/web/components/zcash-wallet/wallet-primitives.tsx` (new): action button,
  masked input and accessible guarded native dialog.
- `apps/web/components/zcash-wallet/wallet-activity.tsx` (new): transaction rows,
  deduplication, direction and full-ID copy/details.
- `apps/web/components/zcash-wallet/wallet.module.css`: wallet-local brand,
  layout, dialogs, responsive styling, focus and reduced motion.
- `apps/web/components/zcash-wallet/noir-status.tsx`: connection-view copy and
  explicit V2 verification limitation.
- `tests/zcash-wallet/address-engine.test.ts`: five real mnemonic/checksum vectors.
- `tests/zcash-wallet/lifecycle.test.ts`: deterministic 0.2 TAZ confirmation fixture.
- `scripts/zcash-wallet-premium-browser.ts` (new): 16 isolated UI cases.
- `scripts/zcash-wallet-premium-recovery.ts` (new): actual engine/network recovery.
- `scripts/zcash-wallet-browser.ts`, `scripts/zcash-wallet-integration.ts`: existing
  regression scripts updated for the new user flows and foreground requirements.
- `docs/zcash-wallet-premium-ux.md`, this report (new), and a link added to
  `docs/zcash-wallet-phase2.md`.

No dependencies were added.
