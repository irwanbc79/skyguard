/**
 * ceisaService.js
 * Parser manifest CEISA format XLSX (List Pengangkut)
 * Strategi penyimpanan: XLSX → CSV.gz (hemat ~77% vs XLSX asli)
 * Data dimasukkan ke MongoDB sebagai ManifestCeisaRecord
 */

const XLSX = require("xlsx");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const ManifestCeisa = require("../models/ManifestCeisa");
const ManifestCeisaRecord = require("../models/ManifestCeisaRecord");

const gzip = promisify(zlib.gzip);

const CEISA_UPLOAD_DIR = path.join(
  __dirname,
  "../../uploads/ceisa"
);

// Pastikan folder upload tersedia
if (!fs.existsSync(CEISA_UPLOAD_DIR)) {
  fs.mkdirSync(CEISA_UPLOAD_DIR, { recursive: true });
}

// Mapping header CEISA ke field internal
const HEADER_MAP = {
  "JENIS DOKUMEN": "jenis_dokumen",
  "NOMOR AJU": "nomor_aju",
  "NOMOR DAFTAR": "nomor_daftar",
  "TANGGAL DAFTAR": "tanggal_daftar",
  "SARANA ANGKUT": "sarana_angkut",
  "PELABUHAN ASAL": "pelabuhan_asal",
  "NPWP": "npwp",
  "NAMA PERUSAHAAN": "nama_perusahaan",
  "NOMOR VOYAGE / FLIGHT": "nomor_voyage",
  "TANGGAL TIBA": "tanggal_tiba",
  "TANGGAL BERANGKAT": "tanggal_berangkat",
  "MODA": "moda",
  "MMSI": "mmsi",
  "JUMLAH POS": "jumlah_pos",
  "JUMLAH CONTAINER": "jumlah_container",
  "VOLUME": "volume",
  "BERAT": "berat",
  "JUMLAH_KEMASAN": "jumlah_kemasan",
  "STATUS": "status_ceisa",
};

/**
 * Parse tanggal dari string CEISA: "17-01-2026" atau "17-01-2026 20:45:00"
 * Return null jika invalid atau "-"
 */
