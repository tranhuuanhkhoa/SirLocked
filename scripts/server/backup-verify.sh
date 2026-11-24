#!/usr/bin/env bash
set -euo pipefail

: "${MONGO_URI:?MONGO_URI is required}"
: "${MONGO_DB:?MONGO_DB is required}"
[[ "$MONGO_DB" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "MONGO_DB contains unsupported characters." >&2; exit 2; }
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sirlocked}"
archive="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'sirlocked-*.archive.gz' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
[[ -n "$archive" ]] || { echo "No backup archive found." >&2; exit 1; }
scratch="${MONGO_DB}_restore_check"
[[ "$scratch" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Scratch database name contains unsupported characters." >&2; exit 2; }
cleanup() {
  mongosh "$MONGO_URI" --quiet --eval "db.getSiblingDB('$scratch').dropDatabase()" >/dev/null
}
trap cleanup EXIT
mongosh "$MONGO_URI" --quiet --eval "db.getSiblingDB('$scratch').dropDatabase()" >/dev/null
"$(dirname "$0")/restore-mongo.sh" "$archive" "$scratch" --yes
mongosh "$MONGO_URI" --quiet --eval "
const source = db.getSiblingDB('$MONGO_DB');
const restored = db.getSiblingDB('$scratch');
let mismatch = false;
const names = new Set([...source.getCollectionNames(), ...restored.getCollectionNames()]);
[...names].sort().forEach((name) => {
  const expected = source.getCollection(name).countDocuments({});
  const actual = restored.getCollection(name).countDocuments({});
  print(name + ': source=' + expected + ' restored=' + actual);
  if (expected !== actual) mismatch = true;
});
if (mismatch) quit(1);
"
printf 'Backup verification passed: %s\n' "$archive"
