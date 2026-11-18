# Public upstream fixture

`ironwood_v6.pczt` is copied without modification from ZcashFoundation/frost-tools,
commit `53df99c2bd61f7cb60a0d1f634822a76be3799cf`,
`zcash-sign/tests/fixtures/ironwood_v6.pczt`. The upstream MIT license is included.

Upstream removed FVKs, note randomness, derivation paths, dummy secret keys,
recipients and amounts before publication. This is a public transaction-effects
regression fixture, never a ZYRO wallet or a ZYRO settlement proposal.

Its corresponding upstream transaction is
`a5533fe75575b09d8986a05005d2c0528cf45a1a7e4cc71b304ae76a9e14487d`.
See https://github.com/ZcashFoundation/frost-tools/issues/591.
It can establish digest compatibility but cannot authorize a payout: essential
shielded disclosures are missing. Do not infer verified output policy from a
successful parse or matching digest.
