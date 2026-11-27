# Zallet Testnet custody recovery

This applies only to the dedicated Testnet wallet at
`/home/kuldeep/.local/state/zyro-testnet-custody/zallet`. It does not apply to
the Regtest wallet, browser wallet, or Mainnet.

## Create one password-encrypted recovery artifact

The pinned binary is Zallet `0.1.0-beta.4`. It must be stopped while the
consistent snapshot is created. The script uses the official Ubuntu `age`
package, creates a fresh Zallet database snapshot, packages that snapshot with
the encrypted mnemonic and Testnet config, and encrypts the age identity with
its own independent passphrase before encrypting the package with a second
passphrase. Both prompts are interactive; neither passphrase is put in shell
history or command arguments. Temporary plaintext staging is under `/dev/shm`.

In a private Ubuntu/WSL terminal, install `age` if it is absent:

```bash
sudo apt-get update
sudo apt-get install -y age
```

Stop Zallet, then run from the repository root:

```bash
bash scripts/backup-zallet-testnet.sh
```

The script prints the encrypted `.tar.age` path and SHA-256. It does not print
or decrypt the recovery phrase. Store both passphrases separately in a password
manager. Keep them distinct. Never put either password on the removable device.

Copy the single generated `.tar.age` file to a separate physical device. That
device may use its own full-disk encryption as an additional layer. Compare the
SHA-256 of the source and copied file; they must match. Eject the device and
keep it separate from this machine. This off-host copy is not considered
verified until the owner performs that copy and comparison.

To test recoverability locally without displaying secrets, decrypt into
memory-backed `/dev/shm`, list archive filenames only, and compare the wallet
snapshot and encrypted mnemonic against their sources. The age identity inside
the archive has its own passphrase. Do not print archive file contents or the
identity. Remove temporary files after verification. Secure deletion cannot be
guaranteed on SSD or copy-on-write storage; `/dev/shm` avoids persistent
plaintext staging.

## Confirm the mnemonic backup

Only the wallet owner should view and record the recovery phrase. In a private
terminal, decrypt the existing mnemonic export using the local identity and
record it offline. Do not copy it to chat, shell history, logs, screenshots, or
the repository. The Zallet service must be stopped before this interactive
check:

```bash
/home/kuldeep/.local/state/zyro-testnet/bin/zallet-v0.1.0-beta.4-linux-amd64/zallet \
  -d /home/kuldeep/.local/state/zyro-testnet-custody/zallet \
  -c /home/kuldeep/.local/state/zyro-testnet-custody/zallet/zallet.toml \
  confirm-backup
```

The installed beta.4 `--help` confirms this command; it asks for selected
mnemonic word positions without printing the phrase. Do not disable
`keystore.require_backup`. After successful confirmation, create another fresh
encrypted backup before deriving an account or receiving funds.

## Current local state

The wallet database, local age identity, encrypted mnemonic export, config, and
a fresh Zallet snapshot exist locally with owner-only permissions. This is not
an off-host backup. The recovery phrase confirmation and custody account
creation have not been reported successful. The current Zebra Testnet process
was found by host-level inspection as PID 174874; it owns the existing state
lock and must not be duplicated. Its sync progress is reported separately from
the wallet's synchronization state.

Never expose RPC cookies, wallet keys, or the wallet RPC port publicly. Zallet
beta.4 is a prototype wallet; do not rely on it for privacy or significant
funds.
