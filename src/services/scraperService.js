/**
 * Scraper Service - Handles ingestion of browser-scraped CEISA data
 * Receives batches of parsed IMEI detail records from browser console script
 * and imports them directly into MongoDB (same logic as import_imei_detail.js)
 */
const ImeiDetail = require("../models/ImeiDetail");
const ScraperSession = require("../models/ScraperSession");

// ── Helpers (same as import_imei_detail.js) ──

function normalizeFlight(v) {
  if (!v) return "";
  return v.replace(/[\s\-]/g, "").toUpperCase();
}

function parseDate(s) {
  if (!s) return null;
  const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const ddmmyyyyTime = s.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/,
  );
  if (ddmmyyyyTime) {
    const d = new Date(
      `${ddmmyyyyTime[3]}-${ddmmyyyyTime[2]}-${ddmmyyyyTime[1]}T${ddmmyyyyTime[4]}`,
    );
    return isNaN(d.getTime()) ? null : d;
  }
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
  if (!noDok) return "";
  const parts = noDok.split("/");
  if (parts.length >= 4) return parts[3];
  return "";
}

function parsePercent(s) {
  if (!s) return "0%";
  return s.toString().includes("%") ? s.trim() : s.trim() + "%";
}

// ── Session Management ──

async function createSession(config) {
  const session_id = `scrape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session = await ScraperSession.create({
    session_id,
    type: config.type || "imei_detail",
    total_pages: config.total_pages || 0,
    date_range: {
      start: config.date_start || "",
      end: config.date_end || "",
    },
    user_agent: config.user_agent || "",
    notes: config.notes || "",
    status: "running",
    started_at: new Date(),
    last_activity: new Date(),
  });
  console.log(`[Scraper] Session created: ${session_id}`);
  return session;
}

async function getSession(session_id) {
  return ScraperSession.findOne({ session_id }).lean();
}

async function getLatestSession() {
  return ScraperSession.findOne().sort({ started_at: -1 }).lean();
}

async function getAllSessions(limit = 20) {
  return ScraperSession.find().sort({ started_at: -1 }).limit(limit).lean();
}

async function updateSessionStatus(session_id, status, extra = {}) {
  const update = { status, last_activity: new Date(), ...extra };
  if (status === "completed" || status === "error" || status === "cancelled") {
    update.completed_at = new Date();
  }
  return ScraperSession.findOneAndUpdate({ session_id }, update, {
    new: true,
  }).lean();
}

// ── Core Ingest Logic ──

/**
 * Ingest a batch of scraped records
 * Each record is a semicolon-delimited string matching the CSV HEADERS format
 * OR an object with named fields
 */
async function ingestBatch(session_id, records, meta = {}) {
  const session = await ScraperSession.findOne({ session_id });
  if (!session) throw new Error(`Session ${session_id} not found`);
  if (session.status === "cancelled") throw new Error("Session cancelled");

  const HEADERS = [
    "ID",
    "No Dokumen",
    "Tgl Dokumen",
    "Nama",
    "No Identitas",
    "Kebangsaan",
    "NPWP/NIK",
    "Flight Voyage",
    "Waktu Kedatangan",
    "Waktu Rekam Petugas",
    "Cara Pembayaran",
    "Kode Billing",
    "Tgl Billing",
    "NDPBM",
    "Pembebasan USD",
    "No",
    "Merk",
    "Tipe",
    "Storage",
    "RAM",
    "Warna",
    "IMEI1",
    "IMEI2",
    "Harga FOB",
    "Mata Uang",
    "Harga FOB USD",
    "HS Code",
    "Bekas",
    "CIF USD",
    "Total CIF USD",
    "Total CIF Pembebasan USD",
    "Nilai Pabean Rp",
    "Tarif BM",
    "Pungutan BM",
    "Tarif PPN",
    "Pungutan PPN",
    "Tarif PPh",
    "Pungutan PPh",
    "Total Pungutan",
  ];

  const batch = [];
  const batchStats = {
    new: 0,
    dup: 0,
    err: 0,
    brands: {},
    nats: {},
    fob: 0,
    pungutan: 0,
  };

  for (const record of records) {
    try {
      // Parse record - accept both string (semicolon) and object
      let r = {};
      if (typeof record === "string") {
        const cells = record.split(";");
        HEADERS.forEach((h, i) => {
          r[h] = (cells[i] || "").trim();
        });
      } else {
        r = record;
      }

      const regId = parseInt(r["ID"]) || 0;
      const deviceNo = parseInt(r["No"]) || 1;

      if (!regId) {
        batchStats.err++;
        continue;
      }

      const flightVoyage = r["Flight Voyage"] || "";
      const waktuKedatangan = parseDate(r["Waktu Kedatangan"]);
      const merk = (r["Merk"] || "").toUpperCase();
      const imei1 = r["IMEI1"] || "";
      const hargaFobUsd = parseFloat(r["Harga FOB USD"]) || 0;
      const totalPungutan = parseFloat(r["Total Pungutan"]) || 0;
      const kantor = extractKantor(r["No Dokumen"]);
      const nat = (r["Kebangsaan"] || "").toUpperCase();
      const payment = r["Cara Pembayaran"] || "UNKNOWN";

      // Track stats
      if (merk) batchStats.brands[merk] = (batchStats.brands[merk] || 0) + 1;
      if (nat) batchStats.nats[nat] = (batchStats.nats[nat] || 0) + 1;
      batchStats.fob += hargaFobUsd;
      batchStats.pungutan += totalPungutan;

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
              imei2: r["IMEI2"] || "",
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
              source_file: `scraper_${session_id}`,
            },
          },
          upsert: true,
        },
      });
    } catch (e) {
      batchStats.err++;
    }
  }

  // Execute bulkWrite
  if (batch.length > 0) {
    try {
      const result = await ImeiDetail.bulkWrite(batch, { ordered: false });
      batchStats.new = result.upsertedCount || 0;
      batchStats.dup = batch.length - batchStats.new - batchStats.err;
    } catch (e) {
      if (e.writeErrors) {
        batchStats.err += e.writeErrors.length;
        batchStats.new = batch.length - e.writeErrors.length;
      } else {
        batchStats.err += batch.length;
        console.error("[Scraper] Batch error:", e.message);
      }
    }
  }

  // Update session stats
  const brandUpdates = {};
  for (const [k, v] of Object.entries(batchStats.brands)) {
    brandUpdates[`brands.${k}`] = v;
  }
  const natUpdates = {};
  for (const [k, v] of Object.entries(batchStats.nats)) {
    natUpdates[`nationalities.${k}`] = v;
  }

  await ScraperSession.findOneAndUpdate(
    { session_id },
    {
      $inc: {
        total_records: records.length,
        new_records: batchStats.new,
        duplicate_records: batchStats.dup,
        error_records: batchStats.err,
        batches_received: 1,
        total_fob_usd: batchStats.fob,
        total_pungutan: batchStats.pungutan,
        ...brandUpdates,
        ...natUpdates,
      },
      $set: {
        current_page: meta.current_page || 0,
        last_activity: new Date(),
        elapsed_seconds: meta.elapsed_seconds || 0,
      },
    },
  );

  const dbTotal = await ImeiDetail.countDocuments();

  return {
    batch_size: records.length,
    new: batchStats.new,
    duplicates: batchStats.dup,
    errors: batchStats.err,
    db_total: dbTotal,
  };
}

// ── Stats ──

async function getDbStats() {
  const [total, uniqueImei, brands, recentSessions] = await Promise.all([
    ImeiDetail.countDocuments(),
    ImeiDetail.distinct("imei1").then((a) => a.filter(Boolean).length),
    ImeiDetail.aggregate([
      { $group: { _id: "$merk", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    ScraperSession.find().sort({ started_at: -1 }).limit(5).lean(),
  ]);

  return {
    total_records: total,
    unique_imei: uniqueImei,
    top_brands: brands.map((b) => ({ brand: b._id, count: b.count })),
    recent_sessions: recentSessions.map((s) => ({
      session_id: s.session_id,
      status: s.status,
      records: s.total_records,
      new: s.new_records,
      started: s.started_at,
      elapsed: s.elapsed_seconds,
    })),
  };
}

module.exports = {
  createSession,
  getSession,
  getLatestSession,
  getAllSessions,
  updateSessionStatus,
  ingestBatch,
  getDbStats,
};
