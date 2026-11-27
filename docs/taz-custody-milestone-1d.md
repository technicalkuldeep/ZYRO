# Milestone 1D Regtest refund evidence

Zallet 0.1.0-beta.4 and Zebra 7.1.0+git.534549f continued from the existing [Milestone 1C chain](taz-custody-milestone-1c.md). The original deposit and the new operator fee reserve are canonical and unspent at height 212. All transfers in this run used disposable Regtest accounts.

## Funding qualification

The original deposit at height 106 still matches the saved receiver, amount and memo. The saved intent has six fields: network, account, receiver, memo, amount and confirmations. The memo reference predates broadcast, but the saved evidence was created after mining. The available artifacts contain no contemporaneous funding intent with a deadline, no immutable MongoDB position, and no cutoff captured by the accounting workflow. The workflow requires a qualifying scan at the close and within the configured grace window. Zebra's Regtest block timestamps in this run derive from genesis and cannot establish when an application deadline elapsed.

The observer now also asks Zebra to decode the canonical transaction, compares the transaction metadata with the wallet and checks the commitment at the same pool and action index. This read-only corroboration was exercised against the actual deposit. There is no live MongoDB qualification or refund obligation for that deposit.

## Operator-funded fee reserve

Before the top-up, Zallet's unsigned `pczt_create` returned code `-4` and `Insufficient balance (have 1000000, need 1010000 including fee)`. A dedicated operator account in the disposable payer wallet mined its own coinbase funds and shielded one mature output. It then sent 50,000 zatoshis into the custody account's Ironwood pool. The operator account paid the funding transaction's fee.

| Regtest event      | Transaction ID                                                     | Block                                                                          |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Operator shielding | `280e0db5f1d1d0cb2f584c3b026a5eb96f5aa94b58a8e73a175390f77db81d76` | Height 210, `f145abb47becff247a445929155037b66c7dedc03ff8537449fe67f4e568f735` |
| Fee reserve        | `a60bad40308b0e195475c196b5a96b63049fb521b0e01f89a7319be92df08f89` | Height 211, `07496474fdff8c7dd0eba978101f53d2dcc0a28252bd525475e0d312935873d8` |

The reserve note is Ironwood action 3, commitment `97fe0f6b62b0a2db1d1ad97b7b6f636c717d19d452b6f963adcea6c8bb504b27`. The custody account's two unspent notes totaled 1,050,000 zatoshis at height 212, where the reserve had two confirmations and the original deposit had 107.

## Unsigned proposal and independent checks

Zallet's `pczt_create [custodyAccount, recipients, 2, "FullPrivacy", "orchard"]` selects within one account and the named pool. It accepts no list of exact shielded note IDs. The experiment isolated the two notes in a disposable custody account and compared every nonzero spend with the expected nullifier and value from the independently queried wallet database. The verifier used the account's separately obtained full viewing key to check the spend nullifiers and randomized verification keys.

The offline Rust verifier uses ZIP 374's upstream Verifier interface and Orchard 0.16.0 to check the per-action value and output commitments. It decrypts nonzero output ciphertexts with viewing keys from the disposable payer and custody accounts, checks the exact payer receiver and value, allows at most one change output decryptable under the custody account's internal key, and rejects other nonzero outputs. It checks NU7, v6, Ironwood-only effects, Regtest-encoded keys and recipient, and the fee against the Ironwood balance and a 50,000-zatoshi cap. Regtest chain identity is checked by the live observer. This offline binary treats its input evidence file as operator-prepared diagnostic data. It has neither a ledger nor RPC access. [ZIP 374](https://zips.z.cash/zip-0374)

The verified candidate spends the two custody notes, pays **1,000,000 zatoshis** to the payer, returns **40,000 zatoshis** to custody internal change, and allocates **10,000 zatoshis** to fees. The shielded sighash is `b4dae1366aab0b136987e26c2850c6b05ee794dce05feb4a600336670fc34003`. The unsigned PCZT SHA-256 is `1fdda857dc569c41c290900b31a77d3e11d98d1a024ea42e5f227dc2a0da657a`. Both the release's `pczt` 0.10.0 with `zcash_primitives` 0.31.0 and the repository's compatible revision produced the same result.

The verifier always returns `authorizationAllowed: false`. The experiment did not install an authenticated ledger bridge, isolated signer, durable signed-transaction journal or settlement worker. It did not sign, broadcast or confirm a refund. Duplicate approval, crash recovery, ambiguous broadcast, payer receipt and a confirmed refund reorg remain untested with real funds.

## Reproduction commands

The private run directory is `/tmp/zyro-regtest.DU5peJ`. Its Python RPC helper reads the pinned services' cookies directly from that directory. The fee-funding command was `python3 fee.py` from that directory, with an initial-height guard of 107. It created a new operator account, ran `generatetoaddress [102, operatorTransparent]`, used `z_shieldcoinbase [operatorTransparent, operatorShielded, null, 1]` and `z_sendfromaccount [operatorAccount, "orchard", recipients, 1, "FullPrivacy"]` for the 50,000-zatoshi reserve, and mined to two confirmations. The runbook's historical command would spend funds again on another chain that passes its initial-height check. Use the stored evidence below to inspect this run.

```sh
run=/tmp/zyro-regtest.DU5peJ
export CARGO_TARGET_DIR="$run/rust-target"
ZYRO_TAZ_REGTEST_EVIDENCE_FILE="$run/evidence.json" \
  node node_modules/vitest/vitest.mjs run tests/taz-regtest-observation.test.ts
cargo run --locked --offline --manifest-path services/zcash/transaction-inspect/Cargo.toml \
  --bin zyro-regtest-refund-check -- "$run/refund-check-input.json" < "$run/refund-unsigned.pczt"
ZYRO_TAZ_REFUND_TEST_DIR="$run" \
  cargo test --locked --offline --manifest-path services/zcash/transaction-inspect/Cargo.toml \
  --bin zyro-regtest-refund-check -- --ignored
```

The private verifier JSON contains the recipient, the two wallets' full viewing keys, the expected note nullifier-to-value map, and the fee cap. It was populated from authenticated wallet RPC and read-only custody SQLite queries, with Zebra confirming each source's inclusion. Keep it and the proposals in the private directory. `python3 adverse.py` generated four additional unsigned live proposals with a wrong value, wrong recipient, external extra output and unrelated source account. The Rust test rejects those candidates and also checks a missing reserve, reduced fee cap, wrong-network receiver and altered payer ciphertext.

The Linux Vitest suite with live observation enabled passed 206 tests with 52 skipped. The Windows suite with the disposable MongoDB replica set passed 252 with 6 skipped. Both used `vitest run --maxWorkers 4 --testTimeout 20000`. The MongoDB suite exercised the existing fixture settlement path. Three existing Rust tests passed, and the opt-in Rust test passed against the live unsigned proposal and adverse cases.

The smallest safe end-to-end test on this chain requires a private Regtest intent with a deadline committed before funding, authenticated cutoff capture, and a signer that requires the resulting ledger authorization before durably storing and submitting final bytes. The original deposit remains available for observation and proposal verification.
