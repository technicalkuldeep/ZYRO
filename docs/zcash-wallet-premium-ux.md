# ZYRO Wallet premium UX

This change builds on merged Phase 2. `/wallet` retains its existing rewrite to
`/testnet`. The entry page offers exactly **Open ZYRO Wallet** and **Connect Noir
Wallet**. Legacy observer components and APIs remain in source; they are no
longer mounted on the public entry page. Arena and Mainnet are outside scope.

## User flows

- Open ZYRO Wallet: create, import/restore, or unlock an existing vault. Existing
  vaults disable create/import; use a separate browser profile for another
  embedded wallet. No records are deleted or replaced. Switch Wallet locks the
  embedded wallet and returns to the chooser. Noir connection is a separate mode.
- Noir: the explicit entry-card click carries a one-use, same-tab connection
  intent. The connection view requests the existing extension approval flow.
  Visiting its URL without that click does not request approval. Detection,
  install/localhost guidance, rejection and network errors appear only there.
  Noir 1.0.41 is the previously verified version; V2 remains unverified.
- Dashboard: confirmed/available TAZ, nonzero pending TAZ, compact sync status,
  account identity and four actions. Cached balance snapshots are session-only,
  tied to the same address and explicitly marked with freshness information.
  They never authorize spending. Engine balances remain authoritative.
- Receive: a local `qrcode` QR appears only in the modal and is gated against the
  active address. Copy is deliberate. Closing, locking and account changes clear
  the panel; the dashboard contains no QR.
- Get TAZ: address, real faucet configuration and receipts. Human verification
  still happens on official Fauzec when required. Opening its link does not
  silently write to the clipboard. No claim is retried automatically.
- Activity: supplied wallet scan history, direction, amount, status, time and
  expandable full transaction IDs with deliberate copy. Duplicate transaction
  IDs are collapsed. Noir private history remains in Noir. No public explorer
  URL is guessed or address uploaded to generate a QR.
- Send: existing address validation, quote, review, explicit authorization,
  durable submission/reconciliation and Noir approval. In-flight panels cannot
  be dismissed by Escape or backdrop. There is no backdrop-dismiss handler.
- Settings: manual refresh, device security context and engine legal notices.

Wallet-only primitives (`WalletActionButton`, native-dialog `WalletModal`,
`SecretInput`) use existing CSS modules and Lucide icons. Native dialogs provide
focus containment, Escape handling and focus restoration. Reduced-motion styles
are preserved. All password fields start hidden and retain password-manager
autocomplete hints. Recovery paste normalizes whitespace before a password input
can strip line breaks. Backup words are masked until deliberately revealed;
copy requires a separate click. Transient values clear on lock/completion.
There is no new existing-phrase export or change-password feature.

## Genuine restoration and compatibility

The pinned worker already implemented restoration. This UX exposes and completes
that path; it does not introduce new seed derivation or a new storage schema.

1. Whitespace is normalized locally. The existing worker invokes the pinned
   engine's `validate_mnemonic`, which checks BIP-39 vocabulary and checksum.
   Tests validate English 12/15/18/21/24-word public all-zero entropy vectors
   and reject checksum corruption. Creation continues to generate 24 words.
2. `WebWallet("test", existingEndpoint, ...)` and
   `create_account("ZYRO Testnet", phrase, 0, birthday)` restore the account.
   This is testnet ZIP-32 account 0, empty BIP-39 passphrase, with the pinned
   engine's receiver/address configuration. Other wallets, account indices,
   seed schemes, passphrases or address diversifiers may differ. A generic
   Noir/Zcash mnemonic is not promised to produce the same account/address.
3. Default recovery birthday is **280000**, the worker's existing minimum.
   Users can specify their known birthday or an earlier supported block. A
   later height can omit historic payments. Full recovery can be slow; the
   engine persists encrypted scan checkpoints. The height must be an integer
   from 280000 through the actual remote testnet tip.
4. The existing PBKDF2-SHA256 (600000 iterations), non-extractable AES-GCM key,
   authenticated v1 envelope, database name, object store, storage key, worker
   ownership lease and encrypted database serialization are unchanged.
   The worker rejects create/import with `WALLET_EXISTS` before writing.
5. Onboarding shows the derived account, tells users to compare their receiving
   address, and begins actual blockchain synchronization. Lock/reopen uses the
   saved encrypted database and verifies its receiving identity as before.
   No recovery phrase or password is sent to Noir or a server.

The real-browser recovery test creates an ephemeral wallet, restores its phrase
in a second context at the same birthday, synchronizes both through the actual
engine/network, compares addresses, then locks/reloads/unlocks the restored
vault. It checks encrypted persistence and rejects an overwrite attempt. This
proves matching identity and scan completion for an unfunded test wallet; it
does not prove discovery of historic funded notes or access to a user's browser
profile. Existing real wallet data is never opened or changed by these tests.

## Preservation and verification

The worker, Noir adapter/hook, encrypted storage module, transaction signing,
remote APIs, history normalization and pinned vendor engine are unchanged.
Entry links use full document navigation so the worker receives the required
COOP/COEP isolation; this was verified in the actual browser.

Commands (from repository root, with the app running on port 3202):

```text
npm test -- --reporter=json --outputFile=artifacts/zcash-wallet/premium-unit.json
npm run typecheck
npm run lint
npm run build
npx tsx scripts/zcash-wallet-guard.ts
npx tsx --env-file-if-exists=.env scripts/zcash-wallet-arena-regression.ts
npx tsx scripts/zcash-wallet-premium-browser.ts
npx tsx scripts/zcash-wallet-premium-recovery.ts
npx tsx scripts/zcash-wallet-integration.ts
npx tsx scripts/zcash-wallet-browser.ts
```

`premium-browser` uses a clearly labeled isolated fixture worker for deterministic
UI tests. `premium-recovery` uses the real engine, encrypted storage and network;
it never requests a faucet payment or sends funds. Noir integration uses a
mocked 1.0.41 provider and does not verify a real installed extension.
The pending 0.2 → confirmed 0.2 test is a deterministic worker fixture; the
previous external-funded transfer remains historical evidence, not a new test.

Results and screenshots are written under `artifacts/zcash-wallet/`. See
`zcash-wallet-premium-verification.md` for the executed results and limitations.

Engine licensing/provenance remains available from the wallet footer and
Settings. Existing BUSL-1.1 restrictions remain: non-production development use;
production requires the applicable license before the 2029 change date. No
deployment, licensing clearance or new audit is claimed.
