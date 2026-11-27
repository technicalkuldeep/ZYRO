# Phase 3 Milestone 1F: public Testnet readiness record

**Decision: NO-GO for a public Testnet TAZ deposit/refund today.** No public Testnet transaction was created, signed, or broadcast in this milestone. The requested Regtest preservation and regression checks were performed; Testnet remains a read-only readiness exercise.

## Preserved Regtest baseline

The consistent Milestone 1E snapshot is stored privately at `/home/kuldeep/.local/state/zyro-backups/phase1e-20261127T125100Z` (mode 0700; 0600 files). Its manifest covers 384 files and all listed SHA-256 values rechecked without missing or mismatched files. It includes Zebra state, the three wallet databases, MongoDB snapshot/data, the final signed Regtest refund artifact, evidence, and the session records. The snapshot was made after clean stops. The current command environment showed no live Zebra, Zallet, or MongoDB process; restore/start only from the preserved snapshot using its original configurations and do not rerun funding commands.

The completed Regtest evidence recorded in the Milestone 1E run is a 1,000,000-zatoshi confirmed refund, journaled before broadcast and reconciled after restart. The older unqualified deposit and older reserve remain separate protected notes. This evidence is not public Testnet evidence and must never qualify a Testnet ledger position.

## Network and release baseline

Pinned compatibility candidates are Zallet `0.1.0-beta.4` and Zebra `7.1.0`. Zallet beta.4 supports NU7 on Testnet (activation height 4,465,026) and its release notes direct operators to use an NU7-capable Zebra. Zebra 7.1.0 uses NU7 branch ID `0x77190AD9`, is an official security release with no consensus changes, and is compatible with the 7.0 state format. Zallet's release requires Zebra 7.0 or newer. The archive hashes and executable versions were checked below; a connected local Testnet node and synchronized wallet were not verified in this milestone.

Official references:

- https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.4
- https://github.com/ZcashFoundation/zebra/releases/tag/v7.1.0
- https://github.com/zcash/zallet/blob/main/CHANGELOG.md
- https://zebra.zfnd.org/user/requirements.html

The two Linux x86-64 release archives were downloaded to `/home/kuldeep/.local/state/zyro-testnet/artifacts/`, and their SHA-256 values matched the hashes published by the official release pages:

| Artifact | SHA-256 | Executable version |
| --- | --- | --- |
| Zallet `0.1.0-beta.4` | `1a8f8b20358ea3aed644a5b6581f1a346016a73f85e9bbf1bbde9c164d94f509` | `zallet 0.1.0-beta.4` |
| Zebra `7.1.0` | `4b42a23e67fcce27f923882d369dad47f694aa608858f1cbbad70e4298e2ecae` | `zebrad 7.1.0+git.534549f` |

The containing Testnet directory, artifact directory, and extracted binary directory are mode 0700. Archive hashes were compared with official release metadata; the release attestations/signature files were not cryptographically verified locally, so provenance verification remains an outstanding control. Do not reuse Regtest wallet databases, keys, cookies, or state. Zebra's published hardware guidance recommends 16 GB RAM and 300 GB disk, while its specific Testnet cache estimate is about 10 GB and state-snapshot extraction temporarily needs about twice that. D: had about 26 GB free at inspection: that is only a narrow margin over the estimated 20 GB snapshot peak, so confirm the WSL virtual-disk backing location and physical free space, and establish a larger safe reserve, before a full sync. Do not assume the Linux filesystem's reported free space is physical host capacity.

## Read-only connectivity evidence (2026-11-27)

The configured HTTPS lightwallet service answered only read-only `getLightdInfo` and `getLatestBlock` requests. It reported `chainName=test`, vendor `ECC LightWalletD`, version `v0.6.3`, height `4,671,006`, and tip hash `000013a477ac3d54e127a738fb547220fa0f594f3c63d5e5c48106b30280bc20`. This confirms the configured remote endpoint identifies as Testnet and serves a tip; it is not an independently validated Zebra consensus tip.

The first live Testnet integration attempt used the Windows-only `wsl.exe` decoder command from `.env` and could not decode the historical signed transfer. I built the pinned Rust decoder for Linux in `/tmp` and reran the live checks with that binary: **all 3 passed**, including Testnet status, exact transaction decoding/inclusion, and unknown-transaction rejection. No repository environment file was changed. This verifies the read-only public transaction path for that historical transaction, not a custody wallet. No local Testnet Zebra/Zallet process was started, no wallet was created, and no Testnet wallet synchronization was demonstrated. This avoids writing potentially large chain state while the WSL virtual disk's physical backing and free space remain unconfirmed.

## Read-only and isolation gates

