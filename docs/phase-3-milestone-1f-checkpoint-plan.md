# Phase 3 Milestone 1F: review checkpoint plan

This is a review plan only. Nothing has been staged, committed, pushed, merged, or deployed. The existing frontend work stays separate from the custody and verifier work.

## Preserve first

The Milestone 1E Regtest backup is at `/home/kuldeep/.local/state/zyro-backups/phase1e-20261127T125100Z`. It contains a stopped-service consistent copy of the Zebra state, payer/receiver/custody wallet databases, MongoDB files and ledger snapshot, signed refund bytes, evidence, configuration records, and a 384-file SHA-256 manifest. The backup directory and its contents are owner-only. Verify hashes against `BACKUP-MANIFEST.json` before any recovery. Do not place wallet databases or RPC credentials on the shared Windows volume.

## Proposed review groups (do not stage automatically)

1. **TAZ accounting and custody:** `apps/api/src/taz-markets/**`, `tests/taz-*.test.ts`, `tests/taz-fixtures.ts`, and `docs/taz-custody-milestone-*.md`. Review state transitions, network tagging, MongoDB uniqueness/idempotency, reorg behavior, and the live observer evidence chain.
2. **Private operator authorization:** `apps/api/src/taz-markets/live/operator-auth.ts`, `regtest-operator.ts`, `regtest-signer.ts`, `regtest-ledger.ts`, and `tests/taz-operator-auth.test.ts`. The Ed25519 approval is detached and binds the exact canonical authorization digest. Deployment still needs a dedicated OS identity for the operator CLI and its owner-only config/cookies; running the API and signer under one UID would weaken that isolation.
3. **Rust transaction verification:** `services/zcash/transaction-inspect/Cargo.toml`, `Cargo.lock`, and `src/bin/zyro-regtest-refund-check.rs`. Review the ZIP 374 verifier dependencies and tests separately from TypeScript accounting.
4. **Existing product UI (keep separate):** `apps/web/app/page.tsx`, `apps/web/app/landing.module.css`, `apps/web/components/shell.tsx`, and `apps/web/components/landing-controls.tsx`. These are pre-existing frontend changes, not part of custody authorization.
5. **Dependency lockfile (separate decision):** `package-lock.json`. Review independently; do not combine it with either custody or frontend checkpoint without reviewing its dependency changes.

## Review commands

Start with `git -c core.autocrlf=true status --short` and `git -c core.autocrlf=true diff --stat`. Review each group with `git -c core.autocrlf=true diff -- <paths>` plus direct inspection of untracked files. Only after a human review should an operator stage explicitly named paths. The working tree is shared across Windows and Linux, so do not normalize line endings or use reset/clean/restore as a checkpoint method.

