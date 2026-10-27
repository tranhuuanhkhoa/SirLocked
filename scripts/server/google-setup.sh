#!/usr/bin/env bash
# Chay bang sudo tren server: bash google-setup.sh
# 1) nginx: chuyen tiep /signin-google toi API va giu X-Forwarded-Proto=https tu Cloudflare.
# 2) Hoi Google Client ID / Client Secret (secret an, khong in ra) va ghi vao file env, roi restart API.
set -euo pipefail
ENVF=/opt/sirlocked/shared/sirlocked-v5.env
SITE=/etc/nginx/sites-available/sirlocked
PORT=5216

if ! grep -q 'map \$http_x_forwarded_proto' "$SITE"; then
  python3 - "$SITE" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
s='map $http_x_forwarded_proto $sl_proto { default $scheme; https https; }\n'+s
s=s.replace('proxy_set_header X-Forwarded-Proto $scheme;','proxy_set_header X-Forwarded-Proto $sl_proto;')
if 'location /signin-google' not in s:
    s=s.replace('  location /hubs/','  location /signin-google {\n    proxy_pass http://127.0.0.1:5216;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $sl_proto;\n  }\n  location /hubs/',1)
open(p,'w').write(s)
PY
fi
nginx -t && systemctl reload nginx

read -r -p "Google Client ID: " CID
read -r -s -p "Google Client Secret (an): " CSEC; echo
[ -n "$CID" ] && [ -n "$CSEC" ] || { echo "Thieu ID hoac Secret"; exit 1; }
sed -i '/^Google__ClientId=/d;/^Google__ClientSecret=/d' "$ENVF"
printf 'Google__ClientId=%s\nGoogle__ClientSecret=%s\n' "$CID" "$CSEC" >> "$ENVF"
chmod 600 "$ENVF"
systemctl restart sirlocked-v5-api
echo "XONG"
