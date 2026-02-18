/**
 * apisService.js
 * Parser untuk data APIS (Advance Passenger Information System)
 *
 * Mendukung dua format:
 * 1. APIS AirAsia/QZ/AK — file terpisah "apis XXX.txt"
 * 2. GSPM Lion Air — nomor paspor embedded di baris manifest "MANIFEST JT133.txt"
 */

const fs = require('fs');
const path = require('path');

// ─── Utilitas Tanggal ─────────────────────────────────────────────────────────

/**
 * Parse tanggal format YYMMDD → Date object
 * Ambang batas: YY > tahun saat ini + 10 → 1900-an, selainnya → 2000-an
 */
function parseDateYYMMDD(str) {
  if (!str || str.length !== 6) return null;
  const yy = parseInt(str.slice(0, 2), 10);
  const mm = parseInt(str.slice(2, 4), 10) - 1;
  const dd = parseInt(str.slice(4, 6), 10);
  const currentYY = new Date().getFullYear() % 100;
  const year = yy <= currentYY + 20 ? 2000 + yy : 1900 + yy;
  try {
    const d = new Date(year, mm, dd);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

// ─── Format 1: APIS AirAsia/QZ ───────────────────────────────────────────────

/**
 * Parse file APIS format AirAsia/QZ
 * Setiap penumpang terdiri dari 2 baris:
 *   Baris 1: "  N) PNR  NAMA_BELAKANG  NAMA_DEPAN  [NAMA_TENGAH]"
 *   Baris 2: "       GENDER YYMMDD  NAT  RES  WL Ver Sb  DOCTYPE  DOCNUM  YYMMDD  CY"
 *
 * Contoh:
 *   1) ACW44T AB SAMAH                  NORAZAM
 *            M 691114   MY  MY      Y N    P            A72050530 250431  MY
 *
 * @param {string} text - Isi raw file APIS
 * @returns {Array<Object>} - Array data penumpang yang sudah diparsing
 */
function parseApisText(text) {
  const lines = text.split(/\r?\n/);
  const passengers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Baris entry penumpang: "  N) PNR(6) ..."
    const entryMatch = line.match(/^\s+(\d+)\)\s+([A-Z0-9]{6})\s+(.+?)\s*$/);
    if (!entryMatch) continue;

    const [, , pnr, nameRaw] = entryMatch;

    // Baris detail berikutnya
    const nextLine = lines[i + 1];
    if (!nextLine) continue;

    // Ekstrak: gender, DOB, nat, res, ..., doctype, docnum, expiry, country
    // Pattern: GENDER YYMMDD NAT RES [flags] DOCTYPE DOCNUM EXPIRY COUNTRY
    const detailMatch = nextLine.match(
      /\s+(M|F)\s+(\d{6})\s+([A-Z]{2})\s+([A-Z]{2}).*?\b([PV])\s+(\S+)\s+(\d{6})\s+([A-Z]{2})\s*$/
    );

    if (!detailMatch) {
      i++; // tetap skip baris detail meski gagal parse
      continue;
    }

    const [, gender, dobStr, nationality, residence, docType, docNumber, expStr, countryIssue] =
      detailMatch;

    // Pisahkan nama belakang dan nama depan (dipisah 2+ spasi)
    const nameParts = nameRaw.trim().split(/\s{2,}/);
    const lastName = (nameParts[0] || '').trim();
    const firstName = (nameParts[1] || '').trim();
    const middleName = (nameParts[2] || '').trim();
    const fullNameApis = [lastName, firstName, middleName].filter(Boolean).join(' ');

    passengers.push({
      pnr,
      last_name: lastName,
      first_name: firstName,
      middle_name: middleName || null,
      full_name_apis: fullNameApis,
      gender,
      dob: parseDateYYMMDD(dobStr),
      nationality,
      residence,
      doc_type: docType,
      doc_number: docNumber.trim(),
      doc_expiry: parseDateYYMMDD(expStr),
      country_of_issue: countryIssue
    });

    i++; // Skip baris detail yang sudah diproses
  }

  return passengers;
}

