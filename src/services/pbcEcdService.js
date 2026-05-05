/**
 * pbcEcdService.js
 * Parser untuk file "Data Barang Penumpang" export dari CEISA
 * Format header: nomorPenerbangan, pekerjaan, ..., waktuRekam (27 kolom)
 */

const XLSX = require("xlsx");
const PbcDataBatch = require("../models/PbcDataBatch");
const PbcEcdRecord = require("../models/PbcEcdRecord");

// Parse tanggal format DD-MM-YYYY atau DD-MM-YYYY HH:MM:SS (WIB)
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

async function processEcdXlsx({ buffer, filename, uploadedBy }) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  // Cari sheet yang punya kolom nomorDokumen
  let ws = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, range: 0 })[0] || [];
    if (firstRow.includes("nomorDokumen")) {
      ws = sheet;
      break;
    }
  }
  if (!ws) throw new Error("Sheet dengan kolom 'nomorDokumen' tidak ditemukan. Pastikan file adalah export Data Barang Penumpang dari CEISA.");

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== null && v !== ""));

  if (dataRows.length === 0) throw new Error("File tidak memiliki baris data.");

  // Build index: field name → column index
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[String(h).trim()] = i; });

  const get = (row, field) => (idx[field] !== undefined ? row[idx[field]] : null);

  let minDate = null, maxDate = null;
  let imeiCount = 0, jalurM = 0, jalurH = 0;

  const records = dataRows.map((row) => {
    const tanggal = parseDate(get(row, "tanggalKedatangan"));
    if (tanggal) {
      if (!minDate || tanggal < minDate) minDate = tanggal;
      if (!maxDate || tanggal > maxDate) maxDate = tanggal;
    }

    const kodeAtensi = str(get(row, "kodeAtensi"));
    const has_imei = kodeAtensi
      ? kodeAtensi.split(",").map((s) => s.trim()).includes("I")
      : false;

    if (has_imei) imeiCount++;
    const jalur = str(get(row, "kodeJalur"));
    if (jalur === "M") jalurM++;
    else if (jalur === "H") jalurH++;

    return {
      nomorDokumen: str(get(row, "nomorDokumen")),
      qrCode: str(get(row, "qrCode")),
      paspor: str(get(row, "paspor")),
      nama: str(get(row, "nama")),
      kebangsaan: str(get(row, "kebangsaan")),
      nomorPenerbangan: str(get(row, "nomorPenerbangan")),
      kodeJalur: jalur,
      statusDokumen: str(get(row, "statusDokumen")),
      kodeAtensi,
      has_imei,
      tanggalKedatangan: tanggal,
      nipPetugasPindai: str(get(row, "nipPetugasPindai")),
      namaPetugasPindai: str(get(row, "namaPetugasPindai")),
      nipPetugasPemeriksa: str(get(row, "nipPetugasPemeriksa")),
      namaPetugasPemeriksa: str(get(row, "namaPetugasPemeriksa")),
      nipPetugasPeneliti: str(get(row, "nipPetugasPeneliti")),
      namaPetugasPeneliti: str(get(row, "namaPetugasPeneliti")),
      waktuScanQr: parseDate(get(row, "waktuScanQr")),
      waktuPemeriksaan: parseDate(get(row, "waktuPemeriksaan")),
      waktuPenelitian: parseDate(get(row, "waktuPenelitian")),
      waktuRekam: parseDate(get(row, "waktuRekam")),
      kodeKantor: str(get(row, "kodeKantor")),
      period_month: tanggal ? tanggal.getMonth() + 1 : null,
      period_year: tanggal ? tanggal.getFullYear() : null,
    };
  });

  // Buat batch record
  const batch = await PbcDataBatch.create({
    source_type: "barang_penumpang",
    source_label: "Data Barang Penumpang (ECD)",
    original_filename: filename,
    period_month: minDate ? minDate.getMonth() + 1 : null,
    period_year: minDate ? minDate.getFullYear() : null,
    uploaded_by: uploadedBy,
    status: "processing",
    notes: `${records.length} record | ${imeiCount} atensi IMEI | Jalur M:${jalurM} H:${jalurH} | ${minDate?.toISOString().slice(0, 10)} s.d. ${maxDate?.toISOString().slice(0, 10)}`,
  });

  // Insert per chunk 500
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK).map((r) => ({ ...r, batch_id: batch._id }));
    try {
      const result = await PbcEcdRecord.insertMany(chunk, { ordered: false });
      inserted += result.length;
    } catch (e) {
      // ordered:false — hitung yang berhasil
      if (e.insertedDocs) inserted += e.insertedDocs.length;
    }
  }

  batch.total_records = inserted;
  batch.status = "imported";
  await batch.save();

  return { batch, total: inserted, imeiCount, jalurM, jalurH, dateRange: { from: minDate, to: maxDate } };
}

// Hitung periode triwulan berdasarkan manual IKI DJBC
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
