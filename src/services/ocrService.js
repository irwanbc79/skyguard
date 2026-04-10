/**
 * ocrService.js
 * OCR dokumen PMI menggunakan tesseract CLI + sharp preprocessing
 * Mendukung: JPG, PNG, WEBP (foto HP, scan, screenshot)
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
const os = require("os");

const execFileAsync = promisify(execFile);

let sharp;
try {
  sharp = require("sharp");
} catch (_) {
  /* optional — OCR tetap jalan tanpa preprocessing */
}

// ── Preprocessing gambar untuk akurasi OCR lebih baik ────────────────────────
async function preprocessImage(inputPath, outputPath) {
  if (!sharp) {
    // Tanpa sharp — pakai file asli
    fs.copyFileSync(inputPath, outputPath);
    return;
  }
  await sharp(inputPath)
    .resize({ width: 2000, height: 2800, fit: "inside", withoutEnlargement: false })
    .greyscale()
    .normalise()        // auto contrast
    .sharpen()
    .png()
    .toFile(outputPath);
}

// ── Jalankan tesseract CLI ────────────────────────────────────────────────────
async function runTesseract(imagePath) {
  // Output ke file tmp, baca hasilnya
  const outBase = imagePath.replace(/\.[^.]+$/, "_ocr_out");
  try {
    await execFileAsync("tesseract", [
      imagePath,
      outBase,
      "-l", "ind+eng",
      "--psm", "3",       // auto page segmentation
      "--oem", "3",       // LSTM engine
    ], { timeout: 30000 });

    const txtPath = outBase + ".txt";
    const text = fs.existsSync(txtPath)
      ? fs.readFileSync(txtPath, "utf8")
      : "";
    fs.unlink(txtPath, () => {});
    return text;
  } catch (err) {
    throw new Error("Tesseract gagal: " + err.message);
  }
}

// ── Parser: ekstrak field PMI dari teks OCR ───────────────────────────────────
function parsePmiFields(text) {
  if (!text || !text.trim()) return {};

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const full = text.toUpperCase();
  const result = {};

  // ── Nama ──────────────────────────────────────────────────────────────────
  // Pola: "Nama : SITI HASANAH" atau "NAMA LENGKAP : ..."
  const namaMatch = text.match(
    /(?:nama\s*(?:lengkap)?\s*[:\-–]?\s*)([A-Z][A-Z\s]{3,50})/i
  );
  if (namaMatch) result.nama = namaMatch[1].trim().toUpperCase();

  // ── No Kartu PMI / KTKLN ──────────────────────────────────────────────────
  // Format BP2MI: huruf + angka, contoh: BP2MI-2024-xxx atau angka panjang
  const kartuPatterns = [
    /(?:no\.?\s*kartu|nomor\s*kartu|no\.?\s*pmi|ktkln)\s*[:\-–]?\s*([A-Z0-9\-\/]{6,30})/i,
    /\b([A-Z]{2,5}[\-\/]?\d{4}[\-\/]?\d{4,10})\b/,
    /\b(\d{10,20})\b/,
  ];
  for (const pat of kartuPatterns) {
    const m = text.match(pat);
    if (m) { result.no_kartu_pmi = m[1].trim(); break; }
  }

  // ── Lembaga penerbit ──────────────────────────────────────────────────────
  if (full.includes("BP2MI") || full.includes("BNP2TKI")) {
    result.lembaga = "BP2MI";
  } else if (full.includes("KEMENAKER") || full.includes("KEMENTERIAN TENAGA KERJA")) {
    result.lembaga = "Kemenaker";
  } else if (full.includes("BNPTKI")) {
    result.lembaga = "BNPTKI";
  }

  // ── Negara tujuan ─────────────────────────────────────────────────────────
  const negaraKeywords = [
    "MALAYSIA", "SINGAPURA", "SINGAPORE", "ARAB SAUDI", "SAUDI ARABIA",
    "HONG KONG", "TAIWAN", "KOREA", "JEPANG", "JAPAN", "QATAR",
    "UEA", "UAE", "DUBAI", "KUWAIT", "BAHRAIN", "OMAN",
  ];
  for (const neg of negaraKeywords) {
    if (full.includes(neg)) {
      result.negara_tujuan = neg
        .replace("SINGAPURA", "Singapura")
        .replace("SINGAPORE", "Singapura")
        .replace("ARAB SAUDI", "Arab Saudi")
        .replace("SAUDI ARABIA", "Arab Saudi")
        .replace("HONG KONG", "Hong Kong")
        .replace("TAIWAN", "Taiwan")
        .replace("KOREA", "Korea Selatan")
        .replace("JEPANG", "Jepang")
        .replace("JAPAN", "Jepang")
        .replace("QATAR", "Qatar")
        .replace("UEA", "UEA")
        .replace("UAE", "UEA")
        .replace("DUBAI", "UEA")
        .replace("KUWAIT", "Kuwait")
        .replace("BAHRAIN", "Bahrain")
        .replace("OMAN", "Oman")
        .replace("MALAYSIA", "Malaysia");
      break;
    }
  }

  // ── Tanggal berlaku ───────────────────────────────────────────────────────
  // Format: DD/MM/YYYY, DD-MM-YYYY, DD MMMM YYYY
  const MONTHS = {
    januari:1, februari:2, maret:3, april:4, mei:5, juni:6,
    juli:7, agustus:8, september:9, oktober:10, november:11, desember:12,
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
  };

  // "berlaku s.d." / "masa berlaku" / "valid until" / "expired"
  const tglPatterns = [
    /(?:berlaku\s*s\.?d\.?|masa\s*berlaku\s*(?:s\.?d\.?)?|valid\s*until|expired?)\s*[:\-–]?\s*(\d{1,2})[\/\-\s](\d{1,2}|\w+)[\/\-\s](\d{2,4})/i,
    /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december)\s+(\d{4})/i,
  ];
  for (const pat of tglPatterns) {
    const m = text.match(pat);
    if (m) {
      try {
        const day = parseInt(m[1]);
        const monthRaw = m[2];
        const year = parseInt(m[3]) + (parseInt(m[3]) < 100 ? 2000 : 0);
        const month = isNaN(parseInt(monthRaw))
          ? (MONTHS[monthRaw.toLowerCase()] || 1)
          : parseInt(monthRaw);
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime()) && d > new Date("2020-01-01")) {
          result.tgl_berlaku = d.toISOString().slice(0, 10);
        }
      } catch (_) {}
      break;
    }
  }

  // ── Confidence: berapa banyak field berhasil diekstrak ───────────────────
  const extracted = Object.keys(result).length;
  result._confidence = extracted === 0 ? "LOW" : extracted <= 2 ? "MEDIUM" : "HIGH";
  result._raw_text_preview = text.slice(0, 300).replace(/\s+/g, " ").trim();

  return result;
}

// ── Main: proses satu file gambar → fields ────────────────────────────────────
async function extractPmiFromImage(filePath) {
  const tmpDir  = os.tmpdir();
  const tmpFile = path.join(tmpDir, "pmi_ocr_" + Date.now() + ".png");

  try {
    await preprocessImage(filePath, tmpFile);
    const text   = await runTesseract(tmpFile);
    const fields = parsePmiFields(text);
    return { ok: true, fields };
  } catch (err) {
    return { ok: false, error: err.message, fields: {} };
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}

module.exports = { extractPmiFromImage, parsePmiFields };
