//! Real RedPallas rerandomized FROST, isolated from wallets and transaction signing.
//! All three DKG participant states are held in one lab process. No shares are printed.
use reddsa::frost::redpallas as frost;
use std::collections::BTreeMap;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
type Keys = BTreeMap<frost::Identifier, frost::keys::KeyPackage>;

fn distributed_keygen() -> Result<(Keys, frost::keys::PublicKeyPackage)> {
    let mut rng = rand::rngs::OsRng;
    let ids: Vec<frost::Identifier> = (1u16..=3).map(|i| i.try_into().unwrap()).collect();
    let mut secrets1 = BTreeMap::new();
    let mut broadcasts = BTreeMap::new();
    for id in &ids {
        let (secret, public) = frost::keys::dkg::part1(*id, 3, 2, &mut rng)?;
        secrets1.insert(*id, secret);
        broadcasts.insert(*id, public);
    }
    let mut secrets2 = BTreeMap::new();
    let mut deliveries = BTreeMap::new();
    for id in &ids {
        let received = broadcasts
            .iter()
            .filter(|(sender, _)| *sender != id)
            .map(|(sender, package)| (*sender, package.clone()))
            .collect();
        let (secret, outgoing) = frost::keys::dkg::part2(secrets1.remove(id).unwrap(), &received)?;
        secrets2.insert(*id, secret);
        deliveries.insert(*id, outgoing);
    }
    let mut keys = BTreeMap::new();
    let mut group = None;
    for id in &ids {
        let received1 = broadcasts
            .iter()
            .filter(|(sender, _)| *sender != id)
            .map(|(sender, package)| (*sender, package.clone()))
            .collect();
        let received2 = deliveries
            .iter()
            .filter(|(sender, _)| *sender != id)
            .map(|(sender, packages)| (*sender, packages[id].clone()))
            .collect();
        let (key, public) = frost::keys::dkg::part3(&secrets2[id], &received1, &received2)?;
        if let Some(previous) = &group {
            assert_eq!(previous, &public);
        }
        keys.insert(*id, key);
        group = Some(public);
    }
    Ok((keys, group.unwrap()))
}

fn sign_pair(
    keys: &Keys,
    group: &frost::keys::PublicKeyPackage,
    selected: [u16; 2],
    message: &[u8],
) -> Result<serde_json::Value> {
    let mut rng = rand::rngs::OsRng;
    let mut nonces = BTreeMap::new();
    let mut commitments = BTreeMap::new();
    for number in selected {
        let id = number.try_into()?;
        let (secret, public) = frost::round1::commit(keys[&id].signing_share(), &mut rng);
        nonces.insert(id, secret);
        commitments.insert(id, public);
    }
    let package = frost::SigningPackage::new(commitments, message);
    let params = frost::RandomizedParams::new(group.verifying_key(), &package, &mut rng)?;
    let mut shares = BTreeMap::new();
    for number in selected {
        let id = number.try_into()?;
        let key = &keys[&id];
        let nonce = nonces.remove(&id).unwrap(); // Consume each nonce exactly once.
        shares.insert(
            id,
            frost::round2::sign(&package, &nonce, key, *params.randomizer())?,
        );
    }
    let only_one = shares
        .iter()
        .take(1)
        .map(|(id, share)| (*id, share.clone()))
        .collect();
    assert!(frost::aggregate(&package, &only_one, group, &params).is_err());
    let signature = frost::aggregate(&package, &shares, group, &params)?;
    let verifying_key = params.randomized_verifying_key();
    verifying_key.verify(message, &signature)?;
    assert!(verifying_key
        .verify(b"altered authorization", &signature)
        .is_err());
    // Verify the same signature using RedDSA Orchard spend-authorization primitives.
    let encoded_key: [u8; 32] = verifying_key
        .serialize()?
        .try_into()
        .map_err(|_| "key length")?;
    let encoded_signature: [u8; 64] = signature
        .serialize()?
        .try_into()
        .map_err(|_| "signature length")?;
    let red_key = reddsa::VerificationKey::<reddsa::orchard::SpendAuth>::try_from(encoded_key)?;
    let red_signature = reddsa::Signature::<reddsa::orchard::SpendAuth>::from(encoded_signature);
    red_key.verify(message, &red_signature)?;
    Ok(
        serde_json::json!({"participants":selected,"randomizedPublicKey":hex::encode(encoded_key),"signature":hex::encode(encoded_signature),"verified":true,"orchardRedDsaVerified":true,"singleShareRejected":true,"alteredMessageRejected":true}),
    )
}

fn demonstration() -> Result<serde_json::Value> {
    let (keys, group) = distributed_keygen()?;
    assert_eq!(keys.len(), 3);
    // A domain-separated lab message, NOT a transaction sighash.
    let message = b"ZYRO isolated RedPallas FROST lab v1; not a Zcash transaction";
    let mut pairs = Vec::new();
    for selected in [[1, 2], [1, 3], [2, 3]] {
        pairs.push(sign_pair(&keys, &group, selected, message)?);
    }
    Ok(
        serde_json::json!({"scope":"isolated-cryptographic-demonstration","networkTransaction":false,"custody":"all participant states in one development process","keyGeneration":"three-party DKG","threshold":2,"participants":3,"groupPublicKey":hex::encode(group.verifying_key().serialize()?),"messageHex":hex::encode(message),"pairs":pairs}),
    )
}

fn main() -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&demonstration()?)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn real_dkg_all_threshold_pairs_and_rejection_cases() {
        let evidence = super::demonstration().unwrap();
        assert_eq!(evidence["pairs"].as_array().unwrap().len(), 3);
        assert_eq!(evidence["networkTransaction"], false);
    }
}
