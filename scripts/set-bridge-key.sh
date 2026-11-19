#!/usr/bin/env bash
# Chay tu may local (Git Bash): bash scripts/set-bridge-key.sh
# Dat khoa bridge cho bot Claude tren server: hoi khoa (khong hien khi go), ghi Bridge__Key vao file env cua API,
# chuyen server sang che do bot Claude (MOCK_AI_RESPONSES=false, SKIP_ASSET_GENERATION=false: don that vao hang cho
# Claude thay vi duoc tra loi mock ngay), khoi dong lai API, kiem /health va GET /api/bridge/ping bang chinh khoa do.
# Loi thi tra lai file cu (ca khoa lan che do).
# Khoa chi di qua stdin cua SSH va curl: khong nam tren dong lenh, trong file tam hay trong log.
# Tao khoa moi (vi du): openssl rand -hex 32
set -euo pipefail
SERVER="${SERVER:?Dat SERVER=<user>@<dia-chi-server> truoc khi chay}"
PORT="${PORT:?Dat PORT=<cong-ssh> truoc khi chay}"

read -rsp 'Khoa bridge (khong hien khi go): ' bridge_key
echo
# Length is checked apart from the characters: Git Bash's regex engine rejects repeat counts above 255.
if (( ${#bridge_key} < 32 || ${#bridge_key} > 256 )) || [[ ! "$bridge_key" =~ ^[A-Za-z0-9_-]+$ ]]; then
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
# Switch the server to the Claude bot: real orders wait for Claude instead of getting instant mock answers.
grep -vE '^[[:space:]]*(export[[:space:]]+)?(Bridge__Key|MOCK_AI_RESPONSES|SKIP_ASSET_GENERATION|AiGeneration__MockAiResponses|AiGeneration__SkipAssetGeneration)=' "$ENV_FILE" > "$ENV_FILE.new" || true
printf 'Bridge__Key=%s\nMOCK_AI_RESPONSES=false\nSKIP_ASSET_GENERATION=false\n' "$bridge_key" >> "$ENV_FILE.new"
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
echo "OK: da dat khoa bridge va chuyen sang che do bot Claude; /health va /api/bridge/ping deu dat."
if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?Cloudinary__Enabled=true' "$ENV_FILE"; then
  echo "Luu y: Cloudinary chua bat. Bot se khong tai hinh len duoc cho toi khi chay bash scripts/set-cloudinary.sh."
fi
REMOTE
} | ssh -p "$PORT" "$SERVER" 'bash -s'
unset bridge_key
