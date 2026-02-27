/**
 * Import IMEI Detail CSV data into MongoDB
 * This imports device-level detail (IMEI, brand, model, storage, pricing, taxes)
 * Usage: node import_imei_detail.js <csv_file_path>
 *
 * CSV format: semicolon-delimited with 39 columns
 */
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MONGO_URI =
  process.env.MONGODB_URI ||
  "mongodb://skyguard_app:SkyGuardApp2026%23@127.0.0.1:27017/skyguard?authSource=skyguard";

const ImeiDetail = require("./src/models/ImeiDetail");

function normalizeFlight(v) {
  if (!v) return "";
  return v.replace(/[\s\-]/g, "").toUpperCase();
}

function parseDate(s) {
  if (!s) return null;
  // Handle DD-MM-YYYY format
  const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  // Handle DD-MM-YYYY HH:MM:SS
  const ddmmyyyyTime = s.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/,
  );
  if (ddmmyyyyTime) {
    const d = new Date(
      `${ddmmyyyyTime[3]}-${ddmmyyyyTime[2]}-${ddmmyyyyTime[1]}T${ddmmyyyyTime[4]}`,
    );
    return isNaN(d.getTime()) ? null : d;
  }
  // Handle YYYY-MM-DD HH:MM:SS
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStorage(s) {
  if (!s) return null;
  const clean = s.toUpperCase().replace(/\s/g, "");
  const tbMatch = clean.match(/(\d+)\s*TB/i);
  if (tbMatch) return parseInt(tbMatch[1]) * 1024;
  const gbMatch = clean.match(/(\d+)/);
  if (gbMatch) return parseInt(gbMatch[1]);
  return null;
}

function extractKantor(noDok) {
  // Extract from "031489/CD/HKT/050100/2026"
  if (!noDok) return "";
  const parts = noDok.split("/");
  if (parts.length >= 4) return parts[3];
  return "";
}

function parsePercent(s) {
  if (!s) return "0%";
  return s.toString().includes("%") ? s.trim() : s.trim() + "%";
}

function parseRow(line, headers) {
  const cells = line.split(";");
  const obj = {};
  headers.forEach((h, i) => {
    obj[h.replace(/^\ufeff/, "").trim()] = (cells[i] || "").trim();
  });
  return obj;
}

