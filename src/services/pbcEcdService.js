/**
 * pbcEcdService.js
 * Parser untuk file "Data Barang Penumpang" export dari CEISA (BC 2.2).
 *
 * Strategi storage: hanya simpan record kodeAtensi=I (atensi IMEI) ke MongoDB.
 * Record lain (non-IMEI) diproses di memori untuk statistik, lalu dibuang.
 * Hasilnya: 28.700 rows → ~16 rows yang disimpan per 7 hari (~99.9% lebih hemat).
 * Summary lengkap (total_scan, jalur, atensi lain) disimpan di PbcDataBatch.notes.
 */

const XLSX = require("xlsx");
const PbcDataBatch = require("../models/PbcDataBatch");
const PbcEcdRecord = require("../models/PbcEcdRecord");

function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", min = "00", ss = "00"] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`);
  return isNaN(d.getTime()) ? null : d;
}

function str(v) {
  return v !== null && v !== undefined && v !== "" ? String(v).trim() : null;
}

function hasImei(kodeAtensi) {
  if (!kodeAtensi) return false;
  return String(kodeAtensi).split(",").map((s) => s.trim()).includes("I");
}

async function processEcdXlsx({ buffer, filename, uploadedBy }) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  // Cari sheet yang mengandung kolom nomorDokumen
  let ws = null;
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, range: 0 });
    if ((rows[0] || []).includes("nomorDokumen")) {
      ws = workbook.Sheets[name];
      break;
    }
  }
  if (!ws) throw new Error("Sheet dengan kolom 'nomorDokumen' tidak ditemukan. Pastikan file adalah export Data Barang Penumpang dari CEISA.");

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== null && v !== ""));
  if (dataRows.length === 0) throw new Error("File tidak memiliki baris data.");

  const idx = {};
  headers.forEach((h, i) => { if (h) idx[String(h).trim()] = i; });
  const get = (row, field) => (idx[field] !== undefined ? row[idx[field]] : null);

  // Statistik untuk semua baris (disimpan di notes, bukan MongoDB)
  let totalScan = 0, jalurM = 0, jalurH = 0;
  let atensiD = 0, atensiI = 0, atensiA = 0;
  let minDate = null, maxDate = null;

  // Hanya record IMEI yang masuk MongoDB
  const imeiRecords = [];

  for (const row of dataRows) {
    totalScan++;
    const tanggal = parseDate(get(row, "tanggalKedatangan"));
    if (tanggal) {
      if (!minDate || tanggal < minDate) minDate = tanggal;
      if (!maxDate || tanggal > maxDate) maxDate = tanggal;
    }

    const jalur = str(get(row, "kodeJalur"));
    if (jalur === "M") jalurM++; else if (jalur === "H") jalurH++;

    const kodeAtensi = str(get(row, "kodeAtensi"));
    if (kodeAtensi) {
      const parts = kodeAtensi.split(",").map((s) => s.trim());
      if (parts.includes("D")) atensiD++;
      if (parts.includes("I")) atensiI++;
      if (parts.includes("A")) atensiA++;
    }

    // Hanya simpan ke DB jika ada atensi IMEI
    if (!hasImei(kodeAtensi)) continue;

    imeiRecords.push({
      paspor: str(get(row, "paspor")),
      nama: str(get(row, "nama")),
      nomorPenerbangan: str(get(row, "nomorPenerbangan")),
      kodeJalur: jalur,
      kodeAtensi,
      tanggalKedatangan: tanggal,
      nipPetugasPindai: str(get(row, "nipPetugasPindai")),
      namaPetugasPindai: str(get(row, "namaPetugasPindai")),
      waktuScanQr: parseDate(get(row, "waktuScanQr")),
      waktuPenelitian: parseDate(get(row, "waktuPenelitian")),
      kodeKantor: str(get(row, "kodeKantor")),
      period_month: tanggal ? tanggal.getMonth() + 1 : null,
      period_year: tanggal ? tanggal.getFullYear() : null,
    });
  }

  // Summary lengkap tersimpan di PbcDataBatch — tidak perlu simpan baris non-IMEI
  const summaryNotes = JSON.stringify({
    total_scan: totalScan,
    jalur_m: jalurM,
    jalur_h: jalurH,
    atensi_narkoba: atensiD,
    atensi_imei: atensiI,
    atensi_lain: atensiA,
    date_from: minDate?.toISOString().slice(0, 10),
    date_to: maxDate?.toISOString().slice(0, 10),
    storage_note: `Hanya ${atensiI} record IMEI yang disimpan ke DB dari ${totalScan} total scan.`,
  });

  const batch = await PbcDataBatch.create({
    source_type: "barang_penumpang",
    source_label: "Data Barang Penumpang (ECD)",
    original_filename: filename,
    period_month: minDate ? minDate.getMonth() + 1 : null,
    period_year: minDate ? minDate.getFullYear() : null,
    uploaded_by: uploadedBy,
    status: "processing",
    notes: summaryNotes,
  });

  // Bulk insert — hanya record IMEI
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < imeiRecords.length; i += CHUNK) {
    const chunk = imeiRecords.slice(i, i + CHUNK).map((r) => ({ ...r, batch_id: batch._id }));
    try {
      const result = await PbcEcdRecord.insertMany(chunk, { ordered: false });
      inserted += result.length;
    } catch (e) {
      if (e.insertedDocs) inserted += e.insertedDocs.length;
    }
  }

  batch.total_records = inserted;
  batch.status = "imported";
  await batch.save();

  return {
    batch,
    total_scan: totalScan,
    imei_inserted: inserted,
    jalurM,
    jalurH,
    atensiD,
    atensiI,
    dateRange: { from: minDate, to: maxDate },
  };
}

// Periode triwulan resmi DJBC per Manual IKI
function getTriwulanDates(triwulan, year) {
  const Y = Number(year);
  switch (Number(triwulan)) {
    case 1: return { start: new Date(`${Y - 1}-12-16T00:00:00+07:00`), end: new Date(`${Y}-03-15T23:59:59+07:00`) };
    case 2: return { start: new Date(`${Y}-03-16T00:00:00+07:00`), end: new Date(`${Y}-06-15T23:59:59+07:00`) };
    case 3: return { start: new Date(`${Y}-06-16T00:00:00+07:00`), end: new Date(`${Y}-09-15T23:59:59+07:00`) };
    case 4: return { start: new Date(`${Y}-09-16T00:00:00+07:00`), end: new Date(`${Y}-12-15T23:59:59+07:00`) };
    default: throw new Error("Triwulan harus 1–4");
  }
}

module.exports = { processEcdXlsx, getTriwulanDates };