// ─── Format 2: GSPM Lion Air ─────────────────────────────────────────────────

/**
 * Parse nomor dokumen dari format manifest Lion Air / GSPM
 * Setiap baris penumpang: "SEAT GENDER NAME  NAT DOCNUM"
 * Contoh: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
 *
 * Kembalikan Map: { name_key → { nationality, doc_number, gender, seat } }
 * name_key = nama dalam huruf kapital tanpa gelar (MR/MRS/MS/MISS/MSTR)
 *
 * @param {string} text - Isi raw file MANIFEST GSPM
 * @returns {Map<string, Object>}
 */
function parseGspmDocNumbers(text) {
  const lines = text.split(/\r?\n/);
  const result = new Map();
  let inPassengerSection = false;

  for (const line of lines) {
    if (/^SEAT\s+GEN\s+NAME/i.test(line)) {
      inPassengerSection = true;
      continue;
    }
    if (!inPassengerSection) continue;
    if (!line.trim()) continue;

    // Baris penumpang: " 26F  F  ABIDIN LINA MRS   ID X1356564"
    // Format: <SEAT(4)> <GENDER(1)> <NAME...> <NAT(2-3)> <SPACE?> <DOCNUM>
    const paxMatch = line.match(
      /^\s{0,3}(\d{1,3}[A-Z])\s+(M|F|I)\s{2}(.+?)\s{3,}([A-Z]{2,3})\s*(\S+)\s*$/
    );
    if (!paxMatch) continue;

    const [, seat, gender, nameFull, natCode, docNumber] = paxMatch;

    // Bersihkan nama dari gelar dan karakter khusus
    const cleanName = nameFull
      .replace(/\b(MR|MRS|MS|MISS|MSTR|DR|PROF)\b\.?/gi, '')
      .replace(/[¥*#]/g, '')
      .trim()
      .toUpperCase();

    // Normalkan kode negara ke 2 huruf (IDN → ID)
    const nationalityCode = natCode.length === 3 ? natCode.slice(0, 2) : natCode;

    // Abaikan baris yang tidak memiliki nomor dokumen valid
    if (!docNumber || docNumber.length < 4) continue;

    result.set(cleanName, {
      nationality: nationalityCode,
      doc_number: docNumber.trim(),
      doc_type: 'P', // Assume passport untuk penumpang internasional
      gender,
      seat_no: seat
    });
  }

  return result;
}

// ─── Deteksi File APIS ────────────────────────────────────────────────────────

/**
 * Cari file APIS yang menjadi pasangan dari file manifest
 * Cari di direktori yang sama dengan pola: apis*.txt atau APIS*.txt
 *
 * @param {string} manifestFilePath - Path lengkap file manifest
 * @returns {string|null} - Path file APIS atau null jika tidak ditemukan
 */
function findApisFile(manifestFilePath) {
  try {
    const dir = path.dirname(manifestFilePath);
    const entries = fs.readdirSync(dir);
    const apisFile = entries.find(f => /^apis\s*\d+.*\.txt$/i.test(f));
    if (apisFile) return path.join(dir, apisFile);
  } catch {
    // Direktori tidak bisa dibaca
  }
  return null;
}

/**
 * Cek apakah file adalah format GSPM Lion Air
 * Deteksi: baris pertama mengandung "GSPM" atau header "PASSENGER MANIFEST" dengan format Lion
 *
 * @param {string} text - Isi file manifest
 * @returns {boolean}
 */
function isGspmFormat(text) {
  const firstLines = text.slice(0, 500);
  return /^GSPM\d+/m.test(firstLines) || /LION\s+AIR/i.test(firstLines);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  parseApisText,
  parseGspmDocNumbers,
  findApisFile,
  isGspmFormat,
  parseDateYYMMDD
};
