//! Decode public transaction bytes and compute their actual Zcash txid using librustzcash.
//! This does not check proofs, wallet ownership, amounts or consensus inclusion.
use std::io::{Cursor, Read};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BlockHeight, BranchId, Network};
fn inspect(input: &serde_json::Value) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if input["network"] != "testnet" {
        return Err("This parser bridge is restricted to public testnet".into());
    }
    let bytes = hex::decode(input["txHex"].as_str().ok_or("txHex required")?)?;
    let height = input["height"].as_u64().map(u32::try_from).transpose()?;
    let branch = height
        .map(|h| BranchId::for_height(&Network::TestNetwork, BlockHeight::from_u32(h)))
        .unwrap_or(BranchId::Nu5);
    let mut cursor = Cursor::new(&bytes);
    let tx = Transaction::read(&mut cursor, branch)?;
    if cursor.position() != bytes.len() as u64 {
        return Err("Trailing transaction bytes".into());
    }
    Ok(
        serde_json::json!({"txid":tx.txid().to_string(),"transparentInputs":tx.transparent_bundle().map(|b|b.vin.len()).unwrap_or(0),"transparentOutputs":tx.transparent_bundle().map(|b|b.vout.len()).unwrap_or(0),"saplingOutputs":tx.sapling_bundle().map(|b|b.shielded_outputs().len()).unwrap_or(0),"orchardActions":tx.orchard_bundle().map(|b|b.actions().len()).unwrap_or(0),"ironwoodActions":tx.ironwood_bundle().map(|b|b.actions().len()).unwrap_or(0),"decodedBy":"librustzcash eb38d7a373661179dbc083a2fd58b3a6c9b25818","consensusProofsVerified":false}),
    )
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin()
        .take(2_100_000)
        .read_to_string(&mut input)?;
    let request = serde_json::from_str(&input)?;
    println!("{}", inspect(&request)?);
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn refuses_mainnet_and_invalid_transactions() {
        assert!(super::inspect(&serde_json::json!({"network":"mainnet","txHex":""})).is_err());
        assert!(super::inspect(&serde_json::json!({"network":"testnet","txHex":"00"})).is_err());
    }
}
