# ZYRO

**Predict Freely. Settle Privately.**

Open-source prediction challenges exploring conditional shielded payments on Zcash. MIT licensed. Blockchain operations are restricted to testnet/regtest.

Transparent financial networks expose payment relationships. ZYRO combines off-chain fixed-stake YES/NO agreements with a planned shielded settlement layer, and introduces newcomers through a genuinely free practice Arena.

## Current product

- Eight responsive routes: introduction, market explorer, challenge details, create, Arena, wallet onboarding, personal history, and project information.
- Persistent challenge creation, search/category/status filters, two-party matching, deadline cancellation, canonical agreements and verifiable Ed25519 acceptances.
- Outcome recording through deadline-bound signed attestations under an explicitly configured trusted oracle public key. No oracle is configured by default; this authenticates a report, not its objective truth.
- Arena: persistent guest sessions, 1,000 starting credits, atomic stakes/payouts, committed random exercises, rule-based bot, history, statistics and local rankings.
- Independently tested settlement-policy validator for exact recipient, amount, fee, output count, agreement and resolution evidence.
- Live testnet/regtest RPC and public lightwalletd connectivity, maintained Rust transaction decoding, compact-block inclusion checks, confirmation monitoring, and opt-in developer-custodied note recognition.

**Real public-testnet integration is demonstrated:** a locally constructed shielded transfer is confirmed, and two challenge-specific shielded payments were recognized with exact memos/amounts. The wallet and both demonstration participants are developer-controlled. Real 2-of-3 rerandomized FROST is verified in an isolated Rust lab, **not integrated escrow**. No threshold payout, refund, live oracle or market settlement has been executed. Credits cannot be bought, transferred or redeemed.

Transfer: [`0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c`](https://testnet.zcashexplorer.app/transactions/0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c), mined at **4,633,072**, observed with **3 confirmations**. [Reproduce the testnet demo](docs/testnet-demo.md), [inspect FROST scope](docs/frost-integration.md), and [review blockers](docs/blockers.md).

## Run locally

Requirements: Node **22.19+** and npm for the core product; WSL/Rust for the real transaction decoder and FROST lab. Docker is needed for PostgreSQL and Z3 regtest, but SQLite and public testnet allow independent development.

```sh
npm ci
cp .env.example .env
npm run dev
```

On PowerShell use `Copy-Item .env.example .env`. Open **http://127.0.0.1:3000** (use this host consistently; origin validation rejects other hosts). API: http://127.0.0.1:4000/api/health. SQLite is used when `DATABASE_URL` is empty; persistent data lives at `apps/api/data/zyro.sqlite` when started through npm workspaces. Do not commit this file. Node currently labels its SQLite API experimental.

The Next server proxies `/api` to the Express server, so cookies are first-party and no permissive CORS is needed. API process reads the root `.env`. Frontend proxy defaults to loopback; override `API_URL` in the web process environment if needed.

### PostgreSQL

```sh
docker compose up -d postgres
```

Set a local `POSTGRES_PASSWORD` in ignored root `.env`, then set `DATABASE_URL=postgresql://zyro:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/zyro` and restart API. No database password is provided by the repository. Schema creation is idempotent at startup. Drizzle defines and reads the PostgreSQL schema; parameterized PostgreSQL queries handle ledger transactions. Initial SQL is in `apps/api/migrations`. PostgreSQL is the deployment target; SQLite is a local fallback, not synchronized to PostgreSQL. PostgreSQL integration has not yet been run locally; Docker installation needs approval.

### Demonstrate the product

1. Visit `/arena`, lock a prediction, wait five seconds, reveal it. Inspect the balance and commitment reveal. Refresh to verify persistence.
2. Create a challenge with explicit future deadlines, an HTTPS source and clear rules.
3. Review its canonical terms and sign YES acceptance. Use a separate browser profile for NO. Both signatures are verified server-side and the challenge becomes MATCHED. No cryptocurrency moves.
4. Inspect `/dashboard`. Matching is not proof of funding, and no resolved market or settlement is fabricated.
5. Visit `/wallet` to see the integration boundary. With a local node configured, observe an actual testnet txid. Observations are private to the guest session.

### Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser
```

Browser checks require Microsoft Edge locally (`channel: msedge`) and a running app. Screenshots go to ignored `artifacts/`. `npm run test:postgres` requires `TEST_DATABASE_URL` and fails without it; ordinary offline runs explicitly skip external infrastructure tests. CI provisions PostgreSQL, but hosted execution is not claimed. See [implementation status](docs/implementation-status.md) for actual verification results, not just available commands.

## Architecture and integration

![ZYRO market explorer](docs/screenshots/markets-desktop.png)

[Mobile explorer](docs/screenshots/markets-mobile.png) · [Arena](docs/screenshots/arena-desktop.png)

Next.js App Router / React / TypeScript / Tailwind 4 / Radix Slot and shadcn-style CVA buttons / Lucide / React Hook Form and Zod; Express 5 / PostgreSQL / Drizzle; npm workspaces; Vitest / Playwright; GitHub Actions.

- [Architecture](docs/architecture.md)
- [Privacy model](docs/privacy-model.md)
- [Zcash research and setup](docs/zcash-integration.md)
- [Implementation status](docs/implementation-status.md)
- [Roadmap and pre-funding work](docs/development-roadmap.md)

`services/zcash` contains a real RedPallas DKG/rerandomized-FROST lab and a read-only librustzcash transaction parser. Rust is available in WSL Ubuntu. PostgreSQL and Z3 regtest still need Docker installation approval. FROST and PCZT must be integrated against actual transaction sighashes before threshold escrow is exposed.

## Security and privacy limitations

Guest cookies are bearer credentials (HttpOnly, SameSite Lax; Secure in production). Public guest IDs are SHA-256 derivatives, not cookie tokens. Acceptance keys are ephemeral browser keys, **not wallet keys or durable account credentials**. This proves a recorded acceptance signature, not a human identity, wallet ownership, or peer identity. Challenge participants are not bound to each other's identities in v1; re-consent to a final participant/funding manifest is required before any escrow integration.

App operators see prediction choices and request metadata. Shielded payments do not hide application data. Node observation alone does not prove shielded recipient or amount; the opt-in demo requires wallet-recognized note evidence. Threshold signers can collude or go offline; refunds depend on their availability. The settlement validator presently checks a normalized proposal with trusted context, not an actual PCZT or independently authenticated oracle evidence. Transaction threshold signing remains disabled; the normal wallet transfer and isolated FROST signatures are real and separately labeled.

This is a testnet prototype, not an audited deployment. Guest farming makes rankings unsuitable for prizes. The API never receives wallet seeds or spending keys. Optional demo recipient addresses and transfers are testnet-only, developer-custodied and explicitly labeled; no automatic payout/refund is enabled. No analytics, mainnet operations, credit purchases or redemptions are implemented. Keep API and RPC bound to loopback until deployment authentication, retention, abuse controls and operator access are hardened.

## License

[MIT](LICENSE). Contributions welcome; never commit wallet material or `.env` files.
