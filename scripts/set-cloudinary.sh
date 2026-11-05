#!/usr/bin/env bash
# Chay tu may local (Git Bash): bash scripts/set-cloudinary.sh
# Hoi thong tin Cloudinary, thu voi Cloudinary, ghi vao file env cua API tren server, khoi dong lai API va kiem tra /health
# (loi thi tra lai file cu). Gia tri chi di qua stdin cua curl va SSH: khong nam tren dong lenh, trong file tam hay trong log.
set -euo pipefail
SERVER="${SERVER:-sirlocked-team@20.239.65.133}"
PORT="${PORT:-22923}"

read -rp 'Cloud name: ' cloud
read -rp 'API key: ' key
read -rsp 'API secret (khong hien khi go): ' secret
echo
for value in "$cloud" "$key" "$secret"; do
  if [[ ! "$value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Co gia tri rong hoac co ky tu la. Chua thay doi gi tren server."
    exit 1
  fi
done

status="$(printf 'user = "%s:%s"\n' "$key" "$secret" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 -K - "https://api.cloudinary.com/v1_1/$cloud/ping" || true)"
case "$status" in
  200) echo "Cloudinary chap nhan thong tin nay." ;;
  401) echo "Cloudinary tu choi thong tin nay (HTTP 401). Chua thay doi gi tren server."; exit 1 ;;
  *) echo "Canh bao: khong thu duoc voi Cloudinary (HTTP $status). Van ghi len server; hay thu tai mot anh de kiem tra." ;;
esac

{
  printf 'cloud=%s\nkey=%s\nsecret=%s\n' "$cloud" "$key" "$secret"
  cat <<'REMOTE'
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/sirlocked/shared/sirlocked-v5.env}"
SVC=sirlocked-v5-api
API_PORT=5216
umask 077
cp "$ENV_FILE" "$ENV_FILE.bak"
grep -vE '^[[:space:]]*(export[[:space:]]+)?Cloudinary__(Enabled|CloudName|ApiKey|ApiSecret)=' "$ENV_FILE" > "$ENV_FILE.new" || true
printf 'Cloudinary__Enabled=true\nCloudinary__CloudName=%s\nCloudinary__ApiKey=%s\nCloudinary__ApiSecret=%s\n' "$cloud" "$key" "$secret" >> "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -m 3 "http://127.0.0.1:$API_PORT/health" </dev/null)" = "Healthy" ] && return 0
    sleep 2
  done
  return 1
}
sudo -n systemctl restart "$SVC" </dev/null
if healthy; then
  rm -f "$ENV_FILE.bak"
  echo "OK: da bat Cloudinary, API dang chay."
else
  mv "$ENV_FILE.bak" "$ENV_FILE"
  sudo -n systemctl restart "$SVC" </dev/null
  echo "LOI: /health khong len. Da tra lai file cu."
  exit 1
fi
REMOTE
} | ssh -p "$PORT" "$SERVER" 'bash -s'
