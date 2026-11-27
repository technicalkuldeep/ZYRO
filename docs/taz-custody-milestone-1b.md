# Milestone 1B Zallet and Zebra custody observation

The ZYRO custody observer calls the pinned wallet and node RPCs directly. It reports canonical, wallet-owned shielded outputs and can match a local intent without a transaction hint. Its findings are diagnostic. Market qualification, proposal construction, signing and broadcast remain disabled. The main API has no custody RPC credentials and does not mount this observer.

## Release selection and environment

| Component            | Evaluation pin | Linux x86-64 archive SHA-256                                     |
| -------------------- | -------------- | ---------------------------------------------------------------- |
| Zallet Zebra backend | 0.1.0-beta.4   | 1a8f8b20358ea3aed644a5b6581f1a346016a73f85e9bbf1bbde9c164d94f509 |
| Zebra                | 7.1.0          | 4b42a23e67fcce27f923882d369dad47f694aa608858f1cbbad70e4298e2ecae |

Both releases advertise support for NU7 Testnet at height 4,465,026, branch 77190ad9. Zallet documents compatibility with Zebra 7.0.0 or later and opens the local Zebra state as a RocksDB secondary. Zebra 7.1.0 retained the v29 state format but upgraded its zebra-state crate from 16 to 17. The pinned Zallet source uses zebra-state 16. Test the shared state on the target platform before relying on that match. The published Zallet image has index digest sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506. Zebra 7.1.0 is an evaluation pin with an upstream end-of-support estimate around December 10, 2026. Reassess the pair before a public Testnet acceptance. [Zallet release](https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.4) · [Zallet verification playbook](https://zcash.github.io/zallet/slsa/slsa.html) · [Zebra release](https://github.com/ZcashFoundation/zebra/releases/tag/v7.1.0)

Both downloaded Linux archives matched their published SHA-256 values. GPG verified Zallet's detached signature against the ZODL key obtained from the official apt distribution site. The primary fingerprint was 033834DD49DECF9DBB9934BC6C93CA8E58E26AB1. Cosign verified Zebra's checksum manifest against the GitHub Actions release workflow identity for refs/tags/v7.1.0. GitHub CLI verified one SLSA provenance attestation for Zallet against the release/v0.1.0-beta.4 workflow identity. These checks cover the Linux x86-64 archives. Image signatures and target-host compatibility remain separate checks. Zallet and Zebra publish permissive upstream licenses. Review the exact artifact SBOM, linked dependencies, and notices before operating a pilot. ZYRO's BUSL-licensed Noir engine is outside the custody path. [ZODL release key](https://apt.z.cash/zcash.asc) · [Zallet licenses](https://github.com/zcash/zallet) · [Zebra licenses](https://github.com/ZcashFoundation/zebra)

The local Windows environment reported Git 2.56.1, Node 26.13.1, npm 11.20.0, approximately 28.3 GiB free on the workspace drive and 15.8 GiB physical RAM. Rust, Docker, Zallet and Zebra were absent from PATH, and WSL reported it was not installed. The official archives contain Linux binaries. Running them requires an approved Linux host or an approved Windows runtime installation. No Windows system components were installed and no blockchain state was downloaded.

## Observation and intent association

The CLI accepts only regtest and testnet-readonly. Cookie-authenticated JSON-RPC is restricted to explicit IPv4 loopback endpoints and a fixed read-only method list. Run the CLI under a private observer service identity and keep its cookie outside the repository. A Zallet cookie grants authority over that RPC server. For Testnet, use a separate viewing-only wallet or an independently enforced method proxy with credentials unavailable to the application. Confirm the scanner's required viewing-key import and RPC combination on Regtest before provisioning it on Testnet.

The scan verifies the RPC versions, expected genesis, NU7 activation, consensus branch on the tip and next block, and wallet scan progress. It requires both wallet tip hashes to agree with Zebra, bounds public Testnet tip age, and rejects a changing tip during a scan. A caller-supplied previous tip allows shallow or deep replacement detection by canonical block hash. Each scan rebuilds the bounded account history and does not need prior transaction hints.

For each wallet-owned output, the observer joins account-scoped history, wallet-decrypted transaction detail, and the wallet's decoded transaction by transaction ID, pool, and index. It reconciles the height, confirmation depth and block hash with Zebra's canonical transaction list, and records the Sapling, Orchard or Ironwood commitment. An exact external receiving address, exact amount, minimum depth, and unique memo match are required to report an association. Intent memos are parsed from decrypted 512-byte memo data with zero-padding checks. Use the exact shielded receiver encoding that Zallet returns for that pool. Account membership or a multi-receiver address alone is insufficient. The adapter never uses z_listunspent address filtering for attribution. [Pinned Zallet RPC differences](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/book/src/zcashd/json_rpc.md) · [Pinned transaction-view implementation](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/zallet-core/src/components/json_rpc/methods/view_transaction.rs)

z_listunspent reports inventory and watch-only status. Presence is recorded as an availability observation. An absent note may be spent, pending-spent or locked. Neither state proves spendability for a specific obligation. The scanner fails closed above 128 history entries, on unsupported data, or when providers disagree. It has no database credentials. Its output does not qualify a position or write reservations to the existing TAZ collections. A future ledger bridge must authenticate live observations and enforce network, custody account, cutoff and complete reorg evidence. This keeps the existing fixture data and live diagnostics isolated.

## Regtest setup and observation

These Linux commands and settings are a provisioning recipe. Runtime acceptance is pending. Download the official versioned Linux archives, verify the signatures and hashes above, then extract them into a private directory. Keep the signer, payer, observation wallet and Zebra paths separate. Use the Regtest genesis, a persistent Zebra state directory, and localhost RPC. [Pinned Zebra Regtest guide](https://github.com/ZcashFoundation/zebra/blob/v7.1.0/book/src/user/regtest.md) · [Pinned Zallet setup guide](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/book/src/guide/setup.md)

1. Configure Zebra with network Regtest, an absolute state.cache_dir, loopback rpc.listen_addr and cookie authentication. Set Canopy to height 1 and NU7 to height 2 under network.testnet_parameters.activation_heights. Set mining.miner_address to a disposable Regtest destination. Start the verified node.

   ```sh
   zebrad -c "$REGTEST_ZEBRA_DIR/zebrad.toml" start
   ```

2. Configure the test Zallet instance using the linked setup template. Set consensus.network to regtest, regtest_nuparams to ["e9ff75a6:1", "77190ad9:2"], and external.broadcast to false for the observer. Set indexer.validator_address and validator_cookie_path to Zebra's loopback endpoint and cookie. Set indexer.read_state_service.zebra_state_path to the persistent Zebra cache path and its grpc_address to a dedicated loopback port. Bind its JSON-RPC endpoint only to loopback. Verify that the full upgrade table and genesis agree before creating notes.

   ```sh
   zallet -d "$REGTEST_WALLET_DIR" generate-encryption-identity -p
   zallet -d "$REGTEST_WALLET_DIR" init-wallet-encryption
   zallet -d "$REGTEST_WALLET_DIR" generate-mnemonic
   zallet -d "$REGTEST_WALLET_DIR" start
   ```

3. Use the pinned wallet's rpc help to create disposable payer and receiver accounts with z_getnewaccount and derive shielded-only receive addresses with z_getaddressforaccount. Mine local blocks with Zebra's generate or generatetoaddress, verify the Regtest network and allow the payer's coinbase to mature. Follow the pinned wallet's z_shieldcoinbase flow in the disposable payer. Fund one exact Regtest deposit to the receiver with a unique ZYRO memo. Mine to the selected depth and wait for the wallet's full-scan height to match Zebra.
4. Run the observer with the receiving account UUID and a start height at or before the deposit. Keep the optional intent file private. It holds network, account, receiver, memo, integer amount and confirmations. A match prints a digest and observation-only status. Restart the observer and wallet, recheck the same deposit, and exercise a Regtest reorg. For refund acceptance use the verified signer and journal gate below when available.

From the repository root, compile the observer without requiring the tsx runtime:

```powershell
node node_modules/typescript/bin/tsc --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --outDir artifacts/zallet-1b/observer apps/api/src/taz-markets/live/observe.ts
$env:ZYRO_TAZ_CUSTODY_MODE='regtest'
$env:ZYRO_TAZ_ZEBRA_RPC='http://127.0.0.1:18232'
$env:ZYRO_TAZ_ZALLET_RPC='http://127.0.0.1:18234'
$env:ZYRO_TAZ_ZEBRA_COOKIE_FILE='<private Zebra cookie path>'
$env:ZYRO_TAZ_ZALLET_COOKIE_FILE='<private Zallet observer cookie path>'
$env:ZYRO_TAZ_WALLET_ACCOUNT='<receiving account UUID>'
$env:ZYRO_TAZ_SCAN_FROM_HEIGHT='2'
node artifacts/zallet-1b/observer/taz-markets/live/observe.js
```

Set ZYRO_TAZ_OBSERVATION_INTENT_FILE to a private JSON file to check a particular intent. The CLI prints no account UUID, memo, receiver, transaction payload, RPC credential or signing material. Use the same command in testnet-readonly mode only with a separately provisioned Testnet observer. Do not reuse the Regtest data directories.

## Signer and journal acceptance requirements

Zallet's pczt_create can select by funding source. It lacks an exact allowed shielded note list. pczt_inspect returns creator-supplied shielded values and addresses and reports shielded spends primarily by count. It does not connect each selected spend to a reserved note. Wallet-level serialization alone can prevent simultaneous selection attempts but cannot prove that the proposal spent the intended inputs. The repository's existing Rust PCZT diagnostic derives a digest and does not establish recipient, amount or note ownership. [Pinned PCZT inspection code](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/zallet-core/src/components/json_rpc/methods/pczt_inspect.rs) · [ZYRO PCZT checkpoint](phase3-checkpoint.md)

Use a compatible Rust wallet component to establish each real input from wallet note identity and checked transaction effects, authenticate recipient and amount against shielded output commitments and ciphertext, check pool balance, fee, change and expiry, and bind the result to the approved obligation digest. An isolated signer must enforce that policy with its own custody identity, independently of Arena roles and application database claims. Verify the signed artifact derives the same effects and transaction ID before submitting. Zallet extraction can mark inputs pending-spent, so test process termination both before and after extraction and journal commit.

The signer journal should retain the validated final bytes in its private persistence boundary with a stable obligation and approval digest, transaction ID and authorizing digest, exact input reservations, recipient, amount, fee, and attempt state. A broadcast failure keeps the same bytes and identity for wallet, mempool and chain reconciliation. Authorize an identical retry only after the reconciliation policy allows it. Require proof of non-inclusion and invalidity, plus new approval, before any replacement. The implemented observer has no spend-capable RPC or signed-transaction journal.

## First explicitly authorized public Testnet refund

1. On a supported host, complete the Regtest deposit, exact refund, confirmation and process-restart acceptance with the independently verified signer and journal. Capture sanitized evidence and verify repeated worker execution cannot create a second payment.
2. Review release provenance, dependencies, the centralized custody terms, caps and fee reserves. Prepare a dedicated disposable public Testnet custody wallet, private signer and separate observer. Verify Testnet genesis, branch, pinned service versions, sync and account identity. Use a new payer and a pre-reviewed refund Unified Address.
3. Obtain explicit operator authorization for the capped deposit and its fee reserve. Record a private intent and independently verified receiving address. Send one exact payment of 1,000,000 zatoshis with the memo or verified diversified receiver. Keep intake closed.
4. Observe the payment through two independent sources and without a client transaction hint. Record the output identity, amount, commitment and block evidence. Wait for the approved confirmation depth. Create one refund obligation in the existing TAZ ledger only after the validated live bridge is in place.
5. Prepare the refund after authorization. Independently check the reserved inputs, approved destination, exact 1,000,000 zatoshis, separate operator fee, change, branch and expiry. Get explicit authorization for the precise reviewed plan. Prove and sign in the isolated signer and durably journal the final bytes before an authorized broadcast.
6. Confirm the same outgoing ID in the canonical chain and confirm receipt in the payer wallet. Restart node, wallet, observer and worker. Reconcile wallet balances, the exact journal artifact and the obligation. If the result is ambiguous, hold and reconcile that identity before a retry. Save only sanitized acceptance evidence.

The first two-player market also needs a verified live ledger bridge, a single scheduled BTC/USD market with sufficient funding time, independent snapshots for both opposing stakes, exact Coinbase candle evidence, and one capped 2,000,000-zatoshi payout. Operator pays fees separately. Keep public participation disabled until private refund and winning-payout acceptance succeeds.

## Test evidence

The new RPC-contract tests use synthetic node and wallet responses and cover ownership, memo attribution, provider disagreement, network identity, unsupported versions, lag, cookie rotation, restart, and reorganization. They do not verify actual chain transactions. All 16 new observation tests passed. The full suite passed 250 tests with 5 skipped using a disposable local MongoDB replica set for database tests. Arena, wallet, funding and prior TAZ fixture tests passed. Skips covered the live Testnet and PostgreSQL suites.

```powershell
node node_modules/vitest/vitest.mjs run tests/taz-live-observation.test.ts
```

Regtest transaction execution, public Testnet read-only observation, and funded public Testnet settlement are pending.
