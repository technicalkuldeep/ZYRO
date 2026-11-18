//! Copy into frost-tools/zcash-sign/examples/zyro-compat.rs; diagnostic only.
//! Never prints PCZT disclosures, randomizers, keys, or parse error internals.
use pczt::Pczt;
use zcash_primitives::transaction::{
    sighash::SignableInput, sighash_v6::v6_signature_hash, txid::TxIdDigester, TxVersion,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("PCZT path required")?;
    let bytes = std::fs::read(path)?;
    let pczt = match Pczt::parse(&bytes) {
        Ok(pczt) => pczt,
        Err(_) => {
            println!("{{\"pcztCrate\":\"0.8.0-rc.1\",\"parseCompatible\":false,\"authorizationAllowed\":false}}");
            return Ok(());
        }
    };
    let effects = match pczt.into_effects() {
        Ok(effects) => effects,
        Err(error) => {
            let category = match error {
                pczt::ExtractError::UnknownConsensusBranchId => "UnknownConsensusBranchId",
                pczt::ExtractError::UnsupportedConsensusBranchId => "UnsupportedConsensusBranchId",
                pczt::ExtractError::UnsupportedTxVersion { .. } => "UnsupportedTxVersion",
                pczt::ExtractError::IronwoodParse(_) => "IronwoodParse",
                pczt::ExtractError::OrchardParse(_) => "OrchardParse",
                pczt::ExtractError::IronwoodExtract(_) => "IronwoodExtract",
                _ => "OtherEffectsExtractionError",
            };
            println!(
                "{}",
                serde_json::json!({"pcztCrate":"0.8.0-rc.1", "parseCompatible":true, "effectsCompatible":false, "errorCategory":category, "authorizationAllowed":false})
            );
            return Ok(());
        }
    };
    if effects.version() != TxVersion::V6 {
        return Err("This compatibility probe expects v6".into());
    }
    let digest = v6_signature_hash(
        &effects,
        &SignableInput::Shielded,
        &effects.digest(TxIdDigester),
    );
    println!(
        "{}",
        serde_json::json!({"pcztCrate":"0.8.0-rc.1", "parseCompatible":true, "shieldedSighash":hex::encode(digest.as_ref()), "authorizationAllowed":false})
    );
    Ok(())
}
