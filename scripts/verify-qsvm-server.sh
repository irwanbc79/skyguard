#!/usr/bin/env bash
# Verifikasi QSVM di server: Python, dependency, dan API SkyGuard.
# Jalankan dari root proyek: bash scripts/verify-qsvm-server.sh

set -e
PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

echo "=== 1. Python ==="
python3 --version || { echo "Python3 tidak ditemukan."; exit 1; }

echo ""
echo "=== 2. Dependency Python (numpy, scikit-learn) ==="
python3 -c "import numpy; import sklearn; print('OK')" || { echo "Jalankan: pip3 install numpy scikit-learn"; exit 1; }

echo ""
echo "=== 3. Script QSVM (stdin → stdout JSON) ==="
echo '{"transactions":[]}' | python3 scripts/skyguard_qsvm_service.py | python3 -c "import sys,json; json.load(sys.stdin); print('OK')" || { echo "Script QSVM tidak mengembalikan JSON valid."; exit 1; }

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