- The application's configured lightwallet client is HTTPS and set to `ZCASH_NETWORK=testnet`; its status RPC is read-only. A successful response is provider-reported evidence only, not independently verified consensus.
- The existing live Regtest operator CLI is deliberately hard-coded to `regtest`, the Regtest Mongo database, Regtest address prefixes, local loopback RPCs, one-account custody, and a Testnet-incompatible ledger type. It is not a Testnet signer and must not be repurposed by editing its network selector.
- The private CLI is not imported by public API routes. Approval now requires an Ed25519 detached signature over the exact digest and rechecks that signature before signing/broadcast. The API cannot invent this signature. For deployment, run the CLI under a dedicated OS account with its own owner-only config, cookies, database access, and protected journal; do not run it as the API UID or grant the API UID access to signer files. Keep the operator private key offline or in an independent signing device. No operator key was provisioned here.
- The CLI now additionally checks that its effective UID equals a configured `operatorUid`, and that this is different from `apiUid`. It fails closed if either condition is false. No dedicated operator account was created in this workspace, and no Testnet signing CLI exists yet.
- RPC must bind only to loopback or a protected local socket, require unique credentials/cookies, and be firewalled from the public interface. No Testnet wallet is initialized from Regtest material or from the user's browser wallet.
- Testnet ledger rows need an explicit `testnet` network tag, Testnet genesis and NU7 branch provenance, independent canonical block/commitment evidence, an isolated Mongo database/collection namespace, and unique intent/obligation IDs. Reject Regtest and fixture evidence at the storage boundary. The current verified refund ledger/CLI is Regtest-specific; a public Testnet qualification and refund workflow has not been implemented or exercised.

## Proposed capped acceptance procedure (requires a later explicit approval to transact)

1. Create a separate Testnet node and a fresh, empty Testnet custody wallet plus disposable payer and operator fee wallets. Do not import keys. Confirm release hashes/provenance, network identity, genesis, current Zebra tip, wallet sync and RPC loopback/authentication. Start with no spendable funds and no broadcast-enabled signing path.
2. Configure a new Testnet ledger namespace and fail-closed network validation. Independently authenticate two operators (intent creator and refund approver). Cap market exposure at one position and 1,000,000 zatoshis; cap total refund fee to an explicit operator-approved bound; do not permit client-created intents, txids, cutoff, recipient, or evidence.
3. Commit an immutable intent and position before payment. Store the stake, unique memo, exact custody receiver, reviewed payer refund receiver, Testnet genesis/branch, opening tip, fixed deadline/cutoff, confirmation depth, fee cap, terms hash, and operator approvals in one durable transaction. Require explicit operator confirmation of the displayed address and memo.
4. Only after explicit user authorization, send exactly 1,000,000 zatoshis from the disposable payer. Verify the real transaction, canonical inclusion before the fixed cutoff, required confirmations, exact memo/amount/receiver, wallet-owned note, independent Zebra commitment, freshness, and absence of a duplicate reservation. Freeze one qualified position; if late or reorged, leave unqualified or hold for review.
5. Cancel through the ledger state machine to create one uniquely identified 1,000,000-zatoshi refund obligation. Fund a segregated operator fee reserve separately. Keep each wallet/account single-purpose and reconcile the complete actual note inventory before constructing the proposal. Reject if unrelated or old notes can be selected.
6. Independently verify the real PCZT's NU7 branch, exact authorized inputs, exact payer output, fee bound, permitted custody change, output commitments/decryption and no other payment. Bind a detached independent operator signature to the exact obligation/PCZT/effects digest. Recheck chain validity and authorization immediately before sign.
7. Before broadcast, persist signed bytes, txid, digest, exact sources, recipient/value, fee/change, network, and lifecycle state in a durable protected journal. Broadcast only those bytes. On timeout, reconcile and retry only the identical txid; never build a replacement automatically.
8. Confirm with Zebra and payer wallet, restart the signer/wallet/node/worker, reconcile the same journal entry, and prove retry/duplicate approval cannot sign or broadcast a second transaction. A reorg moves the obligation to review and does not automatically respend.

No step in this proposed procedure is authority to move Testnet funds. Obtain a separate explicit approval before the deposit transaction, and a further operator approval over the exact refund transaction digest before signing/broadcast.

## Regression results

On 2026-11-27, `npm run typecheck` passed for API and web TypeScript. After the signer UID boundary change, the full Vitest suite passed 25 files and 211 tests; 5 files and 53 tests were skipped. MongoDB replica-set integration was among the skipped tests because `mongod` and a test replica-set URI were not available; other skips were optional Regtest/live-browser and opt-in integration groups. The focused signer authorization suite passed 6/6. Full Rust tests passed 3, with the live-PCZT adverse-effects test ignored by default; the earlier opt-in Regtest PCZT adverse-effects test passed 1/1. The live Testnet test results are listed above. Coinbase websocket setup logged connection retries during the full suite; those test results did not fail.

These are software regressions and Regtest evidence; they are not Testnet funding qualification. Live Testnet checks remained read-only and no signing/broadcast path was enabled.

