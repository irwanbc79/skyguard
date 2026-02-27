import csv
from collections import Counter

with open('/Users/irwanbece/Downloads/imei_1_200.csv', 'r') as f:
    reader = csv.DictReader(f, delimiter=';')
    rows = list(reader)

print(f'Total rows: {len(rows)}')
print(f'Columns: {list(rows[0].keys())}')
print()

nat = Counter(r['Kebangsaan'] for r in rows)
print('=== KEBANGSAAN (top 20) ===')
for k,v in nat.most_common(20):
    print(f'  {k}: {v}')

print()
jns = Counter(r['Jns Identitas'] for r in rows)
print('=== JENIS IDENTITAS ===')
for k,v in jns.most_common():
    print(f'  {k}: {v}')

print()
sp = Counter(r['Status Pembayaran'] for r in rows)
print('=== STATUS PEMBAYARAN ===')
for k,v in sp.most_common():
    print(f'  {k}: {v}')

print()
kk = Counter(r['Kode Kantor'] for r in rows)
print('=== KODE KANTOR (top 15) ===')
for k,v in kk.most_common(15):
    print(f'  {k}: {v}')

print()
vsl = Counter(r['Vessel'] for r in rows)
print('=== VESSEL/FLIGHT (top 20) ===')
for k,v in vsl.most_common(20):
    print(f'  {k}: {v}')

print()
dates = sorted(set(r['Tgl Kedatangan'][:10] for r in rows if r['Tgl Kedatangan']))
print(f'TANGGAL: {dates[0]} to {dates[-1]} ({len(dates)} hari)')

print()
pungutan = [float(r['Total Pungutan']) for r in rows if r['Total Pungutan']]
non_zero = [p for p in pungutan if p > 0]
print(f'=== TOTAL PUNGUTAN ===')
print(f'  Records with payment: {len(non_zero)} / {len(pungutan)}')
if non_zero:
    print(f'  Min: Rp {min(non_zero):,.0f}')
    print(f'  Max: Rp {max(non_zero):,.0f}')
    print(f'  Avg: Rp {sum(non_zero)/len(non_zero):,.0f}')
    print(f'  Total: Rp {sum(non_zero):,.0f}')

ranges = Counter()
for p in pungutan:
    if p == 0: ranges['Rp 0 (Bebas)'] += 1
    elif p <= 500000: ranges['<= 500rb'] += 1
    elif p <= 1000000: ranges['500rb-1jt'] += 1
    elif p <= 5000000: ranges['1jt-5jt'] += 1
    elif p <= 10000000: ranges['5jt-10jt'] += 1
    else: ranges['>10jt'] += 1
print()
for k,v in sorted(ranges.items()):
    print(f'  {k}: {v}')

print()
print('=== CROSS-CHECK: PASSPORT OVERLAP ===')
passports = set(r['No Identitas'].strip().upper() for r in rows if r['Jns Identitas'] == 'PASSPORT')
print(f'  Unique passports: {len(passports)}')

# Top NIP petugas
nip = Counter(r['NIP Petugas'] for r in rows if r['NIP Petugas'])
print()
print(f'=== NIP PETUGAS (top 10) ===')
for k,v in nip.most_common(10):
    print(f'  {k}: {v} registrasi')

# Multiple registrations same passport
from collections import defaultdict
pp_count = defaultdict(int)
for r in rows:
    if r['No Identitas']:
        pp_count[r['No Identitas'].strip().upper()] += 1
multi = {k:v for k,v in pp_count.items() if v > 1}
print()
print(f'=== REPEAT REGISTRATIONS ===')
print(f'  Passport with >1 IMEI reg: {len(multi)}')
if multi:
    for k,v in sorted(multi.items(), key=lambda x: -x[1])[:10]:
        # Find the names
        names = set(r['Nama'] for r in rows if r['No Identitas'].strip().upper() == k)
        print(f'  {k}: {v}x - {", ".join(names)}')

# Sample rows
print()
print('=== SAMPLE ROW ===')
import json
print(json.dumps(dict(rows[0]), indent=2, ensure_ascii=False))
