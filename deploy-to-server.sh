#!/bin/bash
#
# Deploy SkyGuard dari LOKAL ke server (push git + pull di server + restart PM2).
#
# PENTING: Jalankan script ini di KOMPUTER ANDA (tempat Anda coding),
#          BUKAN di server. Path contoh di Mac: /Users/irwanbece/skyguard
#
# Di komputer Anda:
#   cd /Users/irwanbece/skyguard   # atau path folder skyguard di laptop/PC Anda
#   export DEPLOY_HOST="root@76.13.23.149"
#   ./deploy-to-server.sh
#
# Pertama kali: set alamat server (sesuaikan dengan server Anda):
#   export DEPLOY_HOST="root@76.13.23.149"
#   atau: export DEPLOY_HOST="root@srv1318172"
# Bisa juga ditulis di .env.deploy (buat file berisi: DEPLOY_HOST=root@76.13.23.149)
#

set -e
cd "$(dirname "$0")"

# Ambil DEPLOY_HOST dari env atau file .env.deploy
if [ -z "$DEPLOY_HOST" ] && [ -f .env.deploy ]; then
  source .env.deploy
fi
if [ -z "$DEPLOY_HOST" ]; then
  echo "❌ DEPLOY_HOST belum diset."
  echo "   Contoh: export DEPLOY_HOST=root@76.13.23.149"
  echo "   Atau buat file .env.deploy berisi: DEPLOY_HOST=root@76.13.23.149"
  exit 1
fi

echo "=========================================="
echo "   SkyGuard — Deploy ke server"
echo "   Server: $DEPLOY_HOST"
echo "=========================================="

# 1. Git add logo + index (yang sering berubah)
echo "📁 Menambah file logo & index..."
git add public/assets/logo-bc-kualanamu.png public/index.html 2>/dev/null || true
if git diff --staged --quiet 2>/dev/null; then
  echo "   Tidak ada perubahan logo/index untuk di-commit."
else
  echo "📦 Commit..."
  git commit -m "Deploy: update logo BC Kualanamu / assets"
fi

# 2. Push
echo "⬆️  Push ke origin..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if ! git push origin "$CURRENT_BRANCH" 2>/dev/null; then
  git push --set-upstream origin "$CURRENT_BRANCH" 2>/dev/null || true
fi

# 3. Di server: pull + restart
echo "🖥️  Di server: git pull + pm2 restart..."
ssh "$DEPLOY_HOST" "cd ~/skyguard && git pull && pm2 restart skyguard-api"

echo "=========================================="
echo "   ✅ Deploy selesai. Cek di browser."
echo "=========================================="
