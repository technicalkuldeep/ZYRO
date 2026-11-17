#!/usr/bin/env bash
# Isolated developer-custodied testnet wallet. Never use for user funds or mainnet.
set -euo pipefail
umask 077
ZYRO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVTOOL="$ZYRO_ROOT/.local/zcash-devtool/target/release/zcash-devtool"
WALLET_DIR="$ZYRO_ROOT/.local/testnet-wallet"
IDENTITY="$WALLET_DIR/identity.txt"
if [[ ! -x "$DEVTOOL" ]]; then echo 'Build the pinned zcash-devtool first.' >&2; exit 1; fi
mkdir -p "$WALLET_DIR"
case "${1:-}" in
 init)
   "$DEVTOOL" wallet -w "$WALLET_DIR" init --name zyro-isolated-testnet-demo --identity "$IDENTITY" -n test < /dev/null
   ;;
 info|sync|balance)
   action="$1"; [[ "$action" == info ]] && action=get-info
   "$DEVTOOL" wallet -w "$WALLET_DIR" "$action"
   ;;
 address)
   "$DEVTOOL" wallet -w "$WALLET_DIR" generate-address --pool orchard
   ;;
 history)
   "$DEVTOOL" wallet -w "$WALLET_DIR" list-tx --json
   ;;
 send)
   recipient="${2:?shielded testnet recipient required}"
   amount="${3:-1000000}"
   memo="${4:-ZYRO testnet transfer demonstration; no market escrow}"
   [[ ${#memo} -le 512 ]] || { echo 'Memo too long' >&2;exit 1; }
   case "$recipient" in utest1*|ztestsapling1*) ;; *) echo 'Shielded testnet recipient required' >&2;exit 1;; esac
   [[ "$amount" =~ ^[0-9]+$ && ${#amount} -le 9 && "$amount" -ge 10000 && "$amount" -le 100000000 ]] || { echo 'Invalid testnet integer amount' >&2;exit 1; }
   RUST_LOG=off "$DEVTOOL" wallet -w "$WALLET_DIR" get-info | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["chain_name"] in ("test","testnet"), "Refusing non-testnet service"'
   # One confirmation is explicit for this valueless testnet demo only.
   "$DEVTOOL" wallet -w "$WALLET_DIR" send --identity "$IDENTITY" --address "$recipient" --value "$amount" --memo "$memo" --min-confirmations 1
   ;;
 *) echo 'Usage: testnet-wallet.sh init|info|address|sync|balance|history|send SHIELDED_TESTNET_ADDRESS [ZATOSHIS]' >&2;exit 1;;
esac
