# Portal SkyGuard — Deploy aman & rollback

Dokumen ini mengurangi risiko saat deploy ke server yang sedang dipakai petugas (bandara).

---

## 1. Sebelum deploy (wajib: backup)

Dari direktori root proyek di server:

```bash
cd ~/skyguard
bash scripts/backup-skyguard-portal.sh
```

Hasilnya:
- Folder `backups/portal-YYYYMMDD-HHMMSS/` berisi salinan `public/index.html` dan `public/js/` (jika ada).
- Symlink `backups/portal-latest` menunjuk ke backup terbaru.

**Atau manual:**

```bash
cp public/index.html "public/index.html.bak-$(date +%Y%m%d%H%M%S)"
```

---

## 2. Deploy

```bash
git pull origin main
npm install   # WAJIB setiap pull jika package.json/package-lock berubah (hindari MODULE_NOT_FOUND)
pm2 restart skyguard-api
```

Jika `curl` ke `/api/health` mengembalikan **000** atau PM2 **↺ (restart)** naik terus: cek `pm2 logs skyguard-api --lines 40 --nostream` — biasanya modul Node hilang; jalankan lagi `npm install` setelah `git pull`.

Petugas: **hard refresh** browser (Ctrl+Shift+R / Cmd+Shift+R) jika halaman tampak aneh.

---

## 3. Cek cepat (portal tidak down)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/js/skyguard-ui.js
```

Harus **200** untuk `/`, health, dan file JS baru.

---

## 4. Rollback jika portal bermasalah

**Pakai backup skrip (disarankan):**

```bash
cd ~/skyguard
cp backups/portal-latest/index.html public/index.html
# jika saat backup ada folder js:
rsync -a backups/portal-latest/js/ public/js/ 2>/dev/null || true
pm2 restart skyguard-api
```

**Atau dari file `.bak` manual:**

```bash
cp public/index.html.bak-XXXXXXXX public/index.html
pm2 restart skyguard-api
```

Rollback **hanya mengembalikan file statis**; database dan API Node tidak di-rollback otomatis. Jika masalah dari kode `src/`, rollback Git:

```bash
git log --oneline -5
git checkout <commit_sebelum_deploy> -- public/index.html public/js/
pm2 restart skyguard-api
```

---

## 5. Prinsip refactor aman

- Perubahan bertahap; satu jenis per deploy jika memungkinkan.
- File eksternal `public/js/skyguard-*.js` punya **fallback** di `index.html` jika file tidak ter-load (toast → alert; `SgApi` → definisi minimal).
- Jangan hapus backup sampai deploy stabil ±24 jam.

---

## 6. Kontak darurat operasional

- Simpan nomor/ channel tim yang bisa `ssh` ke server dan menjalankan perintah di atas.