function parseCeisaDate(raw) {
  if (!raw || raw === "-" || String(raw).trim() === "") return null;
  const str = String(raw).trim();
  // Format: DD-MM-YYYY atau DD-MM-YYYY HH:MM:SS
  const match = str.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = match;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Tentukan direction dari jenis_dokumen
 */
function parseDirection(jenis) {
  if (!jenis) return "unknown";
  const lower = jenis.toLowerCase();
  if (lower.includes("inward")) return "inward";
  if (lower.includes("outward")) return "outward";
  return "unknown";
}

/**
 * Konversi worksheet SheetJS ke CSV string
 */
function worksheetToCsvString(ws) {
  return XLSX.utils.sheet_to_csv(ws, { FS: ",", RS: "\n" });
}

/**
 * Parse satu row data ke object ManifestCeisaRecord
 */
function parseRow(headers, rowArr, batchId) {
  const raw = {};
  headers.forEach((h, i) => {
    const field = HEADER_MAP[h];
    if (field) raw[field] = rowArr[i] ?? null;
  });

  return {
    batch_id: batchId,
    jenis_dokumen: raw.jenis_dokumen || null,
    direction: parseDirection(raw.jenis_dokumen),
    nomor_aju: raw.nomor_aju ? String(raw.nomor_aju).trim() : null,
    nomor_daftar: raw.nomor_daftar ? String(raw.nomor_daftar).trim() : null,
    tanggal_daftar: parseCeisaDate(raw.tanggal_daftar),
    sarana_angkut: raw.sarana_angkut ? String(raw.sarana_angkut).trim() : null,
    pelabuhan_asal: raw.pelabuhan_asal ? String(raw.pelabuhan_asal).trim() : null,
    npwp: raw.npwp ? String(raw.npwp).trim() : null,
    nama_perusahaan: raw.nama_perusahaan ? String(raw.nama_perusahaan).trim() : null,
    nomor_voyage: raw.nomor_voyage ? String(raw.nomor_voyage).trim() : null,
    tanggal_tiba: parseCeisaDate(raw.tanggal_tiba),
    tanggal_berangkat: parseCeisaDate(raw.tanggal_berangkat),
    moda: raw.moda ? String(raw.moda).trim() : "UDARA",
    mmsi: raw.mmsi ? String(raw.mmsi).trim() : null,
    jumlah_pos: Number(raw.jumlah_pos) || 0,
    jumlah_container: Number(raw.jumlah_container) || 0,
    volume: Number(raw.volume) || 0,
    berat: Number(raw.berat) || 0,
    jumlah_kemasan: Number(raw.jumlah_kemasan) || 0,
    status_ceisa: raw.status_ceisa ? String(raw.status_ceisa).trim() : null,
  };
}

/**
 * Derive label periode dari range tanggal tiba
 * Jika semua di bulan yang sama → "Januari 2026"
 * Jika multi-bulan → "Jan–Mar 2026"
 */
function derivePeriodeLabel(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return null;
  const MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const fromMonth = dateFrom.getMonth();
  const fromYear = dateFrom.getFullYear();
  const toMonth = dateTo.getMonth();
  const toYear = dateTo.getFullYear();

  if (fromYear === toYear && fromMonth === toMonth) {
    return `${MONTHS[fromMonth]} ${fromYear}`;
  }
  return `${MONTHS[fromMonth].slice(0, 3)}–${MONTHS[toMonth].slice(0, 3)} ${toYear}`;
}

/**
 * Fungsi utama: proses buffer XLSX CEISA
 * 1. Parse XLSX → ambil sheet "List Pengangkut"
 * 2. Konversi ke CSV.gz → simpan ke disk
 * 3. Parse tiap row → bulk insert ke MongoDB
 * 4. Buat/update dokumen ManifestCeisa (batch header)
 * Returns: { batch, inserted, skipped }
 */
async function processCeisaXlsx({ buffer, filename, uploadedBy = "manual" }) {
  // Buat batch header dulu (status: processing)
  const batch = await ManifestCeisa.create({
    original_filename: filename,
    uploaded_by: uploadedBy,
    status: "processing",
  });

  try {
    // 1. Parse XLSX
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

    // Cari sheet yang tepat (fleksibel)
    const targetSheet =
      workbook.SheetNames.find((n) =>
        n.toLowerCase().includes("pengangkut")
      ) || workbook.SheetNames[0];

    if (!targetSheet) throw new Error("Sheet 'List Pengangkut' tidak ditemukan dalam file.");

    const ws = workbook.Sheets[targetSheet];

    // 2. Konversi ke CSV.gz dan simpan
    const csvString = worksheetToCsvString(ws);
    const compressed = await gzip(Buffer.from(csvString, "utf-8"));
    const csvGzFilename = `ceisa_${batch._id}_${Date.now()}.csv.gz`;
    const csvGzPath = path.join(CEISA_UPLOAD_DIR, csvGzFilename);
    fs.writeFileSync(csvGzPath, compressed);

    // 3. Parse rows
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) throw new Error("File tidak berisi data (minimal 2 baris: header + 1 data).");

    const headers = rows[0].map((h) => (h ? String(h).trim() : ""));
    const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== null && v !== ""));

    const records = dataRows.map((row) => parseRow(headers, row, batch._id));

    // Hitung statistik batch
    let inwardCount = 0;
    let outwardCount = 0;
    const airlines = new Set();
    const dates = [];

    for (const r of records) {
      if (r.direction === "inward") inwardCount++;
      if (r.direction === "outward") outwardCount++;
      if (r.sarana_angkut) airlines.add(r.sarana_angkut);
      if (r.tanggal_tiba) dates.push(r.tanggal_tiba);
    }

    dates.sort((a, b) => a - b);
    const dateFrom = dates[0] || null;
    const dateTo = dates[dates.length - 1] || null;

    // 4. Bulk insert records (dalam batch 500)
    const CHUNK = 500;
    let inserted = 0;
    try {
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const result = await ManifestCeisaRecord.insertMany(chunk, { ordered: false });
        inserted += result.length;
      }
    } catch (insertErr) {
      // ordered:false bisa partial — cleanup semua yang sudah masuk lalu re-throw
      await ManifestCeisaRecord.deleteMany({ batch_id: batch._id });
      throw insertErr;
    }

    // 5. Update batch header
    batch.csv_gz_path = csvGzPath;
    batch.periode_label = derivePeriodeLabel(dateFrom, dateTo);
    batch.date_from = dateFrom;
    batch.date_to = dateTo;
    batch.total_records = inserted;
    batch.inward_count = inwardCount;
    batch.outward_count = outwardCount;
    batch.airlines = Array.from(airlines).sort();
    batch.status = "imported";
    await batch.save();

    return {
      batch,
      inserted,
      skipped: dataRows.length - inserted,
      csv_gz_size_kb: Math.round(compressed.length / 1024),
    };
  } catch (err) {
    batch.status = "failed";
    batch.error_message = err.message;
    await batch.save();
    throw err;
  }
}

module.exports = { processCeisaXlsx };
