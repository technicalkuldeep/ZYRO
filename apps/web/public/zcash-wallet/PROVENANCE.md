# Pinned wallet engine

The files in `engine/` were copied from NoirWallet/noir-wallet commit
`db5457327d082b38b9d2617d35cbb5693d6145f5`,
`packages/extension/src/lib/wasm-pkg/`.
The upstream manifest identifies WASM source commit
`cb8da9dc60d51dbf3958657be35427210d544541` in
https://github.com/NoirWallet/zcash-wallet-wasm.

All eight files listed in `engine/wasm-integrity.json` matched their declared
SHA-256 checksums before copying. Text line-ending conversion by Git was reversed
where necessary to recover the exact artifact bytes. No vendor file was patched.
`THIRD_PARTY_NOTICES.md` was additionally obtained from that exact source commit.

The binary is 66,472,202 bytes. Its SHA-256 is
`0b83c3963486310a881a1ebdd24d241c0e595496b60aa1b154c853ad47f71a8e`.
The dedicated worker checks this hash again before instantiation. Unit tests
check the binary and exercise real address derivation and decoding.

These checks establish artifact integrity relative to upstream's manifest.
They do not establish independent source-to-binary reproducibility or constitute
a security audit. The published older BlockSec audit does not cover this exact
current artifact and host integration.

Noir-owned engine code is BUSL-1.1, with no Additional Use Grant before the
2029-01-01 change date. Use this integration for non-production development;
obtain the applicable license before production deployment. See the unmodified
LICENSE.md and THIRD_PARTY_NOTICES.md for full terms and upstream notices.
