# Roadmap and funding accounting

## Immediate bounty — November 27, 2026

P0: local integrated product foundation, persistent Markets and Arena, responsive design, tests and setup. Built before any funding decision on November 17, 2026; verification is recorded in implementation-status.md.

P1: a maintained developer-controlled testnet wallet was built, funded with TAZ, and used to construct/sign/broadcast a real shielded transfer. Public-testnet confirmation, decoded transaction structure, two exact-reference market funding notes and reproducible evidence are now verified. This is not a production self-custodial browser-wallet integration; PostgreSQL and Z3 regtest remain approval-dependent.

P2: real three-party DKG and 2-of-3 rerandomized RedPallas signatures are verified in isolation. Final participant/address/funding manifests with re-consent, objective outcome evidence, durable settlement states and compatible threshold-PCZT transaction signing remain. The normal Ironwood wallet transfers and the isolated FROST lab are separate; neither policy tests nor compatible signature primitives alone constitute escrow integration.

P3: completed verification, screenshots, demonstrable flow, CI and technical release notes. CI definition is provided; a local pass is not evidence that hosted CI has run.

## Proposed ZCG Phase 1 — $12,000

Proposal reference supplied by project owner: https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/562 . Budget and scope below are user-supplied; funding approval has not been asserted or verified.

| Milestone                | Proposed budget | Remaining funded-scope distinction                                                                |
| ------------------------ | --------------: | ------------------------------------------------------------------------------------------------- |
| Product Foundation       |          $2,500 | Existing pre-funding work must be disclosed; deployment hardening and verified integration remain |
| Shielded Escrow          |          $4,500 | Not integrated                                                                                    |
| Settlement Engine        |          $3,500 | Normalized policy groundwork exists; oracle, PCZT and actual execution remain                     |
| Public Technical Release |          $1,500 | Local source/docs exist; verified release and reproducibility remain                              |

No funds have been received or spent by this implementation. Do not bill already completed work as future implementation without explicit disclosure.

## Future Phase 2

Independent 3-of-5 signer infrastructure; multi-user markets; advanced liquidity; application metadata privacy and private matching research; conditional-payment SDK; independent audit; legal and security review before any real-value rollout. None is part of current MVP delivery.
