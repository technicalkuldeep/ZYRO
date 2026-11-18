# Real FROST demonstration and integration boundary

Phase 3 update (November 18): maintained frost-tools has merged Ironwood support.
ZYRO now reproduces its public v6 fixture digest with the newer pinned wallet
stack and computes a digest from a newly constructed unsigned wallet PCZT.
Neither diagnostic authorizes signing. See [exact versions, policy gaps and
reproduction](phase3-checkpoint.md). An integrated FROST payout is still absent.

## Verified

`services/zcash` runs real **three-party distributed key generation**, producing distinct participant key packages and a common even-Y group key. No trusted dealer is used. Each of the pairs **1+2, 1+3, and 2+3** produces a rerandomized RedPallas FROST signature with fresh nonces and a fresh randomizer.

The test verifies every signature using both the upstream FROST verifier and **RedDSA Orchard SpendAuth** verification. Aggregation with only one signature share is rejected. A changed message is rejected. Nonces are consumed once in the wrapper; private key shares/nonces are not printed, returned through the API or persisted.

**Scope:** all three participant states execute in one isolated development process, with in-memory delivery of DKG packages. This verifies cryptographic operations and threshold behavior. It does not demonstrate independently operated signers or authenticated distributed transport. The signed message explicitly says it is not a transaction.

```sh
cargo test --locked --manifest-path services/zcash/Cargo.toml
cargo run --locked --manifest-path services/zcash/Cargo.toml
```

Actual result: **1 Rust test passed**, covering DKG, all three pairs, single-share rejection and altered-message rejection. [Public signature evidence](evidence/frost-lab.json) includes no private material. Public signatures alone do not prove how many entities controlled the shares; reproduce the test to inspect the implemented flow.

## Pins demonstrated together

- reddsa **0.5.1**, exact commit `ed49e9ca0699a6450f6d4a9fe62ff168f5ea1ead`.
- frost-rerandomized **2.1.0**.
- frost-core **2.2.0**.
- rand **0.8.5** with OS randomness.
- Rust **1.99.0**; Cargo.lock committed.
- Evaluated frost-tools commit `53df99c2bd61f7cb60a0d1f634822a76be3799cf`, whose dependency pins informed this compatible lab.

## Not integrated

The actual shielded testnet transaction was a normal devtool wallet spend. It was **not** authorized by the FROST lab.

Inspected frost-tools uses PCZT 0.8.0-rc.1 and an Orchard fork with `unstable-frost`, while the demonstrated wallet uses PCZT 0.10.0-pre.2, orchard 0.16.0, and newer RedDSA dependencies. These graphs have not been demonstrated together for an Ironwood spend. We do not force incompatible cryptographic dependencies together or assume matching names imply wire compatibility.

Actual escrow requires a final participant/recipient/funding manifest with fresh consent, compatible threshold key derivation and viewing material, actual PCZT inspection, signer-computed sighash, proof/finalization compatibility, authenticated oracle evidence and durable single-use nonce/session management. The independent TypeScript policy checks amounts, recipients, fees/change, agreement and state, but is not wired to authorize cryptographic transaction signatures. No API connects caller-supplied policy flags to private signer shares.

No threshold-authorized on-chain refund has been demonstrated. Refunds need the required quorum; current developer-custodied deposits instead depend on the developer wallet operator. FROST supplies neither smart contracts nor automatic timeout spending.

## Assumptions

Two colluding signers in a 2-of-3 deployment could bypass application policy. Unavailable signers can stall payouts and refunds. Signers and coordinator may learn transaction data. Secure nonce lifecycle, authentic transport, independent operation, backup/recovery, disputes and audit remain necessary.

Primary references: [ZF FROST](https://github.com/ZcashFoundation/frost), [frost-tools](https://github.com/ZcashFoundation/frost-tools), [RedDSA](https://github.com/ZcashFoundation/reddsa), [ZIP 312](https://zips.z.cash/zip-0312), [librustzcash PCZT](https://github.com/zcash/librustzcash/tree/main/pczt). ZIP 312 is a draft spend-authorization proposal, not programmable on-chain outcome enforcement.
