#!/usr/bin/env bash
# Chay tu may local (Git Bash): bash scripts/set-anthropic-key.sh
# VUAN-7: dat khoa Claude API cho lan don VIP tren server: hoi khoa (khong hien khi go), ghi Anthropic__ApiKey vao file env
# cua API, khoi dong lai API va kiem /health. Loi thi tra lai file cu. Khoa chi di qua stdin cua SSH: khong nam tren dong
# lenh, trong file tam hay trong log. Server khong goi Anthropic luc kiem; don VIP dau tien se dung khoa nay.
# Truoc do: tao khoa rieng cho Sir Locked tren Claude Console va dat gioi han chi tieu moi thang.
set -euo pipefail
SERVER="${SERVER:?Dat SERVER=<user>@<dia-chi-server> truoc khi chay}"
PORT="${PORT:?Dat PORT=<cong-ssh> truoc khi chay}"

read -rsp 'Khoa Claude API (khong hien khi go): ' api_key
echo
if (( ${#api_key} < 20 || ${#api_key} > 400 )) || [[ ! "$api_key" =~ ^sk-ant-[A-Za-z0-9_-]+$ ]]; then
  echo "Khoa Claude API bat dau bang sk-ant- va chi gom chu, so, '-' va '_'. Chua thay doi gi tren server."
  exit 1
fi

{
  printf 'api_key=%s\n' "$api_key"
  cat <<'REMOTE'
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/sirlocked/shared/sirlocked-v5.env}"
SVC=sirlocked-v5-api
API_PORT=5216
umask 077
cp "$ENV_FILE" "$ENV_FILE.bak"
grep -vE '^[[:space:]]*(export[[:space:]]+)?Anthropic__ApiKey=' "$ENV_FILE" > "$ENV_FILE.new" || true
printf 'Anthropic__ApiKey=%s\n' "$api_key" >> "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -m 3 "http://127.0.0.1:$API_PORT/health" </dev/null)" = "Healthy" ] && return 0
    sleep 2
  done
  return 1
}
sudo -n systemctl restart "$SVC" </dev/null
if ! healthy; then
  mv "$ENV_FILE.bak" "$ENV_FILE"
  sudo -n systemctl restart "$SVC" </dev/null
  echo "LOI: /health khong len. Da tra lai file cu."
  exit 1
fi
rm -f "$ENV_FILE.bak"
echo "OK: da dat Anthropic__ApiKey; /health dat. The Cai dat o /admin/ai se hien 'Da dat khoa Claude API'."
REMOTE
} | ssh -p "$PORT" "$SERVER" 'bash -s'
unset api_key
