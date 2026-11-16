#!/usr/bin/env bash
# Chay tu may local (Git Bash): bash scripts/set-bridge-key.sh
# Dat khoa bridge cho bot Claude tren server: hoi khoa (khong hien khi go), ghi Bridge__Key vao file env cua API,
# khoi dong lai API, kiem /health va GET /api/bridge/ping bang chinh khoa do. Loi thi tra lai file cu.
# Khoa chi di qua stdin cua SSH va curl: khong nam tren dong lenh, trong file tam hay trong log.
# Tao khoa moi (vi du): openssl rand -hex 32
set -euo pipefail
SERVER="${SERVER:-sirlocked-team@20.239.65.133}"
PORT="${PORT:-22923}"

read -rsp 'Khoa bridge (khong hien khi go): ' bridge_key
echo
if [[ ! "$bridge_key" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; then
  echo "Khoa phai dai 32-256 ky tu, chi gom chu, so, '-' va '_' (vi du: openssl rand -hex 32). Chua thay doi gi tren server."
  exit 1
fi

{
  printf 'bridge_key=%s\n' "$bridge_key"
  cat <<'REMOTE'
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/sirlocked/shared/sirlocked-v5.env}"
SVC=sirlocked-v5-api
API_PORT=5216
umask 077
cp "$ENV_FILE" "$ENV_FILE.bak"
grep -vE '^[[:space:]]*(export[[:space:]]+)?Bridge__Key=' "$ENV_FILE" > "$ENV_FILE.new" || true
printf 'Bridge__Key=%s\n' "$bridge_key" >> "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -m 3 "http://127.0.0.1:$API_PORT/health" </dev/null)" = "Healthy" ] && return 0
    sleep 2
  done
  return 1
}
bridge_ok() {
  # The header comes from stdin (-H @-), so the key never appears in the process list.
  [ "$(printf 'X-Bridge-Key: %s\n' "$bridge_key" | curl -s -o /dev/null -w '%{http_code}' -m 5 -H @- "http://127.0.0.1:$API_PORT/api/bridge/ping")" = "200" ]
}
rollback() {
  mv "$ENV_FILE.bak" "$ENV_FILE"
  sudo -n systemctl restart "$SVC" </dev/null
}
sudo -n systemctl restart "$SVC" </dev/null
if ! healthy; then
  rollback
  echo "LOI: /health khong len. Da tra lai file cu."
  exit 1
fi
if ! bridge_ok; then
  rollback
  echo "LOI: /api/bridge/ping khong nhan khoa vua dat. Da tra lai file cu."
  exit 1
fi
rm -f "$ENV_FILE.bak"
echo "OK: da dat khoa bridge; /health va /api/bridge/ping deu dat."
REMOTE
} | ssh -p "$PORT" "$SERVER" 'bash -s'
unset bridge_key
