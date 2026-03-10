# SkyGuard Intelligence — Dokumentasi Teknis

Dokumen ini berisi ringkasan teknis proyek **SkyGuard Intelligence** (Decision Support System - KPPBC TMP B Kualanamu) agar tim dapat mempelajari stack, arsitektur, dan alur data sebelum ikut kolaborasi pengembangan.

---

## 1. Ringkasan Proyek

- **Nama:** SkyGuard Intelligence  
- **Fungsi:** Portal pendukung keputusan (DSS) untuk pelayanan dan pengawasan barang serta penumpang di lingkungan KPPBC TMP B Kualanamu.  
- **Bukan pengganti CEISA:** Data bersifat referensi; proses kepabeanan tetap melalui CEISA sebagai sistem resmi DJBC.  
- **Pengguna:** Internal KPPBC TMP B Kualanamu.

---

## 2. Stack Teknologi

| Kategori      | Teknologi |
|---------------|-----------|
| **Bahasa**    | JavaScript (Node.js di backend; vanilla JS di frontend) |
| **Runtime**   | Node.js (disarankan v18+) |
| **Backend**   | Express.js 5.x |
| **Database**  | MongoDB (driver: Mongoose 9.x) |
| **Frontend**  | SPA (Single Page Application) — HTML5 + CSS + JavaScript (tanpa framework React/Vue) |
| **CSS**       | Tailwind CSS (CDN), font Inter (Google Fonts) |
| **Peta**      | Leaflet.js (Flight Radar / peta live) |
| **Grafik**    | Chart.js 4.x (dashboard & home command center) |
| **Ikon**      | Font Awesome 6 |
| **Proses**    | PM2 (production), node-cron (jadwal tugas) |

---

