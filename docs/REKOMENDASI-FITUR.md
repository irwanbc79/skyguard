# SkyGuard Intelligence — Rekomendasi Fitur

Dokumen ini berisi ide fitur yang dapat meningkatkan nilai portal SkyGuard untuk tim KPPBC TMP B Kualanamu. Prioritas bisa disesuaikan dengan kebutuhan operasional.

---

## 1. Fitur Berdampak Tinggi (Quick Wins)

### 1.1 Export Laporan Periodik (PDF/Excel)
- **Apa:** Generate laporan mingguan/bulanan (manifest terproses, IMEI terdaftar, billing vs pembebasan, top rute) dalam PDF atau Excel, bisa dijadwalkan atau on-demand.
- **Nilai:** Pimpinan dapat kirim laporan ke atasan tanpa buka portal; dokumentasi audit trail.
- **Teknis:** Backend: library PDF (pdfkit/jspdf) atau Excel (xlsx sudah ada); endpoint terproteksi API key; optional cron + simpan ke folder atau kirim email.

### 1.2 Notifikasi Browser (Web Push)
- **Apa:** Notifikasi real-time di browser saat ada manifest baru, suspect match, atau notifikasi kritikal—tanpa harus buka tab portal.
- **Nilai:** Petugas tidak melewatkan alert penting.
- **Teknis:** Service Worker + Web Push API; backend simpan subscription, kirim via web-push; izin notifikasi di frontend.

### 1.3 Pencarian Global dengan Shortcut (Ctrl+K)
- **Apa:** Modal "command palette" (Ctrl+K atau Cmd+K): ketik paspor, flight, IMEI, atau nama → langsung loncat ke hasil (Penumpang, Manifest, IMEI).
- **Nilai:** Akses cepat dari mana saja di portal; pengalaman mirip IDE.
- **Teknis:** Frontend: satu modal, debounced fetch ke `/api/unified/search?q=...`, render hasil dengan link ke section yang relevan.

### 1.4 Bookmark / Favorit Penerbangan
- **Apa:** Simpan daftar flight number favorit (mis. rute prioritas); di Dashboard atau Flight Radar tampil badge "favorit" dan filter "Tampilkan favorit saja".
- **Nilai:** Fokus ke rute yang sering dipantau.
- **Teknis:** Collection `UserPreference` atau simpan di localStorage (per browser); endpoint GET/POST `/api/me/favorites` jika pakai akun nanti.

---

## 2. Intelijen & Pengawasan

### 2.1 Heatmap Waktu Kedatangan
- **Apa:** Grafik heatmap: jam (0–23) vs hari dalam minggu untuk kedatangan penumpang atau manifest; warna = kepadatan.
- **Nilai:** Identifikasi jam sibuk untuk penjadwalan petugas.
- **Teknis:** Agregasi `tanggal_dokumen` / `flight_date` + jam; frontend Chart.js heatmap atau matrix custom.

### 2.2 Alert Otomatis: Penerbangan Pertama Kali
- **Apa:** Jika ada maskapai atau rute baru (belum pernah muncul di data sebelumnya), buat notifikasi "Rute baru terdeteksi: TR244 SIN–KNO".
- **Nilai:** Kesadaran terhadap perubahan pola penerbangan.
- **Teknis:** Setelah ingest manifest, cek kombinasi (carrier, origin, destination) vs history; jika baru → create notification.

### 2.3 Timeline Per Paspor
- **Apa:** Satu halaman "Lifecycle" per paspor: tanggal masuk/keluar, flight, device IMEI, status billing/pembebasan, manifest mana saja yang menyebut paspor ini—dalam bentuk timeline visual.
- **Nilai:** Cerita lengkap satu penumpang untuk investigasi atau review.
- **Teknis:** Agregasi dari Passenger, ManifestPassenger, ImeiDetail; endpoint GET `/api/intel/passport/:no/timeline`; frontend timeline horizontal (CSS atau library kecil).

### 2.4 Perbandingan Dua Periode
- **Apa:** Di Dashboard atau Analitik: pilih "Bulan ini vs Bulan lalu" atau "Minggu ini vs Minggu lalu"; tampilkan perbandingan (persen naik/turun) per metrik (manifest, penumpang, IMEI, pungutan).
- **Nilai:** Trend tanpa hitung manual.
- **Teknis:** Dashboard summary sudah punya trend; perlu UI pilih periode dan tampilkan side-by-side atau delta.

---

## 3. Operasional & UX

### 3.1 Mode Gelap / Terang
- **Apa:** Toggle tema gelap (saat ini) vs terang; pilihan tersimpan di localStorage.
- **Nilai:** Nyaman di ruangan terang; mengurangi kelelahan mata.
- **Teknis:** CSS variables atau class `dark`/`light` di body; Tailwind dark mode; toggle di header.

