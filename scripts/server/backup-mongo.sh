#!/usr/bin/env bash
set -euo pipefail

: "${MONGO_URI:?MONGO_URI is required}"
: "${MONGO_DB:?MONGO_DB is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sirlocked}"
KEEP="${KEEP:-14}"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "KEEP must be a positive integer." >&2; exit 2; }
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/sirlocked-${timestamp}.archive.gz"

mongodump --uri "$MONGO_URI" --db "$MONGO_DB" --archive="$archive" --gzip
(cd "$BACKUP_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
mapfile -t old_archives < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'sirlocked-*.archive.gz' -printf '%T@ %p\n' | sort -nr | tail -n "+$((KEEP + 1))" | cut -d' ' -f2-)
for old in "${old_archives[@]}"; do
  rm -f -- "$old" "$old.sha256"
done
printf 'Backup created: %s\n' "$archive"
