#!/usr/bin/env bash
# Backup file portal sebelum deploy (rollback cepat jika portal bermasalah).
# Jalankan dari root proyek: bash scripts/backup-skyguard-portal.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$ROOT/backups/portal-$STAMP"

mkdir -p "$DEST"
mkdir -p "$ROOT/backups"

echo "Backup ke: $DEST"

cp -a "$ROOT/public/index.html" "$DEST/index.html"
if [ -d "$ROOT/public/js" ]; then
  cp -a "$ROOT/public/js" "$DEST/js"
fi

# Symlink "latest" untuk rollback satu perintah
LATEST="$ROOT/backups/portal-latest"
rm -f "$LATEST"
ln -sfn "portal-$STAMP" "$LATEST"

echo "OK. Rollback: cp backups/portal-latest/index.html public/index.html && pm2 restart skyguard-api"
echo "   (atau gunakan path penuh: $DEST/index.html)"
