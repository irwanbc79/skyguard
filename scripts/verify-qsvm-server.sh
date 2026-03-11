#!/usr/bin/env bash
# Verifikasi QSVM di server: Python, dependency, dan API SkyGuard.
# Jalankan dari root proyek: bash scripts/verify-qsvm-server.sh

set -e
PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

# Gunakan venv jika ada (sama dengan yang dipakai Node)
if [ -x "venv/bin/python3" ]; then
  PYTHON="venv/bin/python3"
  echo "Menggunakan Python dari venv: $PYTHON"
else
  PYTHON="python3"
fi

echo "=== 1. Python ==="
$PYTHON --version || { echo "Python3 tidak ditemukan."; exit 1; }

echo ""
echo "=== 2. Dependency Python (numpy, scikit-learn) ==="
$PYTHON -c "import numpy; import sklearn; print('OK')" || {
  echo "Dependency belum terpasang. Pilih salah satu:"
  echo "  apt:  sudo apt install -y python3-numpy python3-sklearn"
  echo "  venv: python3 -m venv venv && ./venv/bin/pip install numpy scikit-learn"
  exit 1
}

echo ""
echo "=== 3. Script QSVM (stdin → stdout JSON) ==="
echo '{"transactions":[]}' | $PYTHON scripts/skyguard_qsvm_service.py | $PYTHON -c "import sys,json; json.load(sys.stdin); print('OK')" || { echo "Script QSVM tidak mengembalikan JSON valid."; exit 1; }

echo ""
echo "=== 4. API Health ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
echo "GET $BASE/api/health → $CODE"
[ "$CODE" = "200" ] || { echo "API health gagal."; exit 1; }

echo ""
echo "=== 5. API QSVM Stats ==="
STATS=$(curl -s "$BASE/api/qsvm/stats")
if echo "$STATS" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo "GET $BASE/api/qsvm/stats → JSON OK"
  echo "$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  success:', d.get('success')); print('  total_scans:', d.get('total_scans'))" 2>/dev/null || true
else
  echo "Response bukan JSON (mungkin HTML/502):"
  echo "$STATS" | head -c 200
  exit 1
fi

echo ""
echo "=== 6. API QSVM Test ==="
TEST=$(curl -s "$BASE/api/qsvm/test")
if echo "$TEST" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo "GET $BASE/api/qsvm/test → JSON OK"
  echo "$TEST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  engine:', d.get('engine')); print('  success:', d.get('success'))" 2>/dev/null || true
else
  echo "Response bukan JSON."
  echo "$TEST" | head -c 200
  exit 1
fi

echo ""
echo "=== Semua pengecekan QSVM berhasil ==="
