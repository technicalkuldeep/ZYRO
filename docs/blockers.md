# Remaining blockers

## PostgreSQL and Z3 regtest: approval required

Docker Engine and Compose are absent in both Windows PATH and the existing WSL Ubuntu distribution. PostgreSQL binaries are also absent. WSL2 and Rust are available; the earlier assertion that Rust was unavailable applied only to Windows PATH and has been corrected.

Docker installation/startup changes the WSL system. The user explicitly required approval for those changes; approval was requested with the exact [installation procedure](windows-infrastructure.md). No privileged installer, group modification or Docker daemon startup has been executed without approval.

Therefore PostgreSQL and Z3 regtest are **not verified**. Public testnet was used through maintained wallet tooling and a public lightwallet service to continue independent work.

After installation:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/d/ZYRO && sudo docker compose up -d postgres'
$env:TEST_DATABASE_URL='postgresql://zyro:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/zyro'
npm run test:postgres
```

The command applies the migration, records the actual server version, and runs persistence/API recreation/concurrent participation/credit tests. It exits unsuccessfully without a configured database; skipped tests are not verification. Use a dedicated test database. No database credentials are committed.

Z3 checkout inspected: `e84ce9fd8e864ff0b2a8a62f6ce14392145db0fb`. Use its **regtest** environment explicitly; upstream defaults can start mainnet. Review loopback binding overrides before launching. Do not delete volumes or run Docker prune.

## Integrated threshold escrow

Real DKG and rerandomized threshold signatures are verified in isolation. No threshold-controlled PCZT spend or refund is verified. The exact upstream compatibility gap and remaining signer safeguards are documented in [FROST integration](frost-integration.md).

## Deployment quality

Current local database is SQLite; PostgreSQL remains the intended deployment backend. Developer-custodied wallet recognition is opt-in, testnet-only and forbidden in production. Wallet syncing is an explicit CLI step. Public lightwallet availability and its reported consensus state are external trust dependencies. Mainnet operations are refused.

No real-value deployment, production wallet, independent signer network, dispute oracle, production audit or GitHub push has been performed.