### 3.2 Kolom Tabel Bisa Disembunyikan
- **Apa:** Di tabel besar (manifest, penumpang, IMEI), pengguna bisa hide/show kolom dan urutan kolom; preferensi disimpan per device.
- **Nilai:** Layar kecil atau fokus ke kolom tertentu.
- **Teknis:** State kolom (visible, order) di localStorage; render header/body dinamis.

### 3.3 Unduhan Batch (Bulk Download)
- **Apa:** Dari daftar manifest atau daftar penumpang: centang beberapa baris → "Download terpilih" → satu ZIP berisi CSV/PDF per item.
- **Nilai:** Backup atau share banyak manifest sekaligus.
- **Teknis:** Backend endpoint POST `/api/manifests/bulk-export` (body: array id); generate file, zip (archiver/adm-zip), stream response.

### 3.4 Validasi Format Sebelum Upload
- **Apa:** Sebelum upload manifest atau CSV penumpang: preview baris pertama + validasi format (kolom wajib, tipe data); tampilkan error per baris jika ada.
- **Nilai:** Kurangi upload gagal dan data corrupt.
- **Teknis:** Frontend baca file (FileReader), kirim chunk atau sample ke endpoint `/api/manifests/validate-file` atau `/api/passenger/validate-csv`; backend return { valid, errors[] }.

---

## 4. Integrasi & Data

### 4.1 Webhook Outbound
- **Apa:** Konfigurasi URL webhook; saat event tertentu (manifest parsed, suspect match, notifikasi kritikal), backend POST payload JSON ke URL tersebut.
- **Nilai:** Integrasi dengan sistem lain (monitoring, Slack, internal app) tanpa polling.
- **Teknis:** Collection `Webhook` (url, secret, events[]); service layer panggil webhook on event; retry + log.

### 4.2 API Publik Terdokumentasi (OpenAPI/Swagger)
- **Apa:** Dokumentasi API dalam format OpenAPI 3.0; bisa dipakai untuk generate client atau testing (Swagger UI).
- **Nilai:** Tim baru atau integrasi pihak ketiga lebih cepat.
- **Teknis:** File YAML/JSON OpenAPI (bisa digenerate dari komentar atau tulis manual); endpoint `/api-docs` serve Swagger UI.

### 4.3 Backup & Restore Konfigurasi
- **Apa:** Export/import konfigurasi (filter IMAP, daftar domain, subject keyword, dll) dalam JSON; tidak termasuk data sensitif (password).
- **Nilai:** Replikasi setup ke lingkungan lain atau pemulihan setelah ganti server.
- **Teknis:** Endpoint GET/POST `/api/admin/config-backup` (perlu auth kuat); baca/tulis ke file atau collection `AppConfig`.

---

## 5. Keamanan & Audit

### 5.1 Audit Log
- **Apa:** Log siapa (IP atau user jika nanti ada login) melakukan aksi apa (upload manifest, bulk sync, hapus suspect, ubah status) dan kapan; tampilkan di halaman "Audit" untuk admin.
- **Nilai:** Accountability dan investigasi jika ada insiden.
- **Teknis:** Collection `AuditLog`; middleware atau di dalam route: tulis log setelah aksi sukses; halaman baca dengan filter tanggal/aksi.

### 5.2 Rate Limit Per Endpoint
- **Apa:** Selain rate limit global (500/15min), endpoint berat (dashboard summary, bulk sync, search terpadu) punya limit lebih ketat (mis. 30/15min) agar satu pengguna tidak membebani server.
- **Nilai:** Stabilitas dan fair usage.
- **Teknis:** express-rate-limit per route atau per path pattern; bisa pakai memory store atau Redis jika nanti multi-instance.

### 5.3 Two-Factor untuk Aksi Kritis (Opsional)
- **Apa:** Untuk aksi seperti "Bulk delete", "Ubah filter IMAP", minta kode OTP (email atau TOTP) selain API key.
- **Nilai:** Lapis keamanan tambahan untuk operasi destruktif.
- **Teknis:** Simpan secret TOTP per "admin"; library speakeasy/otplib; verifikasi sebelum eksekusi aksi.

---

## 6. Prioritas Saran (Ringkas)

| Prioritas | Fitur | Alasan |
|-----------|--------|--------|
| 1 | Export laporan PDF/Excel | Langsung dipakai pimpinan; nilai tinggi, effort sedang |
| 2 | Pencarian global (Ctrl+K) | UX sangat terasa; memanfaatkan API unified yang sudah ada |
| 3 | Notifikasi browser (Web Push) | Alert tepat waktu tanpa buka portal |
| 4 | Timeline per paspor | Memperkuat nilai intelijen; diferensiasi DSS |
| 5 | Audit log | Penting untuk compliance dan keamanan jangka panjang |

Dokumentasi teknis lengkap: [DOKUMENTASI-TEKNIS.md](./DOKUMENTASI-TEKNIS.md).
