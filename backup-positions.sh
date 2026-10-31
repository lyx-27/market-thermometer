#!/bin/bash
# ============================================================================
#  Encrypted backup / restore for positions.json (your real buy records).
#
#    ./backup-positions.sh backup     # encrypt positions.json -> backup dir
#    ./backup-positions.sh list       # list existing backups
#    ./backup-positions.sh restore    # decrypt the newest backup
#    ./backup-positions.sh restore <file>
#    ./backup-positions.sh passphrase # print the passphrase (to store elsewhere)
#
#  Why this exists:
#    positions.json holds real amounts and cost basis, so it is gitignored and
#    therefore has NO backup. This repo is PUBLIC, so the file must not be
#    committed even encrypted -- a public encrypted blob is permanently
#    harvestable and git history cannot be truly erased. So backups are written
#    OUTSIDE the repo instead.
#
#  Crypto: AES-256-CBC with PBKDF2 (openssl). The passphrase is generated once
#  and kept in the macOS Keychain, which is itself encrypted and tied to your
#  login -- it is never written to disk in plaintext by this script.
#
#  IMPORTANT: the backup is only recoverable while that Keychain entry exists.
#  Run `./backup-positions.sh passphrase` and keep a copy in your password
#  manager, or a wiped/reinstalled Mac means the backups are unreadable.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

SRC="positions.json"
BACKUP_DIR="$HOME/.market-thermometer-backups"   # deliberately outside the repo
KC_SERVICE="market-thermometer-positions"
KC_ACCOUNT="$(whoami)"

get_passphrase() {
  local pass
  if pass=$(security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w 2>/dev/null); then
    printf '%s' "$pass"
    return 0
  fi
  # first run: generate a strong passphrase and store it in the Keychain
  pass=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)
  security add-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w "$pass" \
    -D "market-thermometer positions backup key" -U >/dev/null
  echo "Generated a new passphrase and stored it in your Keychain." >&2
  echo "Keep a copy somewhere safe: ./backup-positions.sh passphrase" >&2
  printf '%s' "$pass"
}

case "${1:-backup}" in
  backup)
    [ -f "$SRC" ] || { echo "No $SRC to back up."; exit 1; }
    mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
    OUT="$BACKUP_DIR/positions-$(date +%Y%m%d-%H%M%S).json.enc"
    PASS="$(get_passphrase)"
    # passphrase goes in via fd 3: keeps it out of argv AND out of the environment
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -in "$SRC" -out "$OUT" -pass fd:3 3<<<"$PASS"
    chmod 600 "$OUT"
    # verify the backup actually decrypts back to the original before claiming success
    if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$OUT" -pass fd:3 3<<<"$PASS" 2>/dev/null \
         | diff -q - "$SRC" >/dev/null; then
      echo "Backed up and verified: $OUT"
    else
      echo "Backup FAILED verification, removing: $OUT"; rm -f "$OUT"; unset PASS; exit 1
    fi
    unset PASS
    # keep the 20 most recent
    ls -1t "$BACKUP_DIR"/positions-*.json.enc 2>/dev/null | tail -n +21 | xargs -I{} rm -f {}
    ;;

  list)
    ls -lht "$BACKUP_DIR"/positions-*.json.enc 2>/dev/null || echo "No backups yet."
    ;;

  restore)
    FILE="${2:-$(ls -1t "$BACKUP_DIR"/positions-*.json.enc 2>/dev/null | head -1)}"
    [ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No backup found."; exit 1; }
    PASS="$(get_passphrase)"
    TMP=$(mktemp)
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP" -pass fd:3 3<<<"$PASS" 2>/dev/null; then
      rm -f "$TMP"; unset PASS; echo "Decryption failed (wrong or missing Keychain passphrase)."; exit 1
    fi
    unset PASS
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP" \
      || { rm -f "$TMP"; echo "Decrypted file is not valid JSON, aborting."; exit 1; }
    [ -f "$SRC" ] && cp "$SRC" "$SRC.before-restore"
    mv "$TMP" "$SRC"
    echo "Restored $SRC from $FILE"
    [ -f "$SRC.before-restore" ] && echo "(previous file kept as $SRC.before-restore)"
    ;;

  passphrase)
    echo "Store this in your password manager — without it the backups are unreadable:"
    get_passphrase; echo
    ;;

  *)
    sed -n '2,12p' "$0"; exit 1
    ;;
esac