async function importCSV(filePath) {
  console.log(`[IMEI Detail] Starting import: ${filePath}`);
  const sourceFile = path.basename(filePath);

  await mongoose.connect(MONGO_URI);
  console.log("[IMEI Detail] MongoDB connected");

  const existing = await ImeiDetail.countDocuments({ source_file: sourceFile });
  if (existing > 0) {
    console.log(
      `[IMEI Detail] WARNING: ${existing} records from ${sourceFile} exist. Upserting...`,
    );
  }

  const fileStream = fs.createReadStream(filePath, "utf-8");
  const rl = readline.createInterface({ input: fileStream });

  let headers = null;
  let batch = [];
  let total = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const BATCH_SIZE = 200;

  const stats = {
    brands: {},
    payments: {},
    offices: {},
    nationalities: {},
    totalDevices: 0,
    totalFobUsd: 0,
    totalPungutan: 0,
    imeiCount: 0,
    dateRange: { min: null, max: null },
  };

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(";").map((h) => h.replace(/^\ufeff/, "").trim());
      console.log(
        `[IMEI Detail] Columns (${headers.length}): ${headers.join(", ")}`,
      );
      continue;
    }

    total++;
    const r = parseRow(line, headers);

    const regId = parseInt(r["ID"]) || 0;
    const deviceNo = parseInt(r["No"]) || 1;

    if (!regId) {
      skipped++;
      continue;
    }

    const flightVoyage = r["Flight Voyage"] || "";
    const waktuKedatangan = parseDate(r["Waktu Kedatangan"]);
    const merk = (r["Merk"] || "").toUpperCase();
    const imei1 = r["IMEI1"] || "";
    const imei2 = r["IMEI2"] || "";
    const hargaFobUsd = parseFloat(r["Harga FOB USD"]) || 0;
    const totalPungutan = parseFloat(r["Total Pungutan"]) || 0;
    const kantor = extractKantor(r["No Dokumen"]);
    const nat = (r["Kebangsaan"] || "").toUpperCase();
    const payment = r["Cara Pembayaran"] || "UNKNOWN";

    // Stats
    if (merk) stats.brands[merk] = (stats.brands[merk] || 0) + 1;
    stats.payments[payment] = (stats.payments[payment] || 0) + 1;
    if (kantor) stats.offices[kantor] = (stats.offices[kantor] || 0) + 1;
    if (nat) stats.nationalities[nat] = (stats.nationalities[nat] || 0) + 1;
    stats.totalDevices++;
    stats.totalFobUsd += hargaFobUsd;
    stats.totalPungutan += totalPungutan;
    if (imei1) stats.imeiCount++;
    if (waktuKedatangan) {
      if (!stats.dateRange.min || waktuKedatangan < stats.dateRange.min)
        stats.dateRange.min = waktuKedatangan;
      if (!stats.dateRange.max || waktuKedatangan > stats.dateRange.max)
        stats.dateRange.max = waktuKedatangan;
    }

    batch.push({
      updateOne: {
        filter: { registration_id: regId, device_no: deviceNo },
        update: {
          $setOnInsert: {
            registration_id: regId,
            no_dokumen: r["No Dokumen"] || "",
            tgl_dokumen: parseDate(r["Tgl Dokumen"]),
            nama: (r["Nama"] || "").toUpperCase(),
            no_identitas: (r["No Identitas"] || "").toUpperCase(),
            kebangsaan: nat,
            npwp_nik: r["NPWP/NIK"] || "",
            flight_voyage: flightVoyage,
            flight_normalized: normalizeFlight(flightVoyage),
            waktu_kedatangan: waktuKedatangan,
            waktu_rekam: parseDate(r["Waktu Rekam Petugas"]),
            cara_pembayaran: [
              "PEMBEBASAN",
              "BILLING",
              "BPPM",
              "WAITINGLIST",
            ].includes(payment)
              ? payment
              : "UNKNOWN",
            kode_billing: r["Kode Billing"] || "",
            tgl_billing: parseDate(r["Tgl Billing"]),
            ndpbm: parseFloat(r["NDPBM"]) || 0,
            pembebasan_usd: parseFloat(r["Pembebasan USD"]) || 0,
            device_no: deviceNo,
            merk: merk,
            tipe: (r["Tipe"] || "").toUpperCase(),
            storage: r["Storage"] || "",
            storage_normalized: normalizeStorage(r["Storage"]),
            ram: r["RAM"] || "",
            warna: r["Warna"] || "",
            imei1: imei1,
            imei2: imei2,
            harga_fob: parseFloat(r["Harga FOB"]) || 0,
            mata_uang: r["Mata Uang"] || "USD",
            harga_fob_usd: hargaFobUsd,
            hs_code: r["HS Code"] || "8517.13.00",
            bekas: r["Bekas"] === "Y",
            cif_usd: parseFloat(r["CIF USD"]) || 0,
            total_cif_usd: parseFloat(r["Total CIF USD"]) || 0,
            total_cif_pembebasan_usd:
              parseFloat(r["Total CIF Pembebasan USD"]) || 0,
            nilai_pabean_rp: parseFloat(r["Nilai Pabean Rp"]) || 0,
            tarif_bm: parsePercent(r["Tarif BM"]),
            pungutan_bm: parseFloat(r["Pungutan BM"]) || 0,
            tarif_ppn: parsePercent(r["Tarif PPN"]),
            pungutan_ppn: parseFloat(r["Pungutan PPN"]) || 0,
            tarif_pph: parsePercent(r["Tarif PPh"]),
            pungutan_pph: parseFloat(r["Pungutan PPh"]) || 0,
            total_pungutan: totalPungutan,
            kode_kantor: kantor,
            source_file: sourceFile,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      try {
        const result = await ImeiDetail.bulkWrite(batch, { ordered: false });
        imported += result.upsertedCount + result.modifiedCount;
      } catch (e) {
        if (e.writeErrors) {
          errors += e.writeErrors.length;
          imported += batch.length - e.writeErrors.length;
        } else {
          console.error("[IMEI Detail] Batch error:", e.message);
          errors += batch.length;
        }
      }
      batch = [];
      if (total % 3000 === 0)
        console.log(`[IMEI Detail] Processed: ${total}...`);
    }
  }

  // Final batch
  if (batch.length > 0) {
    try {
      const result = await ImeiDetail.bulkWrite(batch, { ordered: false });
      imported += result.upsertedCount + result.modifiedCount;
    } catch (e) {
      if (e.writeErrors) {
        errors += e.writeErrors.length;
        imported += batch.length - e.writeErrors.length;
      } else {
        errors += batch.length;
      }
    }
  }

  const dbTotal = await ImeiDetail.countDocuments();
  const uniqueImei = await ImeiDetail.distinct("imei1").then(
    (a) => a.filter(Boolean).length,
  );

  // Sort stats
  const topBrands = Object.entries(stats.brands)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topOffices = Object.entries(stats.offices)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topNats = Object.entries(stats.nationalities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log(`
╔══════════════════════════════════════════════╗
║      IMEI DETAIL IMPORT COMPLETE             ║
╠══════════════════════════════════════════════╣
║ File:         ${sourceFile.padEnd(28)}║
║ Total rows:   ${String(total).padEnd(28)}║
║ Imported:     ${String(imported).padEnd(28)}║
║ Skipped:      ${String(skipped).padEnd(28)}║
║ Errors:       ${String(errors).padEnd(28)}║
║ DB total:     ${String(dbTotal).padEnd(28)}║
║ Unique IMEI:  ${String(uniqueImei).padEnd(28)}║
╠══════════════════════════════════════════════╣
║ Date range: ${stats.dateRange.min ? stats.dateRange.min.toISOString().slice(0, 10) : "N/A"}                         ║
║          to ${stats.dateRange.max ? stats.dateRange.max.toISOString().slice(0, 10) : "N/A"}                         ║
║ Total FOB:    $${(stats.totalFobUsd / 1000).toFixed(1)}K USD${" ".repeat(16)}║
║ Pungutan:     Rp ${(stats.totalPungutan / 1e6).toFixed(1)}M${" ".repeat(17)}║
╠══════════════════════════════════════════════╣
║ Top Brands:                                  ║`);
  topBrands.forEach(([k, v]) => {
    console.log(
      `║   ${k.padEnd(16)} ${String(v).padStart(6)}                      ║`,
    );
  });
  console.log(`║ Top Nationalities:                           ║`);
  topNats.forEach(([k, v]) => {
    console.log(
      `║   ${k.padEnd(16)} ${String(v).padStart(6)}                      ║`,
    );
  });
  console.log(`║ Top Offices:                                 ║`);
  topOffices.forEach(([k, v]) => {
    console.log(
      `║   ${k.padEnd(16)} ${String(v).padStart(6)}                      ║`,
    );
  });
  console.log(`║ Payment Status:                              ║`);
  Object.entries(stats.payments)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      console.log(
        `║   ${k.padEnd(16)} ${String(v).padStart(6)}                      ║`,
      );
    });
  console.log("╚══════════════════════════════════════════════╝");

  await mongoose.disconnect();
}

const csvFile = process.argv[2];
if (!csvFile) {
  console.error("Usage: node import_imei_detail.js <csv_file>");
  process.exit(1);
}

importCSV(csvFile).catch((err) => {
  console.error("[IMEI Detail] Fatal:", err);
  process.exit(1);
});
