#!/bin/bash

echo "=========================================="
echo "   SKYGUARD AUTO CLEANUP & DEPLOY TOOL    "
echo "=========================================="

# 1. MEMBERSIHKAN FOLDER BACKUP
# Menghapus folder backup spesifik yang teridentifikasi
if [ -d "src/backup_20260206" ]; then
    echo "🗑️  Menghapus folder backup: src/backup_20260206"
    rm -rf src/backup_20260206
fi

# 2. MEMBERSIHKAN FILE .BAK & .BACKUP DI SRC
echo "🧹 Membersihkan file .bak di folder SRC..."
# Mencari dan menghapus file berakhiran .bak atau .backup* di dalam src/
find src -type f \( -name "*.bak" -o -name "*.backup*" \) -delete

# Menghapus file spesifik yang tadi terdeteksi jika masih ada
rm -f src/controllers/deviceController.js.bak
rm -f src/app.js.bak

# 3. MEMBERSIHKAN PUBLIC FOLDER
echo "🧹 Membersihkan file sampah di folder PUBLIC..."
rm -f public/index.html.bak*
rm -f public/index.html.patch
rm -f public/index.html.pre_cargo

echo "✅ Pembersihan file selesai."
echo "------------------------------------------"

# 4. GIT OPERATIONS
echo "🚀 Memulai proses Git..."

# Add semua file (termasuk penghapusan yang baru dilakukan)
git add .

# Commit
echo "📦 Melakukan Commit..."
# Cek apakah ada perubahan yang perlu di-commit untuk mencegah error jika kosong
if git diff-index --quiet HEAD --; then
    echo "ℹ️  Tidak ada perubahan file baru untuk di-commit."
else
    git commit -m "Refactor: Membersihkan file backup (.bak) dan update struktur server"
fi

# Push dengan handling upstream otomatis
echo "⬆️  Melakukan Push ke server..."

# Mendapatkan nama branch saat ini (misal: main)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Mencoba push normal. Jika gagal, coba set-upstream
if git push origin "$CURRENT_BRANCH"; then
    echo "✅ Push berhasil."
else
    echo "⚠️  Push standar gagal (mungkin upstream belum diset)."
    echo "🔄 Mencoba mengatur upstream ke origin/$CURRENT_BRANCH..."
    git push --set-upstream origin "$CURRENT_BRANCH"
fi

echo "=========================================="
echo "   DEPLOYMENT SELESAI!                    "
echo "=========================================="
