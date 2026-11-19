#!/usr/bin/env bash
# Chay MOT LAN bang sudo tren server: cho sirlocked-team restart dung service V5, khong can mat khau.
set -euo pipefail
F=/etc/sudoers.d/zz-sirlocked-deploy
rm -f /etc/sudoers.d/sirlocked-deploy
cat > "$F" <<'EOF'
sirlocked-team ALL=(root) NOPASSWD: /usr/bin/systemctl restart sirlocked-v5-api, /usr/bin/systemctl status sirlocked-v5-api
EOF
chmod 440 "$F"
visudo -cf "$F"
echo "XONG"
