//! Offline checks of the Milestone 1D proposal against operator-prepared evidence.
//! A successful result does not qualify a deposit or authorize a signature.

use orchard::{
    keys::{FullViewingKey, PreparedIncomingViewingKey, Scope},
    note_encryption::IronwoodDomain,
};
use pczt::{
    Pczt,
    roles::verifier::{OrchardError, Verifier},
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};
use zcash_address::unified::{Address, Container, Encoding, Fvk, Receiver, Ufvk};
use zcash_note_encryption::try_note_decryption;
use zcash_primitives::transaction::{
    Transaction, TxVersion,
    sighash::SignableInput,
    sighash_v6::v6_signature_hash,
    txid::{TxIdDigester, to_txid},
};
use zcash_protocol::consensus::{BranchId, NetworkType};

const REFUND: u64 = 1_000_000;
const RESERVE: u64 = 50_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Evidence {
    recipient: String,
    payer_fvk: String,
    custody_fvk: String,
    notes: BTreeMap<String, u64>,
    max_fee: u64,
}

fn viewing_key(key: &str) -> Option<FullViewingKey> {
    let (network, _, key) = Ufvk::decode(key).ok()?;
    if network != NetworkType::Regtest {
        return None;
    }
    key.items().iter().find_map(|item| match item {
        Fvk::Orchard(raw) => FullViewingKey::from_bytes(raw),
        _ => None,
    })
}

