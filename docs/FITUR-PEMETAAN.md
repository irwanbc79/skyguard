# Pemetaan Fitur SkyGuard — Anti-Double & Batas Jelas

Dokumen ini memastikan **tidak ada fitur ganda** yang membingungkan pengguna. Setiap fitur baru punya batas jelas terhadap fitur yang sudah ada.

---

## 1. Pencarian

| Fitur | Lokasi | Backend | Fungsi |
|-------|--------|---------|--------|
| **Pencarian Sentral** (utama) | Menu **PENCARIAN** → halaman Pencarian Terpadu | `GET /api/unified/multi-search` → `GET /api/unified/search/:passport` | Satu pintu cari paspor, nama, IMEI, flight, dokumen; hasil lengkap (profil, timeline, CEISA, device). |
| **Pencarian Lanjutan** | Menu **INTELIJEN** → Pencarian Lanjutan | `GET /api/intel/search` | Pencarian dengan filter tanggal & kebangsaan; fokus intelijen. |
| **Pencarian Cepat (Ctrl+K)** *(baru)* | Modal dari mana saja (shortcut) | **Sama**: `GET /api/unified/multi-search` | **Bukan fitur baru backend** — hanya pintu cepat ke Pencarian Sentral. Hasil ringkas di modal; "Buka lengkap" → redirect ke menu PENCARIAN dengan query yang sama. |

**Kesimpulan:** Satu mesin pencarian (unified multi-search + search/:passport). Ctrl+K = akses cepat ke fitur yang sama, bukan pencarian kedua.

---

## 2. Export & Laporan

| Fitur | Lokasi | Backend | Fungsi |
|-------|--------|---------|--------|
| **Export Data Penumpang** | Menu **PENUMPANG** → Download Data | `GET /api/passenger/export?date_from&date_to&status&paspor` | Export **data mentah** CEISA (Excel/CSV) per periode — untuk analisis/backup. |
| **Export CSV Cargo** | Menu **CARGO** → tombol Export | Client-side dari tabel CN-PIBK | Export **data tampilan** cargo ke CSV. |
| **Export CSV Manifest** | Menu **MANIFEST** → Inbox (per manifest) | `GET /api/manifests/:id/passengers/export` | Export **daftar penumpang satu manifest** ke CSV. |
| **Export Laporan Periodik** *(baru)* | Menu **DASHBOARD** → bagian "Laporan Periodik" | `GET /api/reports/summary?period=week\|month&format=pdf\|excel` | Export **ringkasan eksekutif** (agregat: total manifest, penumpang, IMEI, top rute) — untuk pimpinan, **bukan** data mentah. |

**Kesimpulan:** Export data = data mentah/per item (sudah ada). Export laporan = ringkasan periodik (fitur baru). Nama dan tempat UI berbeda supaya tidak tumpang tindih.

---

## 3. Ringkas: Yang Sudah Ada vs Yang Ditambah

- **Pencarian:** Sudah ada Pencarian Sentral + Pencarian Lanjutan (Intel). Yang ditambah: **shortcut Ctrl+K** yang membuka modal dan memakai API Pencarian Sentral yang sama; tidak ada API atau halaman pencarian baru yang duplikat.
- **Laporan:** Sudah ada export data (penumpang, cargo, manifest). Yang ditambah: **Laporan Periodik** (ringkasan mingguan/bulanan) di Dashboard dengan endpoint `/api/reports/summary`; nama "Laporan Periodik" / "Export Laporan" dipakai konsisten agar beda dari "Export Data Penumpang".

Dokumentasi teknis: [DOKUMENTASI-TEKNIS.md](./DOKUMENTASI-TEKNIS.md). Rekomendasi fitur lanjutan: [REKOMENDASI-FITUR.md](./REKOMENDASI-FITUR.md).
