# Milestone 1C Regtest acceptance

On November 27, 2026, Ubuntu WSL2 ran the cached upstream Linux x86-64 archives for Zallet 0.1.0-beta.4 and Zebra 7.1.0+git.534549f. Both archives matched the SHA-256 pins and were covered by the provenance checks recorded in [Milestone 1B](taz-custody-milestone-1b.md). Zebra opened v29.0.0 state and served its indexer on localhost. The Zallet Zebra backend opened the same state, accepted the backing node's consensus rules, and finished scanning in both disposable wallets. See the [Zallet release](https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.4) and [Zebra release](https://github.com/ZcashFoundation/zebra/releases/tag/v7.1.0).

## Chain evidence

- Regtest genesis `029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327`. Canopy activated at height 1 and NU7 at height 2. Both consensus fields returned `77190ad9` at the observed tip.
- Shielding transaction `81f3039bb7294a16bbe5235891a1fb94a95ae41412a4aadbb7b650a92c217ae4`, mined at height 105 in block `31fabcb90bb604a4ca6b5d23c2f1b478054fd3599a0105b83c8c00a80d1c5bd7`.
- Shielded custody deposit `78b03f268cd38db738564149a1d8c58dcf18821a2464dc7de754f72ae6f9b115`, mined at height 106 in block `64e5933131c38a79d30110b1761a6fe2090d98593e5798371669f5f9b9882324`. The recipient decrypted 1,000,000 zatoshis and the exact intent memo from Ironwood action index 2. The transfer fee was 25,000 zatoshis, paid by the payer. Zebra's decoded commitment at that index was `3fe71d2f8ecf7b8e75d25bc496b4dc6c8e4f7514ccaff4b6cd14fbdd98bbde19`.
- At height 107, both wallets reported fully scanned height 107 and matched Zebra's tip `472cf68aa3ad929eec5f8749d35f2518bc226f69d578fd8cb308bd094f885019`. The observer matched the note to the private intent without a transaction ID. The observation digest was `d37bafb5db8dc71bdcfa2b8834f3566f403095723a2359afc615edb3c8e57b4d`. After graceful node and wallet shutdown and restart from the same data directories, a fresh observer process found the same canonical note with two confirmations.

## Commands and configuration

The private run directory for these commands is `/tmp/zyro-regtest.DU5peJ`. It contains the two Zallet configs, Zebra config, private evidence input and logs. The node used localhost ports 29230 for P2P, 29231 for the indexer and 29232 for JSON-RPC. The payer and receiver used 29234 and 29235 with their own RPC cookies and `external.broadcast = false`.

```bash
sha256sum artifacts/zallet-1b/{zallet-linux-amd64,zebrad-linux-amd64}.tar.gz
cd /tmp/zyro-regtest.DU5peJ
./zebrad --version
zallet-v*/zallet --version
./zebrad -c zebra.toml start
# In separate terminals, after the corresponding wallet is initialized
zallet-v*/zallet -d payer start
zallet-v*/zallet -d receiver start
```

Initialize each fresh wallet with `generate-encryption-identity`, `init-wallet-encryption` and `generate-mnemonic`, using a private directory and redirecting CLI output to private files. Use `[rpc].indexer_listen_addr` on Zebra and the same address in `[indexer.read_state_service].grpc_address` on Zallet. Both wallets need `regtest_nuparams = ["e9ff75a6:1", "77190ad9:2"]`. See the [pinned Zallet setup guide](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/book/src/guide/setup.md).

1. Call Zebra `generate [2]`, create wallet accounts with `z_getnewaccount`, and derive Orchard-only destination addresses with `z_getaddressforaccount`. Derive a payer Unified Address with P2PKH and Orchard and get the transparent receiver with `z_listunifiedreceivers`.
2. Call `generatetoaddress [102, payerTransparent]` and wait for the payer to scan to height 104. Call `z_shieldcoinbase [payerTransparent, payerShielded, null, 1]` and poll `z_getoperationstatus` for the signed transaction ID.
3. Retrieve the payer's signed bytes from its disposable SQLite `transactions.raw` column using the returned transaction ID in internal byte order. Before broadcast, `getrawtransaction` returned `-5 No such mempool or blockchain transaction` and `gettransaction` returned `-32601 Method not found`. Use Zebra `sendrawtransaction`, wait for `getrawmempool` membership, call `generate [1]` and check `getblock [hash, 1]` for inclusion.
4. After sync to height 105, call payer `z_sendfromaccount [payerAccount, "orchard", recipients, 1, "FullPrivacy"]` with one recipient, 0.01 ZEC and the hex-encoded intent memo. Submit the stored bytes using the same local procedure. Mine one more block and check both wallets' `getwalletstatus`.
5. In the workspace, run the live evidence assertion below. The private JSON contains `zebra` and `zallet` endpoint and cookie-path pairs, the private `intent` and `expected` canonical note fields for assertions. The adapter receives only the account and scan start height. The intent carries no transaction ID. Repeat after calling `stop` on the two wallets and Zebra and restarting them with the same data directories.

```bash
ZYRO_TAZ_REGTEST_EVIDENCE_FILE=/tmp/zyro-regtest.DU5peJ/evidence.json \
  node node_modules/vitest/vitest.mjs run tests/taz-regtest-observation.test.ts
```

The initial sandboxed Zebra start failed to bind 127.0.0.1:29230 with `PermissionDenied (Operation not permitted)`. Local socket access was granted for the run. The observer now accepts the exact official Zebra build suffix and checks the public-chain height estimate only in Testnet mode. Regtest used genesis-derived timestamps and Zebra's estimate was about 20 million blocks ahead, even with both wallets fully synced. The Regtest check still verifies genesis, NU7, exact wallet sync height, tip hashes and canonical block membership.

## Regression results

- Ubuntu with live Regtest enabled ran `node node_modules/vitest/vitest.mjs run --maxWorkers 4 --testTimeout 20000` with the evidence-file environment setting. 205 passed and 52 skipped. The standalone live assertion also passed before and after service restart, and the compiled observer CLI returned the same evidence digest.
- Windows Node against a fresh localhost MongoDB 8.0.12 replica set ran the same Vitest suite with fixture OAuth settings. 251 passed and 6 skipped. Skips covered the Linux Regtest assertion, public Testnet and PostgreSQL. The 17 synthetic RPC contracts, 11 TAZ tests and 9 MongoDB-backed TAZ tests passed. The MongoDB-backed tests use fixture custody transactions.
- TypeScript strict checking passed for the observer CLI and both observer test files. The Windows-installed dependency tree needed the lockfile-pinned Linux Rolldown binding 1.2.19. It was integrity-checked and extracted into the ignored dependency directory.

## Refund gate

The observer returned `observation-only`. The existing execution and obligation path is fixture-scoped and no authenticated live ledger bridge binds this output to an authorized obligation. The custody wallet has a single 1,000,000-zatoshi deposit and would require a separately authorized fee source for an exact 1,000,000-zatoshi refund. Zallet's `pczt_inspect` exposes creator-supplied output values and addresses, and its summary cannot tie real shielded spends to exact reserved notes or prove recipient, amount, authorized change and absence of extra recipients against the actual effects. No refund obligation was written, no custody signature was requested, and no refund journal or duplicate-authorization acceptance was exercised. [Pinned PCZT inspector](https://github.com/zcash/zallet/blob/v0.1.0-beta.4/zallet-core/src/components/json_rpc/methods/pczt_inspect.rs)