## 3. Arsitektur Umum

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Client)                                                │
│  • public/index.html (SPA)                                       │
│  • Tailwind, Leaflet, Chart.js, Font Awesome                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js (Express) — src/app.js                                  │
│  • Middleware: CORS, Helmet, compression, rate-limit, body 10mb   │
│  • Static: /public, /uploads                                     │
│  • API: /api/*                                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────────┐
│  Routes       │   │  Services    │   │  Models (Mongoose) │
│  src/routes/  │   │  src/services│   │  src/models/      │
│  (API layer)  │   │  (business   │   │  (schema DB)     │
│               │   │   logic)     │   │                   │
└───────┬───────┘   └───────┬──────┘   └─────────┬───────────┘
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  MongoDB       │
                    │  (MONGODB_URI) │
                    └────────────────┘
```

- **Frontend:** Satu file utama `public/index.html` (SPA), plus `hs-explorer.js`, `edit-price.js` untuk modul tertentu.  
- **Backend:** Satu proses Express (`src/app.js`) yang me-mount semua route di bawah `/api/`.  
- **Database:** Satu instance MongoDB; koneksi via Mongoose dengan pool (min 5, max 30).

---

## 4. Struktur Folder (Ringkas)

```
skyguard/
├── src/
│   ├── app.js                 # Entry point Express, mount routes, MongoDB, cron
│   ├── controllers/           # Manifest, Device, Passenger (sebagian logic)
│   ├── middleware/            # auth (API key), validateParams (ObjectId)
│   ├── models/                # Skema Mongoose (lihat section Database)
│   ├── routes/                # Definisi endpoint API (lihat section Backend)
│   ├── services/              # Logika bisnis, IMAP, parsing manifest, intel, dll
│   └── utils/                 # helpers (escapeRegex, parsePagination, isValidObjectId, dll)
├── public/
│   ├── index.html             # SPA utama (~21k+ baris: HTML + inline JS)
│   ├── assets/                # Logo, gambar (logo-bc-kualanamu.png)
│   ├── hs-explorer.js         # Modul HS Code explorer
│   └── edit-price.js          # Modul edit harga referensi
├── uploads/                   # File manifest & upload (perlu ada di server)
├── docs/                      # Dokumentasi (file ini)
├── package.json
├── ecosystem.config.js        # Konfigurasi PM2 (cluster, log, memory)
└── .env                       # Variabel lingkungan (tidak di-commit)
```

---

## 5. Backend — Detail

### 5.1 Entry & Server

- **Entry:** `src/app.js` (atau `node src/app.js` / `npm start`).  
- **Port:** `process.env.PORT` atau 3000.  
- **Listen:** `0.0.0.0` agar bisa diakses dari jaringan.

### 5.2 Route (API) yang Terdaftar di `app.js`

| Prefix API              | File Route           | Keterangan Singkat |
|-------------------------|----------------------|--------------------|
| `/api/devices`          | devices.js           | Cek harga device, CRUD device |
| `/api/passengers`       | passengers.js        | Statistik penumpang, advanced stats |
| `/api/passenger`        | passenger.js         | Lookup, match device, alerts, stats |
| `/api/cargo`            | cargo.js             | Cargo (CN-PIBK), statistik, upload |
| `/api/kurs`             | kurs.js              | Kurs pajak mingguan |
| `/api/manifests`        | manifests.js         | Manifest inbox, upload, sync, reparse, inbox poll/peek |
| `/api/dashboard`        | dashboard.js         | Executive dashboard (summary) |
| `/api/hs-codes`, `/api/hs` | hscodes.js        | HS Code, section/chapter, E-Note PDF |
| `/api/flights`          | flights.js           | Flight Radar, data penerbangan |
| `/api/suspects`         | suspects.js          | Watchlist suspect (CRUD, foto, aksi) |
| `/api/notifications`   | notifications.js     | Notifikasi, unread count |
| `/api/intelligence`     | intelligence.js      | Radar intel (ghost, mismatch, frequent, watchlist) |
| `/api/imei-registrations` | imei-registrations.js | Registrasi IMEI |
| `/api/imei-details`     | imei-details.js      | Detail IMEI (device-level), analytics |
| `/api/imei-integrity`   | imei-integrity.js    | Integritas data IMEI vs CEISA |
| `/api/price-intel`      | price-intel.js       | Referensi harga, gap analysis |
| `/api/scraper`          | scraper.js           | Bridge scraper CEISA, script browser, session, ingest |
| `/api/unified`          | unified.js           | Pencarian terpadu (multi-sumber) |
| `/api/intel`            | intel.js             | Pusat intelijen (dossier, dll) |

- **Health:** `GET /api/health` — status DB dan uptime.  
- **Static:** `/` menyajikan `public/index.html`.

### 5.3 Autentikasi API

- **Middleware:** `src/middleware/auth.js` — `requireAuth`, `optionalAuth`.  
- **Mekanisme:** Header `x-api-key` atau `Authorization: Bearer <key>`.  
- **Konfigurasi:** `SKYGUARD_API_KEY` di `.env`. Jika tidak diset, semua request diizinkan (dev).  
- **Route yang memakai `requireAuth`:** manifest (upload, bulk-reparse, bulk-sync, inbox/status, inbox/peek, inbox/poll), scraper (POST session, ingest, PUT session).

### 5.4 Services Penting

| Service                  | Fungsi Singkat |
|--------------------------|----------------|
| manifestInboxService     | IMAP (Gmail/dll), poll inbox, parsing email, kirim ke manifestIngestService; lock agar tidak double poll |
| manifestIngestService   | Simpan file manifest, panggil manifestService untuk parsing, simpan Manifest + ManifestPassenger |
| manifestService         | Parsing berbagai format manifest (DCS, API, CSV, XLSX, generic); deteksi maskapai (Lion, Scoot, dll) |
| crosscheckService       | Crosscheck manifest vs CEISA (passenger) |
| intelligenceService     | Ghost passengers, name mismatch, frequent travelers, watchlist; pakai cache 10 menit |
| passengerService        | Statistik penumpang, import CSV/Excel CEISA, match device (dengan PriceReference) |
| kursService             | Scrape kurs pajak, cache in-memory |
| flightService           | Polling data penerbangan (FR24/mock), cache |
| notificationService     | Notifikasi, link cargo–suspect (escape regex passport) |
| suspectService          | CRUD suspect, foto, timeline aksi |
| scraperService          | Session scraper CEISA, simpan ImeiDetail / ImeiRegistration |
| cargoService            | Agregasi cargo, statistik |

---

## 6. Database — MongoDB

- **Driver:** Mongoose.  
- **Koneksi:** `process.env.MONGODB_URI`. Opsi: `autoIndex: false`, pool min 5 / max 30.

### 6.1 Koleksi / Model (src/models/)

| Model               | Koleksi (umum)   | Kegunaan Singkat |
|---------------------|------------------|-------------------|
| Manifest            | manifests        | Manifest penerbangan (upload/email), status, parsed_fields |
| ManifestPassenger   | manifestpassengers | Penumpang per manifest (hasil parsing) |
| Passenger           | passengers       | Data CEISA penumpang (page 2 HKT), paspor, status_penelitian, hkt1/hkt2 |
| Device              | devices          | Referensi device (brand, model) untuk harga |
| PriceReference      | pricereferences  | Harga per device (price_usd, tax_idr, is_latest) |
| ImeiRegistration    | imeiregistrations | Registrasi IMEI (header level) |
| ImeiDetail          | imeidetails      | Detail per device IMEI (imei1, merk, tipe, harga_fob_usd, pungutan) |
| ScraperSession      | scrapersessions  | Session scraper CEISA (session_id, total_records, status) |
| Kurs                | kurses           | Kurs pajak mingguan |
| Cnpibk              | cnpibks          | Data cargo (CN-PIBK) |
| Suspect             | suspects         | Watchlist suspect (passport, risk_level, foto) |
| Notification        | notifications    | Notifikasi (type, priority, read status) |
| UploadLog           | uploadlogs       | Log upload (passenger/manifest) |
| Transaction         | transactions     | (Jika dipakai) transaksi terkait penumpang |

- **Naming:** Nama model PascalCase; nama koleksi biasanya plural lowercase dari model (Mongoose default).

---

## 7. Frontend — Detail

### 7.1 Teknologi

- **HTML5,** **CSS3,** **JavaScript (ES5/ES6)** — tanpa bundler; script inline dan file eksternal (CDN + lokal).  
- **Tailwind CSS** (CDN) — utility-first.  
- **Chart.js** (CDN) — grafik di HOME (command center) dan Dashboard.  
- **Leaflet** — peta untuk Flight Radar.  
- **Font Awesome** — ikon.  
- **Font:** Inter (Google Fonts).

### 7.2 Struktur Halaman (SPA)

- Satu file utama: `public/index.html`.  
- Navigasi utama (menu): HOME, PENCARIAN, IMEI, PENUMPANG, BARANG, CARGO, MANIFEST, INTELIJEN, FLIGHT RADAR, DASHBOARD, REGULASI.  
- Setiap menu menampilkan satu “content section” (`#content-<menu>`).  
- Submenu (mis. IMEI: Cek Harga, Kurs, Kalkulator, …) mengubah isi di dalam section tersebut.  
- **State:** Variabel global (e.g. `currentMainMenu`, `currentSubMenu`) dan `menuConfig` (objek konfigurasi menu + submenu).  
- **Komunikasi dengan backend:** `fetch()` ke `/api/...`. Respons umumnya JSON dengan field `status: "ok"` atau `status: "error"` dan `data` / `message`.

### 7.3 Aset

- **Logo:** `public/assets/logo-bc-kualanamu.png`.  
- **Path:** Referensi pakai `/assets/...` agar konsisten di berbagai path URL.

### 7.4 Modul Terpisah

- **HS Explorer:** `public/hs-explorer.js` — eksplorasi HS Code.  
- **Edit Price:** `public/edit-price.js` — edit harga referensi device.

---

## 8. Variabel Lingkungan (.env)

Contoh variabel yang dipakai (nama bisa sedikit berbeda; sesuaikan dengan `.env` di server):

| Variabel                 | Contoh / Keterangan |
|--------------------------|----------------------|
| MONGODB_URI              | Connection string MongoDB (wajib) |
| PORT                     | 3000 (default) |
| SKYGUARD_API_KEY         | API key untuk route yang pakai requireAuth (opsional; kalau kosong = dev mode) |
| CORS_ORIGINS             | Daftar origin yang diizinkan (dipisah koma); kosong = semua origin |
| MANIFEST_IMAP_ENABLED    | true / false |
| MANIFEST_IMAP_HOST       | imap.gmail.com |
| MANIFEST_IMAP_PORT       | 993 |
| MANIFEST_IMAP_USER       | email@contoh.com |
| MANIFEST_IMAP_PASS       | App password (bukan password login) |
| MANIFEST_IMAP_MAILBOX    | INBOX |
| MANIFEST_IMAP_SUBJECT    | Kata kunci subject (dipisah koma) |
| MANIFEST_IMAP_FROM       | Domain pengirim (dipisah koma, mis. gapura.id, lionair.co.id) |
| MANIFEST_IMAP_CRON       | Jadwal cron, mis. `*/3 * * * *` (setiap 3 menit) |

File `.env` tidak di-commit; di server harus ada salinan yang aman.

---

## 9. Menjalankan Aplikasi

### 9.1 Development (lokal)

```bash
# Install dependency
npm install

