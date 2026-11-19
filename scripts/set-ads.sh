#!/usr/bin/env bash
# Chay tu may local (Git Bash): bash scripts/set-ads.sh
# VUAN-7: bat (hoac tat) quang cao thuong Google H5 Games Ads cho goi y muc 2 sau khi Google duyet sirlocked.id.vn.
# Hoi ma nha xuat ban (ca-pub-...), che do thu, roi ghi Ads__Enabled, Ads__PublisherId, Ads__TestMode vao file env cua API
# va khoi dong lai API. Nhap "tat" de tat quang cao. Loi thi tra lai file cu.
set -euo pipefail
SERVER="${SERVER:?Dat SERVER=<user>@<dia-chi-server> truoc khi chay}"
PORT="${PORT:?Dat PORT=<cong-ssh> truoc khi chay}"

read -rp 'Ma nha xuat ban AdSense (ca-pub-..., hoac "tat" de tat quang cao): ' publisher
if [[ "$publisher" == "tat" ]]; then
  enabled=false; publisher=""; test_mode=false
elif [[ "$publisher" =~ ^ca-pub-[0-9]{10,20}$ ]]; then
  enabled=true
  read -rp 'Che do thu cua Google (data-adbreak-test)? [c/k]: ' answer
  test_mode=$([[ "$answer" == "c" ]] && echo true || echo false)
else
  echo "Ma nha xuat ban co dang ca-pub-<so>. Chua thay doi gi tren server."
  exit 1
fi

{
  printf 'enabled=%s\npublisher=%s\ntest_mode=%s\n' "$enabled" "$publisher" "$test_mode"
  cat <<'REMOTE'
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/sirlocked/shared/sirlocked-v5.env}"
SVC=sirlocked-v5-api
API_PORT=5216
umask 077
cp "$ENV_FILE" "$ENV_FILE.bak"
grep -vE '^[[:space:]]*(export[[:space:]]+)?Ads__(Enabled|PublisherId|TestMode)=' "$ENV_FILE" > "$ENV_FILE.new" || true
printf 'Ads__Enabled=%s\nAds__PublisherId=%s\nAds__TestMode=%s\n' "$enabled" "$publisher" "$test_mode" >> "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
sudo -n systemctl restart "$SVC" </dev/null
for _ in $(seq 1 30); do
  if [ "$(curl -s -m 3 "http://127.0.0.1:$API_PORT/health" </dev/null)" = "Healthy" ]; then
    rm -f "$ENV_FILE.bak"
    echo "OK: Ads__Enabled=$enabled; /health dat."
    exit 0
  fi
  sleep 2
done
mv "$ENV_FILE.bak" "$ENV_FILE"
sudo -n systemctl restart "$SVC" </dev/null
echo "LOI: /health khong len. Da tra lai file cu."
exit 1
REMOTE
} | ssh -p "$PORT" "$SERVER" 'bash -s'
