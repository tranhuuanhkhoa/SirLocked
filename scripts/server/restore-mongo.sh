#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: restore-mongo.sh <archive> <targetDb> [--yes]" >&2
  exit 2
fi
archive="$1"
target_db="$2"
confirmation="${3:-}"
: "${MONGO_URI:?MONGO_URI is required}"
: "${MONGO_DB:?MONGO_DB is required}"
[[ "$target_db" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "targetDb contains unsupported characters." >&2; exit 2; }
[[ "$confirmation" == "--yes" ]] || { echo "Refusing restore without --yes." >&2; exit 2; }
[[ -f "$archive" && -f "$archive.sha256" ]] || { echo "Archive or checksum file is missing." >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")
mongorestore --uri "$MONGO_URI" --nsFrom "$MONGO_DB.*" --nsTo "$target_db.*" --drop --archive="$archive" --gzip
