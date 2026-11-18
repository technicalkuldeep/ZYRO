# Phase 3 engineering checkpoint — November 18, 2026

This release preserves the Phase 2 product. It does **not** claim a completed
FROST market payout. No mainnet operation, new payment, push or release was made.

## Maintained signing path

[ZF issue 591](https://github.com/ZcashFoundation/frost-tools/issues/591) was
resolved after the Ironwood dependency and signing changes were merged. The
upstream author reports a completed `pczt create → prove → zcash-sign → FROST →
zcash-sign → pczt send` testnet flow. That is upstream evidence, not ZYRO evidence.
The older claim that no maintained Ironwood signing path exists is superseded.

Inspected local frost-tools revision:
`53df99c2bd61f7cb60a0d1f634822a76be3799cf`:

| Component        | frost-tools                            | ZYRO wallet / diagnostic             |
| ---------------- | -------------------------------------- | ------------------------------------ |
| PCZT crate       | 0.8.0-rc.1 requirement                 | 0.10.0-pre.2 at librustzcash eb38d7a |
| Orchard          | 0.15.5 requirement, fork patch 42015f1 | published 0.16.0                     |
| zcash_primitives | 0.29.0 requirement                     | 0.31.0-pre.2                         |
| zcash_protocol   | 0.10.0 requirement                     | 0.11.0-pre.1                         |
| RedDSA           | ed49e9c (FROST lab also uses this)     | wallet resolves its own stack        |

Crate versions are not PCZT wire versions. [ZIP 374](https://zips.z.cash/zip-0374)
describes v1/v2 PCZT and v5/v6 transactions. [ZIP 312](https://zips.z.cash/zip-0312)
specifies rerandomized signing; it does not enforce market policy.

The upstream implementation computes transaction effects, dispatches v5/v6
sighashes, inspects **both** Orchard and Ironwood bundles for v6 spends, reads
each real spend's alpha, and applies signatures against its randomized key.
Migration transactions can spend Orchard while paying Ironwood. Inspecting only
Ironwood can miss a real spend. Signature verification against a caller-selected
wrong-version hash can succeed locally and still fail transaction extraction.

## Implemented compatibility checkpoint

The new `zyro-pczt-inspect` binary uses the **same pinned librustzcash revision**
as the existing parser/wallet. It computes the shielded digest from serialized
PCZT effects, never a coordinator-supplied digest. It reproduces the upstream
public v6 fixture's expected digest, and verifies that using the v5 algorithm
would produce a different digest. This proves compatibility for that fixture
only; a newly constructed ZYRO PCZT has not been signed across both stacks.

```sh
cargo test --locked --manifest-path services/zcash/transaction-inspect/Cargo.toml
cargo run --locked --manifest-path services/zcash/transaction-inspect/Cargo.toml \
  --bin zyro-pczt-inspect < services/zcash/transaction-inspect/tests/fixtures/ironwood_v6.pczt
```

Its output always includes `authorizationAllowed=false`. It emits no FVK,
randomizer, key share, note witness or wallet material. The redacted fixture
cannot support recipient/amount verification. Noncanonical encodings and
trailing bytes are rejected; the pinned upstream parser alone accepts a trailing
suffix. This is a wrapper restriction, not a change to cryptography.

## Exact remaining blockers and minimum safe next step

A new unsigned **1,000,000-zatoshi** developer-wallet proposal was successfully
created with `bash scripts/testnet-wallet.sh propose SHIELDED_TESTNET_ADDRESS 1000000`.
The first attempt reported no available balance; `bash scripts/testnet-wallet.sh sync`
updated the wallet to tip 4,634,969, after which creation succeeded. It uses the
wallet's ordinary spending authority and is not a market settlement. Its actual
v6 digest is in [diagnostic evidence](evidence/pczt-diagnostic-phase3.json).
The private PCZT is excluded from publication; no output disclosures or randomizers
are copied into the public receipt. No signature or broadcast was attempted.

The maintained `zcash-sign` library's three tests pass. A read-only cross-stack
probe parses the new devtool PCZT with PCZT 0.8.0-rc.1, but `into_effects()` fails
with **`UnknownConsensusBranchId`**;
the same PCZT produces a v6 digest under pinned PCZT 0.10.0-pre.2. This is an
observed effects-extraction failure, not an assumed format-version rejection.
The older `zcash_protocol 0.10.0` does not recognize the new proposal's consensus
branch **`0x77190ad9`**. [Machine-readable compatibility receipt](evidence/pczt-compatibility-phase3.json).
The minimum necessary change is support for that active consensus branch and its
transaction rules throughout the signing/extraction stack, not a PCZT header
rewrite or a v5 sighash fallback. The exact smallest compatible dependency upgrade
has not been built or verified; upgrading only an enum parser would not establish
correct consensus signing. Prefer the wallet's shared pinned stack and maintained
FROST/key-derivation APIs, then rerun the fixture and real proposal checks before
any signing. No compatibility or cryptographic patch was applied.

Reproduce the probe without exposing disclosures:

```sh
mkdir -p .local/frost-tools/zcash-sign/examples
cp services/zcash/compatibility-probe.rs .local/frost-tools/zcash-sign/examples/zyro-compat.rs
cd .local/frost-tools
cargo test --locked -p zcash-sign --lib
cargo run --locked -p zcash-sign --example zyro-compat -- /absolute/path/to/unsigned.pczt
```

The example prints only compatibility/digest diagnostics, never private material.
Use the documented frost-tools revision; it is not vendored into ZYRO.

The existing deposits belong to the developer wallet, **not the DKG group**.
Signing their digest with the lab group cannot authorize those spends. A genuine
threshold account needs maintained FVK derivation and wallet import, fresh
participant consent to a final address/funding manifest, and new testnet funding.
Do not repurpose existing deposits as threshold custody. The maintained fork's
FVK constructor has quantum-recoverability caveats; it is not a production custody
claim. See the inspected upstream discussion before selecting it.

Before any signing participant emits a share, it must independently authenticate
accepted terms, participants/addresses, oracle receipt and current chain deposits;
validate every input/output disclosure against underlying commitments, derive
the digest locally, check consensus/network/fees/change and escrow ownership,
and atomically reserve its market/session/nullifiers in a durable replay journal.
Missing or redacted required disclosures must reject. A coordinator's JSON
`funded`, `resolutionVerified` or displayed metadata is not proof.

The normalized TypeScript policy now strictly checks runtime types and integer
financial fields and rejects unknown fields and invalid outcome enums. Its
negative tests remain **offline normalized-policy tests**, not tests of actual
PCZT signer authorization. There is no signing API or payout endpoint. Complete
PCZT recipient replacement, changed amount, extra output, excessive fee,
cross-market, wrong outcome, duplicate submission, underfunding and malformed
disclosure tests remain prerequisites for enabling signing.

## Custody and operational limits

The three DKG participants currently run in one lab process. They are locally
operated, not independent organizations. Key shares remain in memory; the market
coordinator and browser never receive them. Process isolation, authenticated
signer channels and crash-safe nonce persistence remain unimplemented. A 2-of-3
quorum can collude and bypass software policy. An unavailable quorum can block
payouts and refunds. Existing wallet funds require the developer operator.

Settlement progression beyond verified deposits remains disabled. Persistent
funding records and duplicate-output protection already exist; introducing
`SIGNED`, `BROADCAST` or `CONFIRMED` settlement records without the actual protocol
would misrepresent progress. Full settlement state transitions/replay journaling
remain pending.

## Infrastructure

WSL Ubuntu 24.04 Rust/Cargo 1.99.0 verified again. Docker, Compose and PostgreSQL
binaries were absent from Windows PATH and WSL. PostgreSQL and Z3 regtest have not
passed locally. Follow [Windows infrastructure](windows-infrastructure.md) and
the pinned [Z3 regtest setup](https://github.com/ZcashFoundation/z3), then run the
dedicated database tests. No system installation was performed in this phase.

The [zallet RPC reference](https://zcash.github.io/zallet/rpc/) could not be fetched
by the research tool during this checkpoint. No zallet capability is claimed or
used. [zcash-devtool](https://github.com/zcash/zcash-devtool) and
[librustzcash](https://github.com/zcash/librustzcash) source were inspected locally.
