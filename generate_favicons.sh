#!/bin/bash
# Generate favicon sizes from logo.png using macOS sips
# Usage: Place your logo as public/images/logo.png then run this script

LOGO="public/images/logo.png"

if [ ! -f "$LOGO" ]; then
  echo "❌ File $LOGO tidak ditemukan!"
  echo "   Silakan simpan logo Anda sebagai $LOGO terlebih dahulu."
  exit 1
fi

echo "🔧 Generating favicon sizes from $LOGO..."

# 32x32 favicon
cp "$LOGO" "public/images/logo-32.png"
sips -z 32 32 "public/images/logo-32.png" --out "public/images/logo-32.png" > /dev/null 2>&1
echo "✅ logo-32.png created"

# 16x16 favicon  
cp "$LOGO" "public/images/logo-16.png"
sips -z 16 16 "public/images/logo-16.png" --out "public/images/logo-16.png" > /dev/null 2>&1
echo "✅ logo-16.png created"

# 192x192 for Android/PWA
cp "$LOGO" "public/images/logo-192.png"
sips -z 192 192 "public/images/logo-192.png" --out "public/images/logo-192.png" > /dev/null 2>&1
echo "✅ logo-192.png created"

# Also create a favicon.ico-compatible PNG at root
cp "public/images/logo-32.png" "public/favicon.png"
echo "✅ favicon.png created"

echo ""
echo "🎉 Semua favicon berhasil di-generate!"
echo "   Logo utama: public/images/logo.png"
echo "   Favicon 32: public/images/logo-32.png"
echo "   Favicon 16: public/images/logo-16.png"
echo "   PWA icon:   public/images/logo-192.png"
