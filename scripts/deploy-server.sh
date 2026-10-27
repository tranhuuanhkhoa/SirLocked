#!/usr/bin/env bash
# Chay tu may local (Git Bash) o goc repo: bash scripts/deploy-server.sh
# Build BE + FE -> dong goi -> gui len server -> deploy.sh tren server (doi release, restart, kiem tra /health).
# Can SSH key vao server. Doi server bang bien SERVER/PORT neu can.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER="${SERVER:-sirlocked-team@20.239.65.133}"
PORT="${PORT:-22923}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$(git status --porcelain -- src)" ]; then
  echo "Canh bao: src/ co thay doi chua commit; ban deploy se gom ca chung."
fi
TAG="$(git rev-parse --short HEAD)"

echo "== Build backend"
dotnet publish src/BE/SirLocked.Api.csproj -c Release -o "$TMP/pkg/api" >/dev/null
echo "== Build frontend"
(cd src/FE && npm ci --silent && npm run build --silent)
cp -r src/FE/dist "$TMP/pkg/web"

echo "== Dong goi"
tar czf "$TMP/sl-v5-$TAG.tar.gz" -C "$TMP/pkg" api web

echo "== Gui len server"
ssh -p "$PORT" "$SERVER" "mkdir -p ~/sirlocked-deploy/releases"
scp -P "$PORT" "$TMP/sl-v5-$TAG.tar.gz" scripts/server/deploy.sh "$SERVER:~/sirlocked-deploy/releases/"
ssh -p "$PORT" "$SERVER" "mv ~/sirlocked-deploy/releases/deploy.sh ~/sirlocked-deploy/deploy.sh && bash ~/sirlocked-deploy/deploy.sh ~/sirlocked-deploy/releases/sl-v5-$TAG.tar.gz"
echo "== Xong: commit $TAG"
