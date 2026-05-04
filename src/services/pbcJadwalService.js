/**
 * pbcJadwalService.js
 * Parser jadwal bulanan KPPBC TMP B Kualanamu
 *
 * Dua format yang didukung:
 * 1. SCHEDULE: Terminal / Ekspor-Impor — wide format, per hari per kolom
 * 2. ASSIGNMENT: PBC / Pelaksana — list statis tempat tugas
 */

const XLSX = require("xlsx");
const PbcDataBatch = require("../models/PbcDataBatch");
const PbcScheduleRecord = require("../models/PbcScheduleRecord");

// Shift yang dianggap bukan hari kerja
const NON_WORKING_SHIFTS = new Set(["L", "LP", "LS", "LB", "SAKIT", "CUTI", "TL"]);

/**
 * Tentukan apakah shift dihitung sebagai hari kerja
 */
function isWorking(shift) {
  if (!shift || String(shift).trim() === "") return false;
  return !NON_WORKING_SHIFTS.has(String(shift).trim().toUpperCase());
}

/**
 * Parse nama + NIP dari cell "NAMA\r\nNIP" atau "NAMA\nNIP"
 * Juga handle format "NAMA*\r\nNIP"
 */
function parseNamaNip(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const parts = str.split(/\r?\n/);
  if (parts.length < 2) return null;

  const nama = parts[0].replace(/\*/g, "").trim();
  // NIP: cari string yang mengandung minimal 10 digit angka berurutan
  let nip = null;
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts[i].replace(/\s/g, "");
    if (/\d{10,}/.test(candidate)) {
      nip = candidate.match(/\d{10,}/)[0];
      break;
    }
  }
  if (!nama || !nip) return null;
  return { nama, nip };
}

/**
 * Deteksi dan parse sheet format jadwal (Terminal / Ekspor-Impor)
 * Ciri: ada row dengan bilangan bulat berurutan 1..28+ sebagai tanggal
 *
 * Returns array of { nip, nama, tanggal, shift, is_working, section }
 */
function parseScheduleSheet(ws, sheetName, month, year, batchId) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Cari baris tanggal (row berisi angka 1..n berurutan, minimal 28)
  let dateRowIdx = -1;
  let dateColStart = -1;
  let numDays = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Cari index kolom pertama yang berisi 1
    const startIdx = r.findIndex((v) => v === 1);
    if (startIdx === -1) continue;
    // Hitung berapa angka berurutan dari 1
    let count = 0;
    for (let j = startIdx; j < r.length; j++) {
      if (r[j] === count + 1) count++;
      else break;
    }
    if (count >= 28) {
      dateRowIdx = i;
      dateColStart = startIdx;
      numDays = count;
      break;
    }
  }

  if (dateRowIdx === -1) return null; // bukan format jadwal

  const records = [];

  for (let i = dateRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Kolom NAMA/NIP selalu index 1
    const namaNip = parseNamaNip(row[1]);
    if (!namaNip) continue; // baris separator / keterangan

    const { nama, nip } = namaNip;

    for (let d = 0; d < numDays; d++) {
      const dateNum = d + 1; // tanggal 1..numDays
      const shift = row[dateColStart + d];
      const shiftStr = shift !== null && shift !== undefined ? String(shift).trim() : "L";

      // Skip kolom yang tidak ada nilai (bukan berarti libur — mungkin kolom kosong di akhir)
      if (d < numDays && shift === null) {
        // Untuk bulan yang < 31 hari, kolom sisa = null → skip
        try {
          new Date(year, month - 1, dateNum);
          if (dateNum > new Date(year, month, 0).getDate()) continue;
        } catch {}
      }

      records.push({
        batch_id: batchId,
        nip,
        nama,
        tanggal: new Date(year, month - 1, dateNum),
        shift: shiftStr || "L",
        is_working: isWorking(shiftStr),
        section: sheetName,
        period_month: month,
        period_year: year,
      });
    }
  }

  return records;
}

/**
 * Parse sheet format penugasan statis (PBC / Pelaksana)
 * Kolom: NAMA/NIP | PANGKAT/GOLONGAN | JABATAN | TEMPAT TUGAS / URAIAN
 *
 * Returns array of assignment objects (disimpan sebagai PbcDataRecord terpisah)
 */
function parseAssignmentSheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const assignments = [];

  for (const row of rows) {
    if (!row[0]) continue;
    const namaNip = parseNamaNip(row[0]);
    if (!namaNip) continue;

    assignments.push({
      nip: namaNip.nip,
      nama: namaNip.nama,
      pangkat: row[1] ? String(row[1]).trim() : null,
      jabatan: row[2] ? String(row[2]).trim() : null,
      tempat_tugas: row[3] ? String(row[3]).replace(/\r?\n/g, " ").trim() : null,
      section: sheetName,
    });
  }

  return assignments;
}

/**
 * Fungsi utama: proses buffer XLSX jadwal bulanan
 * Parse semua sheet, simpan ke PbcScheduleRecord + summary ke PbcDataBatch
 */
async function processJadwalXlsx({ buffer, filename, month, year, uploadedBy }) {
  const batch = await PbcDataBatch.create({
    source_type: "jadwal",
    source_label: `Jadwal ${getNamaBulan(month)} ${year}`,
    original_filename: filename,
    period_month: Number(month),
    period_year: Number(year),
    uploaded_by: uploadedBy,
    status: "processing",
  });

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    let totalScheduleRecords = 0;
    const processedSheets = [];

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];

      // Coba parse sebagai jadwal harian
      const scheduleRecords = parseScheduleSheet(ws, sheetName, Number(month), Number(year), batch._id);

      if (scheduleRecords && scheduleRecords.length > 0) {
        // Hapus data lama untuk batch ini + sheet ini (kalau re-upload)
        const CHUNK = 500;
        let inserted = 0;
        for (let i = 0; i < scheduleRecords.length; i += CHUNK) {
          const result = await PbcScheduleRecord.insertMany(
            scheduleRecords.slice(i, i + CHUNK),
            { ordered: false }
          );
          inserted += result.length;
        }
        totalScheduleRecords += inserted;
        processedSheets.push(`${sheetName} (${inserted} record)`);
      } else {
        // Format penugasan — simpan ke notes saja
        const assignments = parseAssignmentSheet(ws, sheetName);
        if (assignments.length > 0) {
          processedSheets.push(`${sheetName} (${assignments.length} penugasan — info saja)`);
        }
      }
    }

    batch.total_records = totalScheduleRecords;
    batch.notes = `Sheet diproses: ${processedSheets.join(", ")}`;
    batch.status = "imported";
    await batch.save();

    return { batch, totalScheduleRecords, processedSheets };
  } catch (err) {
    batch.status = "failed";
    batch.error_message = err.message;
    await batch.save();
    throw err;
  }
}

function getNamaBulan(m) {
  const BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return BULAN[Number(m)] || String(m);
}

module.exports = { processJadwalXlsx };
