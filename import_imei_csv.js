/**
 * Import IMEI Registration CSV data into MongoDB
 * Usage: node import_imei_csv.js <csv_file_path>
 *
 * CSV format: semicolon-delimited with columns:
 * No;Nama;Jns Identitas;No Identitas;Kebangsaan;NPWP/NIK;Vessel;
 * Tgl Kedatangan;No Dok;Tgl Dok;Total Pungutan;NIP Petugas;Id Registrasi;
 * Status Pembayaran;Kode Kantor
 */
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MONGO_URI =
  process.env.MONGODB_URI ||
  "mongodb://skyguard_app:SkyGuardApp2026%23@127.0.0.1:27017/skyguard?authSource=skyguard";

// Import model
const ImeiRegistration = require("./src/models/ImeiRegistration");

function normalizeVessel(v) {
  if (!v) return "";
  return v.replace(/[\s\-]/g, "").toUpperCase();
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseRow(line, headers) {
  // Handle BOM in header
  const cells = line.split(";");
  const obj = {};
  headers.forEach((h, i) => {
    obj[h.replace(/^\ufeff/, "").trim()] = (cells[i] || "").trim();
  });
  return obj;
}

async function importCSV(filePath) {
  console.log(`[IMEI Import] Starting import: ${filePath}`);
  const sourceFile = path.basename(filePath);

  // Connect to MongoDB
  await mongoose.connect(MONGO_URI);
  console.log("[IMEI Import] MongoDB connected");

  // Check for existing data from this file
  const existing = await ImeiRegistration.countDocuments({
    source_file: sourceFile,
  });
  if (existing > 0) {
    console.log(
      `[IMEI Import] WARNING: ${existing} records already exist from ${sourceFile}`,
    );
    console.log("[IMEI Import] Skipping duplicates by id_registrasi...");
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
    nationalities: {},
    offices: {},
    payments: {},
    vessels: {},
    dateRange: { min: null, max: null },
    totalPungutan: 0,
  };

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(";").map((h) => h.replace(/^\ufeff/, "").trim());
      console.log(`[IMEI Import] Columns: ${headers.join(", ")}`);
      continue;
    }

    total++;
    const r = parseRow(line, headers);

    // Skip if no identity
    if (!r["No Identitas"] && !r["Nama"]) {
      skipped++;
      continue;
    }

    const vessel = r["Vessel"] || "";
    const tglKedatangan = parseDate(r["Tgl Kedatangan"]);
    const pungutan = parseFloat(r["Total Pungutan"]) || 0;
    const nat = (r["Kebangsaan"] || "").toUpperCase();
    const office = r["Kode Kantor"] || "";
    const payment = r["Status Pembayaran"] || "UNKNOWN";

    // Stats
    stats.nationalities[nat] = (stats.nationalities[nat] || 0) + 1;
    stats.offices[office] = (stats.offices[office] || 0) + 1;
    stats.payments[payment] = (stats.payments[payment] || 0) + 1;
    stats.totalPungutan += pungutan;
    if (vessel) stats.vessels[vessel] = (stats.vessels[vessel] || 0) + 1;
    if (tglKedatangan) {
      if (!stats.dateRange.min || tglKedatangan < stats.dateRange.min)
        stats.dateRange.min = tglKedatangan;
      if (!stats.dateRange.max || tglKedatangan > stats.dateRange.max)
        stats.dateRange.max = tglKedatangan;
    }

    batch.push({
      updateOne: {
        filter: { id_registrasi: r["Id Registrasi"] },
        update: {
          $setOnInsert: {
            nama: (r["Nama"] || "").toUpperCase(),
            jenis_identitas: r["Jns Identitas"] || "PASSPORT",
            no_identitas: (r["No Identitas"] || "").toUpperCase(),
            kebangsaan: nat,
            npwp_nik: r["NPWP/NIK"] || "",
            vessel: vessel,
            vessel_normalized: normalizeVessel(vessel),
            tgl_kedatangan: tglKedatangan,
            no_dok: r["No Dok"] || "",
            tgl_dok: parseDate(r["Tgl Dok"]),
            total_pungutan: pungutan,
            status_pembayaran: [
              "PEMBEBASAN",
              "BILLING",
              "BPPM",
              "WAITINGLIST",
            ].includes(payment)
              ? payment
              : "UNKNOWN",
            nip_petugas: r["NIP Petugas"] || "",
            id_registrasi: r["Id Registrasi"] || "",
            kode_kantor: office,
            source_file: sourceFile,
          },
        },
        upsert: true,
      },
    });

    if (batch.length >= BATCH_SIZE) {
      try {
        const result = await ImeiRegistration.bulkWrite(batch, {
          ordered: false,
        });
        imported += result.upsertedCount;
        skipped += result.modifiedCount;
      } catch (e) {
        if (e.code === 11000) {
          // Duplicate key - count as skipped
          skipped += batch.length;
        } else {
          errors++;
          console.error("[IMEI Import] Batch error:", e.message);
        }
      }
      batch = [];
      if (total % 500 === 0) {
        process.stdout.write(`\r[IMEI Import] Processed: ${total}...`);
      }
    }
  }

  // Final batch
  if (batch.length > 0) {
    try {
      const result = await ImeiRegistration.bulkWrite(batch, {
        ordered: false,
      });
      imported += result.upsertedCount;
      skipped += result.modifiedCount;
    } catch (e) {
      if (e.code !== 11000) {
        errors++;
        console.error("[IMEI Import] Final batch error:", e.message);
      }
    }
  }

  const finalCount = await ImeiRegistration.countDocuments();

  console.log("\n");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║    IMEI REGISTRATION IMPORT COMPLETE     ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║ File:       ${sourceFile.padEnd(28)}║`);
  console.log(`║ Total rows: ${String(total).padEnd(28)}║`);
  console.log(`║ Imported:   ${String(imported).padEnd(28)}║`);
  console.log(`║ Skipped:    ${String(skipped).padEnd(28)}║`);
  console.log(`║ Errors:     ${String(errors).padEnd(28)}║`);
  console.log(`║ DB total:   ${String(finalCount).padEnd(28)}║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log(
    `║ Date range: ${(stats.dateRange.min ? stats.dateRange.min.toISOString().slice(0, 10) : "?").padEnd(28)}║`,
  );
  console.log(
    `║          to ${(stats.dateRange.max ? stats.dateRange.max.toISOString().slice(0, 10) : "?").padEnd(28)}║`,
  );
  console.log(
    `║ Pungutan:   Rp ${(stats.totalPungutan / 1e6).toFixed(1)}M`.padEnd(43) +
      "║",
  );
  console.log("╠══════════════════════════════════════════╣");

  // Top nationalities
  const natEntries = Object.entries(stats.nationalities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log("║ Top Nationalities:                       ║");
  natEntries.forEach(([k, v]) => {
    console.log(`║   ${k}: ${String(v).padEnd(34)}║`);
  });

  // Top offices
  const offEntries = Object.entries(stats.offices)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log("║ Top Offices:                             ║");
  offEntries.forEach(([k, v]) => {
    console.log(`║   ${k}: ${String(v).padEnd(34)}║`);
  });

  // Payment breakdown
  console.log("║ Payment Status:                          ║");
  Object.entries(stats.payments).forEach(([k, v]) => {
    console.log(`║   ${k}: ${String(v).padEnd(34)}║`);
  });

  console.log("╚══════════════════════════════════════════╝");

  await mongoose.disconnect();
}

// CLI entry
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node import_imei_csv.js <csv_file_path>");
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

importCSV(csvPath).catch((e) => {
  console.error("[IMEI Import] Fatal:", e);
  process.exit(1);
});