fn check(bytes: &[u8], mut evidence: Evidence) -> Result<serde_json::Value, String> {
    let (network, _, recipient) =
        Address::decode(&evidence.recipient).map_err(|_| "Invalid recipient")?;
    let items = recipient.items();
    let [Receiver::Orchard(receiver)] = items.as_slice() else {
        return Err("Expected Orchard-only receiver".into());
    };
    let receiver = *receiver;
    if network != NetworkType::Regtest {
        return Err("Expected Regtest recipient".into());
    }
    let payer = viewing_key(&evidence.payer_fvk).ok_or("Invalid payer Regtest viewing key")?;
    let custody =
        viewing_key(&evidence.custody_fvk).ok_or("Invalid custody Regtest viewing key")?;
    let payment_key = PreparedIncomingViewingKey::new(&payer.to_ivk(Scope::External));
    let change_key = PreparedIncomingViewingKey::new(&custody.to_ivk(Scope::Internal));
    let pczt = Pczt::parse(bytes).map_err(|_| "PCZT parse failed")?;
    if pczt
        .clone()
        .serialize()
        .map_err(|_| "PCZT serialization failed")?
        != bytes
    {
        return Err("Noncanonical PCZT".into());
    }
    if *pczt.global().consensus_branch_id() != 0x77190ad9 || *pczt.global().coin_type() != 1 {
        return Err("Unexpected PCZT branch or coin type".into());
    }
    if evidence.notes.len() != 2
        || !evidence.notes.values().any(|&v| v == REFUND)
        || !evidence.notes.values().any(|&v| v == RESERVE)
        || !(1..=RESERVE).contains(&evidence.max_fee)
    {
        return Err("Missing reserved deposit or fee note".into());
    }
    let tx = pczt
        .clone()
        .into_effects()
        .map_err(|_| "PCZT effects extraction failed")?;
    if tx.version() != TxVersion::V6
        || tx.transparent_bundle().is_some()
        || tx.sprout_bundle().is_some()
        || tx.sapling_bundle().is_some()
        || tx.orchard_bundle().is_some()
    {
        return Err("Expected Ironwood-only v6 effects".into());
    }
    let effects = tx.ironwood_bundle().ok_or("Missing Ironwood effects")?;
    let mut input_total = 0;
    let mut change = 0;
    let mut payment_count = 0;
    let mut change_count = 0;
    Verifier::new(pczt)
        .with_ironwood(|bundle| {
            if bundle.actions().len() != effects.actions().len() {
                return Err(OrchardError::Custom("Action count mismatch"));
            }
            bundle.verify_cross_address_restriction()?;
            for (action, effect) in bundle.actions().iter().zip(effects.actions().iter()) {
                action.verify_cv_net()?;
                let spend = action.spend();
                let value = spend
                    .value()
                    .ok_or(OrchardError::Custom("Missing input value"))?
                    .inner();
                if value != 0 {
                    if evidence
                        .notes
                        .remove(&hex::encode(spend.nullifier().to_bytes()))
                        != Some(value)
                    {
                        return Err(OrchardError::Custom("Unexpected or duplicate input"));
                    }
                    spend.verify_nullifier(Some(&custody))?;
                    spend.verify_rk(Some(&custody))?;
                    input_total += value;
                } else if spend.spend_auth_sig().is_none() {
                    return Err(OrchardError::Custom("Unsigned zero-valued spend"));
                }
                let output = action.output();
                output.verify_note_commitment(spend)?;
                let value = output
                    .value()
                    .ok_or(OrchardError::Custom("Missing output value"))?
                    .inner();
                if value == 0 {
                    continue;
                }
                let domain = IronwoodDomain::for_action(effect);
                if let Some((note, address, _)) = try_note_decryption(&domain, &payment_key, effect)
                {
                    if value != REFUND
                        || note.value().inner() != value
                        || address.to_raw_address_bytes() != receiver
                    {
                        return Err(OrchardError::Custom("Unexpected payer output"));
                    }
                    payment_count += 1;
                } else if let Some((note, address, _)) =
                    try_note_decryption(&domain, &change_key, effect)
                {
                    if note.value().inner() != value
                        || custody.scope_for_address(&address) != Some(Scope::Internal)
                    {
                        return Err(OrchardError::Custom("Unexpected change"));
                    }
                    change += value;
                    change_count += 1;
                } else {
                    return Err(OrchardError::Custom("Unexpected nonzero output"));
                }
            }
            Ok(())
        })
        .map_err(|err| format!("Ironwood verifier rejected: {err:?}"))?;
    if !evidence.notes.is_empty() || payment_count != 1 || change_count > 1 {
        return Err("Inputs, payment or change do not match policy".into());
    }
    let fee = input_total
        .checked_sub(REFUND + change)
        .ok_or("Negative fee")?;
    if fee == 0
        || fee > evidence.max_fee
        || i64::try_from(fee).ok() != Some(i64::from(*effects.value_balance()))
    {
        return Err("Fee outside bounds or inconsistent with transaction effects".into());
    }
    let digests = tx.digest(TxIdDigester);
    let sighash = v6_signature_hash(&tx, &SignableInput::Shielded, &digests);
    Ok(serde_json::json!({
        "feeZat": fee,
        "paymentZat": REFUND,
        "changeZat": change,
        "sourceTotalZat": input_total,
        "shieldedSighash": hex::encode(sighash.as_ref()),
            "expiry": u32::from(tx.expiry_height()),
            "txid": to_txid(tx.version(), tx.consensus_branch_id(), &digests).to_string(),
            "anchor": hex::encode(effects.anchor().to_bytes()),
        "authorizationAllowed": false,
    }))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Expected private evidence path")?;
    let mut bytes = Vec::new();
    std::io::stdin().take(64_001).read_to_end(&mut bytes)?;
    if bytes.len() > 64_000 {
        return Err("PCZT exceeds limit".into());
    }
    if path == "--final" {
        let mut cursor = Cursor::new(&bytes);
        let tx = Transaction::read(&mut cursor, BranchId::Nu7)?;
        if cursor.position() != bytes.len() as u64
            || tx.version() != TxVersion::V6
            || tx.consensus_branch_id() != BranchId::Nu7
            || tx.transparent_bundle().is_some()
            || tx.sapling_bundle().is_some()
            || tx.orchard_bundle().is_some()
            || tx.ironwood_bundle().is_none()
        {
            return Err("Unexpected final transaction effects".into());
        }
        println!(
            "{}",
            serde_json::json!({
                "txid": tx.txid().to_string(),
                "expiry": u32::from(tx.expiry_height()),
                "anchor": hex::encode(tx.ironwood_bundle().unwrap().anchor().to_bytes()),
            })
        );
    } else {
        let evidence = serde_json::from_reader(std::fs::File::open(path)?.take(16_385))?;
        println!("{}", check(&bytes, evidence)?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    #[test]
    #[ignore = "requires private unsigned proposals from the live Regtest run"]
    fn checks_real_proposal_and_rejects_adverse_effects() {
        let dir = PathBuf::from(std::env::var_os("ZYRO_TAZ_REFUND_TEST_DIR").unwrap());
        let evidence = || {
            serde_json::from_reader::<_, Evidence>(
                fs::File::open(dir.join("refund-check-input.json")).unwrap(),
            )
            .unwrap()
        };
        let proposal = |name| fs::read(dir.join(name)).unwrap();
        let bytes = proposal("refund-unsigned.pczt");
        let verified = check(&bytes, evidence()).unwrap();
        assert_eq!(verified["feeZat"], 10_000);
        assert_eq!(verified["paymentZat"], REFUND);
        assert_eq!(verified["changeZat"], 40_000);
        assert_eq!(verified["authorizationAllowed"], false);

        for (name, message) in [
            ("wrong-value.pczt", "Unexpected payer output"),
            ("wrong-recipient.pczt", "Unexpected nonzero output"),
            ("extra-output.pczt", "Unexpected nonzero output"),
            ("foreign-input.pczt", "Unexpected or duplicate input"),
        ] {
            assert!(
                check(&proposal(name), evidence())
                    .unwrap_err()
                    .contains(message)
            );
        }

        let mut missing_reserve = evidence();
        missing_reserve.notes.retain(|_, value| *value != RESERVE);
        assert!(
            check(&bytes, missing_reserve)
                .unwrap_err()
                .contains("fee note")
        );
        let mut low_fee_cap = evidence();
        low_fee_cap.max_fee = 9_999;
        assert!(
            check(&bytes, low_fee_cap)
                .unwrap_err()
                .contains("Fee outside bounds")
        );
        let mut wrong_network = evidence();
        let (_, _, address) = Address::decode(&wrong_network.recipient).unwrap();
        wrong_network.recipient = address.encode(&NetworkType::Test);
        assert!(
            check(&bytes, wrong_network)
                .unwrap_err()
                .contains("Regtest recipient")
        );

        let tx = Pczt::parse(&bytes).unwrap().into_effects().unwrap();
        let payer = viewing_key(&evidence().payer_fvk).unwrap();
        let key = PreparedIncomingViewingKey::new(&payer.to_ivk(Scope::External));
        let action = tx
            .ironwood_bundle()
            .unwrap()
            .actions()
            .iter()
            .find(|action| {
                try_note_decryption(&IronwoodDomain::for_action(action), &key, *action).is_some()
            })
            .unwrap();
        let ciphertext = &action.encrypted_note().enc_ciphertext.0;
        let offset = bytes
            .windows(ciphertext.len())
            .position(|window| window == ciphertext)
            .unwrap();
        let mut tampered = bytes.clone();
        tampered[offset] ^= 1;
        assert!(Pczt::parse(&tampered).is_ok());
        assert!(
            check(&tampered, evidence())
                .unwrap_err()
                .contains("Unexpected nonzero output")
        );
    }
}
