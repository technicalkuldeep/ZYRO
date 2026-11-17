# Zcash integration

ZYRO now has **verified public-testnet connectivity, a real shielded transfer, and real developer-custodied market-note recognition**. It does not have integrated FROST escrow or market settlement.

## Current paths

1. **JSON-RPC node**: `apps/api/src/zcash.ts` permits only chain-info/network-info/block-hash/raw-transaction reads. It refuses mainnet and configured-network mismatches; optional genesis pinning supports Zebra versions that label regtest as `test`. Three bounded connection attempts, eight-second request deadlines, sanitized errors and matching JSON-RPC IDs are implemented.
2. **Public lightwalletd**: `lightwallet.ts` uses maintained `@grpc/grpc-js` and the vendored official wire protocol. TLS is mandatory for public testnet. Plaintext is restricted to loopback regtest. Chain identity is checked before transaction lookup. Height and software are actual service responses, never static success data.
3. **Rust transaction decoder**: `services/zcash/transaction-inspect` parses real serialized bytes and computes the actual Zcash txid through pinned librustzcash. It does not implement hashing or signatures itself. The API starts the configured argv array without a shell; only public transaction bytes are sent through stdin. No key material enters this process.
4. **Confirmation tracking**: the lightwallet path checks raw txid plus membership in the reported mined compact block, then computes confirmations from the current reported tip. RPC handles mempool/confirming/confirmed/conflicted states. Refresh always queries infrastructure again; old evidence is not relabeled as fresh after a network failure. This trusts the configured infrastructure's chain view, not independently verified local consensus.
5. **Developer wallet**: the pinned official `zcash-devtool` constructs/signs/broadcasts outside the API. Its encrypted mnemonic and identity remain under ignored `.local/`. This is explicitly developer custody.
6. **Funding**: `funding.ts` issues private challenge/participant references and treats submitted txids as unverified claims. Opt-in `demo-wallet.ts` opens only the local wallet's recognized-note database read-only. Exact transaction, receiver, external key scope, memo, amount and chain status must match. Duplicate `(network,txid,pool,index)` outputs cannot fund a second intent. Insufficient/excess notes, conflicts and late deposits remain explicit states. No event enables automatic settlement.

## Configure

See `.env.example`. Default network is testnet; mainnet is refused at startup and operation boundaries. Without endpoint configuration the UI reports unconfigured/unreachable, with no invented height or confirmation.

```dotenv
ZCASH_NETWORK=testnet
LIGHTWALLETD_URL=https://testnet.zec.rocks:443
ZCASH_TX_INSPECTOR=["wsl.exe","-d","Ubuntu-24.04","--exec","/mnt/d/ZYRO/services/zcash/transaction-inspect/target/release/zyro-transaction-inspect"]
```

Prefer JSON-RPC when a local node is available: configure `ZCASH_RPC_URL` and separate authentication fields. No URL credentials or arbitrary browser-selected endpoints. All app requests go through same-origin Express routes.

Opt-in **local demo only**:

```dotenv
ZYRO_CUSTODIAL_DEMO=1
ZCASH_DEMO_WALLET_DB=ABSOLUTE_PATH_TO_LOCAL_DEMO/data.sqlite
ZCASH_DEMO_RECEIVER=YOUR_GENERATED_UTEST_UNIFIED_ADDRESS
```

This is forbidden with NODE_ENV=production or a non-testnet configured network. The receiving address must already belong to the local wallet. Wallet syncing is an explicit CLI task, not an unattended key-owning API process. Recognition never reads `identity.txt` or `keys.toml`. Self-payment metadata handling is specific to the pinned wallet schema; unsupported schema fails closed.

## Verified evidence

- [Repeatable testnet demonstration and exact versions](testnet-demo.md).
- [Signed transfer observation](evidence/shielded-transfer.json).
- [Two recognized market notes](evidence/market-funding.json).
- [Real FROST lab and compatibility limits](frost-integration.md).

The full transfer is `0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c`, mined at 4,633,072 and observed with three confirmations. The market notes use different txids and exact private references. None is a threshold escrow spend. Published demo metadata is intentionally disclosed by the developer.

## Regtest / PostgreSQL

WSL2 and Rust are available. Docker/Compose and PostgreSQL are absent; privileged setup needs approval. Z3 source was inspected at `e84ce9fd8e864ff0b2a8a62f6ce14392145db0fb`. Use its explicit regtest environment, loopback bindings and configured genesis fingerprint where required. No local regtest node or PostgreSQL success is claimed. See [blockers](blockers.md).

## Upstream compatibility and remaining work

Inspected: [Z3](https://github.com/ZcashFoundation/z3), [Zebra](https://github.com/ZcashFoundation/zebra), [zcash-devtool](https://github.com/zcash/zcash-devtool), [librustzcash](https://github.com/zcash/librustzcash), [FROST](https://github.com/ZcashFoundation/frost), [frost-tools](https://github.com/ZcashFoundation/frost-tools), [ZIP 312](https://zips.z.cash/zip-0312).

Threshold key generation/signatures are verified separately from actual Ironwood wallet spends. A final binding manifest, renewed participant consent, authenticated resolution, actual PCZT/sighash inspection, compatible key/proof handling, independently secured nonces and durable signing sessions are still needed. FROST does not supply conditional smart contracts or automatic refunds. Detailed dependency compatibility is in `frost-integration.md`.
