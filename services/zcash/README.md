# Zcash integration boundary

Two executable Rust components are delivered: the isolated RedPallas rerandomized-FROST lab in this directory and the read-only transaction decoder in `transaction-inspect/`. Both use existing upstream primitives and have committed lockfiles. Rust/Cargo are available in WSL. Do not substitute browser Ed25519 agreement signatures for Zcash FROST spend authorization.

The working read-only RPC adapter is `apps/api/src/zcash.ts`. It only queries chain identity and transaction state. Planned Rust responsibilities: validated testnet address decoding, authenticated note recognition, PCZT construction/inspection, standard maintained rerandomized FROST signing, proofs/finalization and broadcast. Each needs real regtest/testnet validation before enabling funds.

See `docs/zcash-integration.md` for evaluated upstream tools and compatibility constraints.
