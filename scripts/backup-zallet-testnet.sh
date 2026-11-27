#!/usr/bin/env bash
set -euo pipefail

# Build a single encrypted recovery artifact. The wallet owner must copy the
# resulting .age file to a separate physical device and verify its checksum.
ZALLET_BIN="${ZALLET_BIN:-/home/kuldeep/.local/state/zyro-testnet/bin/zallet-v0.1.0-beta.4-linux-amd64/zallet}"
WALLET_DIR="${WALLET_DIR:-/home/kuldeep/.local/state/zyro-testnet-custody/zallet}"
WALLET_CONFIG="${WALLET_CONFIG:-$WALLET_DIR/zallet.toml}"
WALLET_BACKUPS="${WALLET_BACKUPS:-/home/kuldeep/.local/state/zyro-testnet-custody/backups}"
AGE_IDENTITY="${AGE_IDENTITY:-/home/kuldeep/.local/state/zyro-testnet-custody/backups/encryption-identity.txt}"
AGE_MNEMONIC="${AGE_MNEMONIC:-/home/kuldeep/.local/state/zyro-testnet-custody/backups/operator-mnemonic.age}"

fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ -x "$ZALLET_BIN" ]] || fail "Pinned Zallet binary not found"
[[ -f "$WALLET_CONFIG" && -f "$AGE_IDENTITY" && -f "$AGE_MNEMONIC" ]] || fail "Required wallet config or encrypted recovery artifact missing"
command -v age >/dev/null || fail "Install the Ubuntu age package first"
[[ "$("$ZALLET_BIN" --version)" == "zallet 0.1.0-beta.4" ]] || fail "Unexpected Zallet version"
if pgrep -x zallet-zebra >/dev/null || pgrep -x zallet >/dev/null; then
  fail "Stop Zallet before snapshotting its wallet database"
fi
[[ -d /dev/shm && "$(df -Pk /dev/shm | awk 'NR==2 {print $4}')" -gt 131072 ]] || fail "Insufficient memory-backed temporary storage"

umask 077
mkdir -p "$WALLET_BACKUPS"
STAGE="$(mktemp -d /dev/shm/zyro-zallet-backup.XXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT HUP INT TERM
chmod 700 "$STAGE"
mkdir -m 700 "$STAGE/package"

# Zallet creates a consistent snapshot and never overwrites an existing file.
"$ZALLET_BIN" -d "$WALLET_DIR" -c "$WALLET_CONFIG" backup "$STAGE/package/wallet.db"
cp "$AGE_MNEMONIC" "$STAGE/package/operator-mnemonic.age"
cp "$WALLET_CONFIG" "$STAGE/package/zallet.toml"
printf '%s\n' 'Zallet 0.1.0-beta.4; network test; wallet datadir preserved by owner' > "$STAGE/package/RECOVERY.txt"

# The identity receives its own passphrase, independent from the outer archive.
age -p -o "$STAGE/package/encryption-identity.txt.age" "$AGE_IDENTITY"
(cd "$STAGE/package" && sha256sum wallet.db operator-mnemonic.age zallet.toml encryption-identity.txt.age RECOVERY.txt > SHA256SUMS)
tar -C "$STAGE/package" -cf "$STAGE/recovery.tar" .

OUT="$WALLET_BACKUPS/zyro-testnet-custody-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
[[ ! -e "$OUT" ]] || fail "Refusing to overwrite an existing recovery artifact"
# The outer passphrase must also be independent of the identity passphrase.
age -p -o "$OUT" "$STAGE/recovery.tar"
chmod 600 "$OUT"
# Verify the outer package and independent identity encryption locally before
# asking the owner to copy the artifact off-host. All plaintext stays in tmpfs.
age -d -o "$STAGE/verify.tar" "$OUT"
mkdir -m 700 "$STAGE/verify"
tar -C "$STAGE/verify" -xf "$STAGE/verify.tar"
(cd "$STAGE/verify" && sha256sum -c SHA256SUMS >/dev/null)
age -d -o "$STAGE/verify/encryption-identity.txt" "$STAGE/verify/encryption-identity.txt.age"
cmp -s "$AGE_IDENTITY" "$STAGE/verify/encryption-identity.txt" || fail "Recovery identity verification failed"
printf 'Encrypted recovery artifact: %s\n' "$OUT"
sha256sum "$OUT"
printf '%s\n' "Copy this one .age file to a separate physical device, then compare its SHA-256 there. Keep both passphrases in a password manager; never store them beside the artifact."
