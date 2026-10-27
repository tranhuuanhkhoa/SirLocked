#!/usr/bin/env bash
# Chay tren server (user sirlocked-team): deploy.sh <file.tar.gz chua api/ va web/>
# Giai nen release moi -> doi symlink current -> restart service -> kiem tra /health (loi thi quay lui).
set -euo pipefail
TAR="${1:?Cach dung: deploy.sh <file.tar.gz>}"
SVC=sirlocked-v5-api
BASE=/opt/sirlocked
PORT=5216
REL="$BASE/releases/$(date +%Y%m%d-%H%M%S)-$(basename "$TAR" .tar.gz)"
PREV=$(readlink -f "$BASE/current" || true)

mkdir -p "$REL"
tar xzf "$TAR" -C "$REL"
[ -f "$REL/api/SirLocked.Api.dll" ] && [ -f "$REL/web/index.html" ] || { echo "Goi khong hop le (thieu api/ hoac web/)"; rm -rf "$REL"; exit 1; }

switch_to() { ln -sfn "$1" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"; }
healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -m 3 http://127.0.0.1:$PORT/health)" = "Healthy" ] && return 0
    sleep 2
  done
  return 1
}

switch_to "$REL"
sudo -n systemctl restart "$SVC"
if healthy; then
  echo "OK: dang chay $REL"
else
  echo "LOI: /health khong len. Quay lui ve ${PREV:-<khong co>}"
  if [ -n "$PREV" ]; then switch_to "$PREV"; sudo -n systemctl restart "$SVC"; fi
  exit 1
fi

# giu 3 release gan nhat (khong xoa release dang chay)
CUR=$(readlink -f "$BASE/current")
ls -1dt "$BASE"/releases/*/ 2>/dev/null | sed 's#/$##' | tail -n +4 | while read -r d; do
  [ "$(readlink -f "$d")" = "$CUR" ] || rm -rf "$d"
done

# giu 3 goi .tar.gz gan nhat
ls -1t "$HOME"/sirlocked-deploy/releases/*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
