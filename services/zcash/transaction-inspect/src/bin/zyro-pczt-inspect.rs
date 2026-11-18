//! Read-only diagnostics. A digest is NOT permission to sign a transaction.
use pczt::Pczt;
use std::io::Read;
use zcash_primitives::transaction::{
    TxVersion, sighash::SignableInput, sighash_v5::v5_signature_hash,
    sighash_v6::v6_signature_hash, txid::TxIdDigester,
};

fn inspect(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let pczt = Pczt::parse(bytes).map_err(|_| "Malformed or incompatible PCZT")?;
    // Upstream parsing permits a trailing suffix. This diagnostic deliberately
    // accepts only the exact canonical serialization, so extra bytes cannot be
    // interpreted differently by a subsequent consumer.
    if pczt
        .clone()
        .serialize()
        .map_err(|_| "Cannot serialize PCZT")?
        != bytes
    {
        return Err("Noncanonical PCZT or trailing data".into());
    }
    let consensus_branch_id = *pczt.global().consensus_branch_id();
    let tx = pczt
        .into_effects()
        .map_err(|_| "Incomplete transaction effects")?;
    let parts = tx.digest(TxIdDigester);
    let (version, digest) = match tx.version() {
        TxVersion::V6 => (6, v6_signature_hash(&tx, &SignableInput::Shielded, &parts)),
        TxVersion::V5 => (5, v5_signature_hash(&tx, &SignableInput::Shielded, &parts)),
        _ => return Err("Unsupported transaction version".into()),
    };
    Ok(serde_json::json!({
        "transactionVersion": version,
        "consensusBranchId": format!("{consensus_branch_id:08x}"),
        "shieldedSighash": hex::encode(digest.as_ref()),
        "digestSource": "PCZT transaction effects, not coordinator metadata",
        "authorizationAllowed": false,
        "reason": "Diagnostic only: network, disclosures, commitments, escrow ownership, funding, consent, outcome and replay policy have not been verified",
        "privateMaterialEmitted": false
    }))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // No RPC, wallet access, key loading, signing or broadcast capability.
    let mut bytes = Vec::new();
    std::io::stdin().take(2_000_001).read_to_end(&mut bytes)?;
    if bytes.len() > 2_000_000 {
        return Err("PCZT exceeds diagnostic size limit".into());
    }
    println!("{}", inspect(&bytes)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &[u8] = include_bytes!("../../tests/fixtures/ironwood_v6.pczt");
    #[test]
    fn reproduces_upstream_on_chain_v6_sighash_without_authorizing_redacted_data() {
        let result = inspect(FIXTURE).unwrap();
        assert_eq!(result["transactionVersion"], 6);
        assert_eq!(
            result["shieldedSighash"],
            "7d48149e6ae74a301bc74c7e1a5af48c52c0d20550a086899db07555e73f53a5"
        );
        assert_eq!(result["authorizationAllowed"], false);
        let tx = Pczt::parse(FIXTURE).unwrap().into_effects().unwrap();
        let wrong = v5_signature_hash(&tx, &SignableInput::Shielded, &tx.digest(TxIdDigester));
        assert_ne!(
            hex::encode(wrong.as_ref()),
            result["shieldedSighash"].as_str().unwrap()
        );
    }
    #[test]
    fn rejects_malformed_and_trailing_data() {
        for bytes in [&b""[..], &b"PCZT"[..], &b"{\"allowed\":true}"[..]] {
            assert!(inspect(bytes).is_err());
        }
        let mut trailing = FIXTURE.to_vec();
        trailing.push(0);
        assert!(inspect(&trailing).is_err());
    }
}
