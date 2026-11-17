# Verified public testnet demonstration

Date: November 17, 2026. **Actual public testnet activity, not a mock or regtest transaction.**

## Signed shielded transfer

- Network: public Zcash testnet (`test` reported by lightwalletd).
- Constructed, locally signed and broadcast by ZYRO's isolated developer wallet using the pinned upstream devtool.
- Transaction ID: `0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c`.
- Amount from the local wallet proposal: **1,000,000 zatoshis (0.01 TAZ)**.
- Fee from the proposal: **10,000 zatoshis**; change **8,990,000 zatoshis**.
- Shielded pool: **Ironwood**. Decoded transaction has **2 Ironwood actions, 0 transparent inputs, 0 transparent outputs**.
- Mined height: **4,633,072**.
- Block hash: `00003222e7cb4c4eed1d629093b220c4190ba32d85de064a560b865f76aeefd8`.
- At `2026-11-17T18:12:32.599Z`: tip **4,633,074**, **3 confirmations**, state **CONFIRMED**.

[Public explorer](https://testnet.zcashexplorer.app/transactions/0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c). Explorer availability is external; the saved machine-readable observation is in [evidence](evidence/shielded-transfer.json).

Funding for the isolated wallet came from the supported `zcash-faucet` proof-of-work client: `36a790ee08f7eab67c28956108d188671df6b3d110753671c7693ed357d5fa96`, mined at **4,633,066**, observed with **9 confirmations** at `2026-11-17T18:12:35.669Z`. It also has two Ironwood actions and no transparent inputs/outputs.

**Evidence boundary:** librustzcash computes the txid from actual serialized bytes. The remote lightwallet service supplies the block and chain tip; ZYRO checks that the txid appears in the reported compact block. This is not independent local consensus/proof verification. The amount/fee and recipient come from the local wallet, not public shielded-chain inspection. These transactions are not FROST spends or market settlements.

## Exact software

| Component                           | Version / pin                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Host                                | Windows 11; WSL2 Ubuntu 24.04; kernel 6.6.87.2                                                                        |
| Application Node / npm              | 22.19.0 / 10.9.3                                                                                                      |
| Rust / Cargo in WSL                 | rustc 1.99.0 (`b940084d7`), cargo 1.99.0 (`5f94df478`)                                                                |
| zcash-devtool                       | 0.1.0, commit `0b3436bb8d235c67cd36b800cb45a7b1b489c415`, built `--release --locked`                                  |
| librustzcash                        | `eb38d7a373661179dbc083a2fd58b3a6c9b25818`                                                                            |
| Transaction parser                  | zcash_primitives 0.31.0-pre.2; zcash_protocol 0.11.0-pre.1; Cargo.lock committed                                      |
| Wallet protocol libraries           | zcash_client_backend 0.25.0-pre.2; zcash_client_sqlite 0.23.0-pre.2; orchard 0.16.0; pczt 0.10.0-pre.2                |
| Faucet client                       | zcash-faucet 1.3.1, commit `22f43840bd88ba310f68bb929e5c94e10c5abb89`                                                 |
| Faucet-only runtime                 | Official portable Node 24.22.3, executable SHA-256 `86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6` |
| Remote service at first observation | ECC LightWalletD v0.6.1; reported node `v1.8.8+g009b60beac18`, `/Zakura:1.8.8/`                                       |

The faucet uses Node's maintained Argon2 implementation. No custom proof or signature primitives were introduced. The additional runtime is workspace-local; system Node and PATH were not changed.

## Reproduce without moving coins

Build the read-only Rust parser in WSL:

```sh
cargo build --release --locked --manifest-path services/zcash/transaction-inspect/Cargo.toml
```

Set in ignored root `.env`:

```dotenv
ZCASH_NETWORK=testnet
LIGHTWALLETD_URL=https://testnet.zec.rocks:443
ZCASH_TX_INSPECTOR=["wsl.exe","-d","Ubuntu-24.04","--exec","/mnt/d/ZYRO/services/zcash/transaction-inspect/target/release/zyro-transaction-inspect"]
```

On Linux use an argv array containing the absolute compiled binary path. No shell evaluation is used.

```sh
npm run chain:probe
npm run chain:observe -- 0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c
```

Run actual live read-only tests in PowerShell:

```powershell
$env:LIVE_ZCASH_INTEGRATION='1'
node --env-file=.env node_modules/vitest/vitest.mjs run tests/live-testnet.test.ts
```

All three live tests passed: network/height, real decoded transaction/inclusion/confirmations, and unknown-transaction rejection. They are intentionally skipped in ordinary offline CI.

Start the app, open `/wallet`, paste the real txid and select **Check testnet transaction**. The API repeats the live lookup; it does not display a hardcoded receipt. Pending observations poll while the page is visible; failed refreshes retain the old check timestamp and are labeled stale.

[Verified desktop UI](screenshots/wallet-live-desktop.png) · [Verified mobile UI](screenshots/wallet-live-mobile.png) · [Browser verification receipt](evidence/browser-chain.json).

## Reproduce a new transfer

```sh
git clone https://github.com/zcash/zcash-devtool .local/zcash-devtool
git -C .local/zcash-devtool checkout 0b3436bb8d235c67cd36b800cb45a7b1b489c415
cargo build --release --locked --manifest-path .local/zcash-devtool/Cargo.toml
bash scripts/testnet-wallet.sh init
bash scripts/testnet-wallet.sh address
```

Use the generated shielded testnet address with the inspected [faucet client](https://github.com/anukulpandey/zcash-faucet). On Windows `node scripts/prepare-faucet-node.mjs` downloads and checksums the official portable Node runtime. Do not use GitHub login or send wallet secrets. Faucet availability, rate limits and balance are external dependencies; never circumvent their controls.

```sh
bash scripts/testnet-wallet.sh sync
bash scripts/testnet-wallet.sh address
bash scripts/testnet-wallet.sh send SECOND_SHIELDED_TESTNET_ADDRESS 1000000
bash scripts/testnet-wallet.sh sync
bash scripts/testnet-wallet.sh history
```

The script lowers confirmation policy to one for this valueless testnet demonstration; production privacy defaults must not inherit that choice. A send is **never automatically retried** after an uncertain result. Inspect history first.

## Custody and market funding

The real matched demo challenge is `54612d8c-77eb-40f8-acb8-c2e3c509ec69`. YES funded with `949aca173914433db7bb0868aaa3b162b3c170c36ce23ed7e2791a1d242e8d36` (4 confirmations at recognition); NO funded with `7743128f018b5b4e33be17b7d8d0c6fba54430746ac5d289dd67921556d64df1` (3 confirmations at recognition). Each recognized note is exactly **1,000,000 zatoshis**. Both duplicate rechecks passed. [Saved funding evidence](evidence/market-funding.json) records the references, actual txids, values, timestamps and custody limitation. No payout was executed.

This wallet is developer-controlled. Both source and receiving addresses belong to the isolated local demo wallet. Its encrypted mnemonic and age identity reside under ignored `.local/testnet-wallet`; the API never reads those files. No production self-custodial wallet connection is claimed.

Opt-in funding recognition reads only `data.sqlite` in read-only mode. It requires a wallet-recognized external-scope note, exact registered receiver, exact challenge reference memo, integer amount and actual chain lookup. For self-payments, the pinned wallet marks notes as change and may retain the memo in its authenticated outgoing records; the connector requires a matching received note and joins the exact output/recipient/value. Internal change outputs cannot satisfy this check. Wallet memo storage can trim zero padding; only exact bytes followed by zero padding are accepted.

`scripts/funding-demo.ts` creates two explicitly developer-operated guest sessions and sends two testnet payments with distinct memos. It requires `ZYRO_RUN_WALLET_DEMO=1`. `scripts/resume-funding-demo.ts` resumes from the public journal and persisted local records, refuses ambiguous sends and never repeats a recorded broadcast. It is a local operator tool, not a public authorization bypass. Funding verification does **not** enable threshold escrow or settlement.