# Set variabel lingkungan (copy .env.example atau buat .env)
# Minimal: MONGODB_URI=...

# Jalankan
npm start
# atau: node src/app.js
```

- Frontend: buka `http://localhost:3000` (atau port yang dipakai).

### 9.2 Production (server dengan PM2)

```bash
# Build / tidak ada step build (proyek ini tanpa bundler)

# Start dengan PM2 (baca variabel dari .env)
pm2 start ecosystem.config.js --env production

# Restart setelah update kode
pm2 restart skyguard-api

# Log
pm2 logs skyguard-api
```

- **ecosystem.config.js:** Satu app `skyguard-api`, script `./src/app.js`, mode cluster, batas memori restart 2G, log ke `./logs/`.

### 9.3 Deploy dari lokal ke server

- Script `deploy-to-server.sh` (di repo): commit + push dari lokal, lalu SSH ke server untuk `git pull` dan `pm2 restart skyguard-api`.  
- **Jalankan script dari mesin lokal**, bukan dari dalam SSH ke server.  
- Variabel `DEPLOY_HOST` (mis. `root@ip-server`) bisa diset di env atau file `.env.deploy`.

---

## 10. Alur Data Penting (Ringkas)

1. **Manifest dari email**  
   Cron (manifestInboxService) poll IMAP → ambil attachment → manifestIngestService → simpan file + parsing (manifestService) → simpan Manifest + ManifestPassenger. Filter by subject/from (MANIFEST_IMAP_*). Force poll dari API bisa memproses email “seen” dan filter by subject (mis. TR untuk Scoot).

2. **IMEI / device**  
   Scraper browser (script dari `/api/scraper/script`) kirim data ke `/api/scraper/ingest` → scraperService simpan ke ImeiDetail / ImeiRegistration. Data ini dipakai untuk integritas (imei-integrity), price-intel, dan dashboard.

3. **Penumpang CEISA**  
   Upload CSV/Excel (passengerService) → simpan ke Passenger. Dipakai untuk statistik penumpang, lookup, intel (ghost, mismatch, frequent) dan crosscheck dengan manifest.

4. **Intelijen**  
   intelligenceService agregasi dari ManifestPassenger, Passenger, Suspect; hasil di-cache 10 menit. Cache di-invalidate setelah bulk sync manifest.

5. **Kurs pajak**  
   kursService scrape periodik (jadwal di init), disimpan di model Kurs; frontend baca dari API kurs.

---

## 11. Konvensi & Tips Kontribusi

- **Respons API:** Usahakan seragam: `{ status: "ok", data: ... }` atau `{ status: "error", message: "..." }`. Beberapa route lama pakai `success`/`error`; lama-kelamaan diseragamkan ke `status`/`message`.  
- **Validasi input:** Pakai `escapeRegex()` untuk string yang dipakai di RegExp; `parsePagination()` atau `parseInt(..., 10)` dengan batas untuk pagination; `isValidObjectId()` untuk `req.params.id` di route yang pakai MongoDB ObjectId.  
- **Error handling:** Route handler sebaiknya try/catch dan kirim status 4xx/5xx + JSON, jangan biarkan promise rejection tak tertangkap.  
- **Keamanan:** Jangan commit `.env`; endpoint sensitif (upload, bulk, inbox poll) memakai `requireAuth`.  
- **Dokumentasi:** Setelah mengubah perilaku API atau model, update dokumen ini atau README bila perlu.

---

## 12. Dokumentasi Lain

- **Rekomendasi fitur:** `docs/REKOMENDASI-FITUR.md` — ide fitur lanjutan (export laporan, notifikasi browser, timeline paspor, audit log, dll) untuk pengembangan berikutnya.

## 13. Kontak & Repositori

- **Repositori:** (sesuaikan dengan URL Git tim, mis. GitHub/GitLab).  
- **Dokumentasi teknis ini:** `docs/DOKUMENTASI-TEKNIS.md` — dapat dibaca di repo atau setelah clone di server.

Dokumen ini bisa disimpan di server (mis. di folder `docs/` setelah `git pull`) dan dibagikan ke tim untuk dipelajari sebelum bergabung kolaborasi.
