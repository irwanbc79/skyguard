const Passenger = require("../models/Passenger");
const UploadLog = require("../models/UploadLog");
const XLSX = require("xlsx");

const MAX_EXCEL_ROWS = 20000;
const MAX_EXCEL_COLS = 200;

function calculateRiskScore(totalVisits, uniqueDevices, billingCount) {
  const score = totalVisits * 2 + uniqueDevices * 3 + billingCount * 5;
  let level = "GREEN",
    color = "#22c55e";
  if (score >= 30 || totalVisits >= 10 || uniqueDevices >= 8) {
    level = "RED";
    color = "#ef4444";
  } else if (score >= 15 || totalVisits >= 5 || uniqueDevices >= 4) {
    level = "YELLOW";
    color = "#eab308";
  }
  return { score, level, color };
}

function parseCeisaDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  const match = str.match(
    /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/,
  );
  if (match) {
    const [, day, month, year, hour = "00", min = "00", sec = "00"] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
  }
  return new Date(str);
}

async function getByPaspor(paspor) {
  const records = await Passenger.find({ paspor: paspor.toUpperCase() }).sort({
    tanggal_dokumen: -1,
  });
  if (!records.length) return null;
  // Collect ALL devices from both hkt1 and hkt2
  const allDevices = [];
  records.forEach((r) => {
    if (r.hkt1) allDevices.push(r.hkt1);
    if (r.hkt2) allDevices.push(r.hkt2);
  });
  const devices = [...new Set(allDevices)];
  const billingCount = records.filter(
    (r) => r.status_penelitian === "BILLING",
  ).length;

  // Build device detail: each unique device with count, dates, statuses
  const deviceMap = {};
  records.forEach((r) => {
    [r.hkt1, r.hkt2].filter(Boolean).forEach((dev) => {
      if (!deviceMap[dev])
        deviceMap[dev] = {
          name: dev,
          count: 0,
          dates: [],
          statuses: [],
          documents: [],
        };
      deviceMap[dev].count++;
      if (r.tanggal_dokumen) deviceMap[dev].dates.push(r.tanggal_dokumen);
      if (r.status_penelitian)
        deviceMap[dev].statuses.push(r.status_penelitian);
      deviceMap[dev].documents.push({
        nomor: r.nomor_dokumen,
        tanggal: r.tanggal_dokumen,
        status: r.status_penelitian,
        petugas: r.nama_petugas,
      });
    });
  });
  const deviceDetails = Object.values(deviceMap).sort(
    (a, b) => b.count - a.count,
  );

  return {
    paspor: paspor.toUpperCase(),
    summary: {
      totalVisits: records.length,
      uniqueDevices: devices.length,
      devices,
      billingCount,
      pembebasanCount: records.filter(
        (r) => r.status_penelitian === "PEMBEBASAN",
      ).length,
      firstVisit: records[records.length - 1]?.tanggal_dokumen,
      lastVisit: records[0]?.tanggal_dokumen,
      totalDevicesRegistered: allDevices.length,
    },
    deviceDetails,
    risk: calculateRiskScore(records.length, devices.length, billingCount),
    records,
  };
}

async function getRepeaters(minVisits = 5) {
  const results = await Passenger.aggregate([
    {
      $group: {
        _id: "$paspor",
        visits: { $sum: 1 },
        devices1: { $addToSet: "$hkt1" },
        devices2: { $addToSet: "$hkt2" },
        billingCount: {
          $sum: { $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0] },
        },
        firstVisit: { $min: "$tanggal_dokumen" },
        lastVisit: { $max: "$tanggal_dokumen" },
        nama: { $first: "$nama_lengkap" },
      },
    },
    { $match: { visits: { $gte: minVisits } } },
    { $sort: { visits: -1 } },
    { $limit: 100 },
  ]);
  return results.map((r) => {
    const allDevices = [
      ...new Set([...r.devices1, ...r.devices2].filter(Boolean)),
    ];
    return {
      paspor: r._id,
      nama: r.nama,
      visits: r.visits,
      unique_devices: allDevices.length,
      devices: allDevices,
      billing_count: r.billingCount,
      first_visit: r.firstVisit,
      last_visit: r.lastVisit,
      risk: calculateRiskScore(r.visits, allDevices.length, r.billingCount),
    };
  });
}

// ==================== ADVANCED STATS ====================

async function getStats() {
  const [totalRecords, totalPassengers, topDevices, lastUpload] =
    await Promise.all([
      Passenger.countDocuments(),
      Passenger.distinct("paspor").then((arr) => arr.length),
      Passenger.aggregate([
        { $match: { hkt1: { $ne: null, $ne: "" } } },
        { $group: { _id: "$hkt1", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      UploadLog.findOne().sort({ uploaded_at: -1 }),
    ]);

  // Frequent Travelers (>= 3 visits)
  const frequentTravelers = await Passenger.aggregate([
    { $group: { _id: "$paspor", visits: { $sum: 1 } } },
    { $match: { visits: { $gte: 3 } } },
    { $count: "total" },
  ]);

  // IMEI Collectors (>= 4 unique devices)
  const imeiCollectors = await Passenger.aggregate([
    { $group: { _id: "$paspor", devices: { $addToSet: "$hkt1" } } },
    {
      $project: {
        nama: 1,
        deviceCount: {
          $size: {
            $filter: { input: "$devices", as: "d", cond: { $ne: ["$$d", ""] } },
          },
        },
      },
    },
    { $match: { deviceCount: { $gte: 4 } } },
    { $count: "total" },
  ]);

  return {
    totalRecords,
    totalPassengers,
    frequentTravelers: frequentTravelers[0]?.total || 0,
    imeiCollectors: imeiCollectors[0]?.total || 0,
    topDevices: topDevices.map((d) => ({ device: d._id, count: d.count })),
    lastUpload,
  };
}

async function getAdvancedStats() {
  // 1. Monthly Trend (last 12 months)
  const monthlyTrend = await Passenger.aggregate([
    {
      $group: {
        _id: {
          year: { $year: "$tanggal_dokumen" },
          month: { $month: "$tanggal_dokumen" },
        },
        total: { $sum: 1 },
        billing: {
          $sum: { $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0] },
        },
        pembebasan: {
          $sum: {
            $cond: [{ $eq: ["$status_penelitian", "PEMBEBASAN"] }, 1, 0],
          },
        },
        uniquePassengers: { $addToSet: "$paspor" },
      },
    },
    {
      $project: {
        _id: 1,
        total: 1,
        billing: 1,
        pembebasan: 1,
        uniquePassengers: { $size: "$uniquePassengers" },
      },
    },
    { $sort: { "_id.year": -1, "_id.month": -1 } },
    { $limit: 12 },
  ]);

  // 2. Status Breakdown
  const statusBreakdown = await Passenger.aggregate([
    { $group: { _id: "$status_penelitian", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // 3. Top Petugas (by records handled)
  const topPetugas = await Passenger.aggregate([
    { $match: { nama_petugas: { $ne: "", $ne: null } } },
    {
      $group: {
        _id: "$nip_petugas",
        nama: { $first: "$nama_petugas" },
        total: { $sum: 1 },
        billing: {
          $sum: { $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0] },
        },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);

  // 4. Device Brand Distribution
  const brandDistribution = await Passenger.aggregate([
    { $match: { hkt1: { $ne: "", $ne: null } } },
    {
      $project: {
        brand: { $arrayElemAt: [{ $split: ["$hkt1", " "] }, 0] },
      },
    },
    { $group: { _id: "$brand", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // 5. Hourly Distribution (peak hours)
  const hourlyDistribution = await Passenger.aggregate([
    { $project: { hour: { $hour: "$waktu_rekam" } } },
    { $group: { _id: "$hour", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  // 6. High Risk Passengers (frequent + many devices + billing)
  const highRiskPassengers = await Passenger.aggregate([
    {
      $group: {
        _id: "$paspor",
        visits: { $sum: 1 },
        devices: { $addToSet: "$hkt1" },
        billingCount: {
          $sum: { $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0] },
        },
        lastVisit: { $max: "$tanggal_dokumen" },
        lastDevice: { $last: "$hkt1" },
        nama: { $first: "$nama_lengkap" },
      },
    },
    {
      $project: {
        visits: 1,
        billingCount: 1,
        lastVisit: 1,
        lastDevice: 1,
        nama: 1,
        deviceCount: {
          $size: {
            $filter: { input: "$devices", as: "d", cond: { $ne: ["$$d", ""] } },
          },
        },
        riskScore: {
          $add: [
            { $multiply: ["$visits", 2] },
            {
              $multiply: [
                {
                  $size: {
                    $filter: {
                      input: "$devices",
                      as: "d",
                      cond: { $ne: ["$$d", ""] },
                    },
                  },
                },
                3,
              ],
            },
            { $multiply: ["$billingCount", 5] },
          ],
        },
      },
    },
    { $match: { riskScore: { $gte: 15 } } },
    { $sort: { riskScore: -1 } },
    { $limit: 20 },
  ]);

  // 7. Daily Average
  const dateRange = await Passenger.aggregate([
    {
      $group: {
        _id: null,
        minDate: { $min: "$tanggal_dokumen" },
        maxDate: { $max: "$tanggal_dokumen" },
        total: { $sum: 1 },
      },
    },
  ]);

  let dailyAverage = 0;
  if (dateRange[0]) {
    const days =
      Math.ceil(
        (dateRange[0].maxDate - dateRange[0].minDate) / (1000 * 60 * 60 * 24),
      ) || 1;
    dailyAverage = Math.round(dateRange[0].total / days);
  }

  // 8. Billing Rate
  const billingStats = await Passenger.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        billing: {
          $sum: { $cond: [{ $eq: ["$status_penelitian", "BILLING"] }, 1, 0] },
        },
      },
    },
  ]);
  const billingRate = billingStats[0]
    ? ((billingStats[0].billing / billingStats[0].total) * 100).toFixed(1)
    : 0;

  // Get basic stats
  const basicStats = await getStats();

  return {
    ...basicStats,
    monthlyTrend: monthlyTrend.reverse(),
    statusBreakdown,
    topPetugas,
    brandDistribution,
    hourlyDistribution,
    highRiskPassengers,
    dailyAverage,
    billingRate,
    dateRange: dateRange[0] || {},
    uniqueOfficers: topPetugas.length,
  };
}

// ==================== IMPORT FUNCTIONS ====================

async function importExcel(buffer, uploadedBy, filename) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const uploadBatch = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  let newRecords = 0,
    duplicateRecords = 0,
    errorRecords = 0;
  const errors = [];

  console.log("[IMPORT] Sheet names:", workbook.SheetNames);

  let dataSheet = null;
  let sheetName = "";

  if (workbook.SheetNames.length >= 2) {
    sheetName = workbook.SheetNames[1];
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    if (rowCount > MAX_EXCEL_ROWS || colCount > MAX_EXCEL_COLS) {
      throw new Error(
        `Sheet ${sheetName} terlalu besar (${rowCount}x${colCount}).`,
      );
    }
    dataSheet = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    console.log("[IMPORT] Page 2:", sheetName, "- rows:", dataSheet.length);
    if (dataSheet.length > 0) {
      console.log("[IMPORT] Columns:", Object.keys(dataSheet[0]));
      console.log(
        "[IMPORT] First row:",
        JSON.stringify(dataSheet[0]).slice(0, 300),
      );
    }
  }

  if (!dataSheet || dataSheet.length === 0) {
    throw new Error("Sheet Page 2 kosong atau tidak ditemukan");
  }

  const hasQrCode = dataSheet[0].qrCode !== undefined;
  console.log("[IMPORT] Has qrCode column:", hasQrCode);

  const BATCH_SIZE = 500;
  let bulkOps = [];

  for (let i = 0; i < dataSheet.length; i++) {
    const row = dataSheet[i];
    const qrCode = row.qrCode || row.qr_code || row.QrCode || row.QRCODE;
    const paspor = row.paspor || row.Paspor || row.PASPOR;

    if (!qrCode || !paspor) {
      errorRecords++;
      continue;
    }

    try {
      const doc = {
        qr_code: String(qrCode).trim(),
        kode_kantor: String(row.kodeKantor || row.kode_kantor || "").trim(),
        nomor_dokumen: String(
          row.nomorDokumen || row.nomor_dokumen || "",
        ).trim(),
        tanggal_dokumen: parseCeisaDate(
          row.tanggalDokumen || row.tanggal_dokumen,
        ),
        paspor: String(paspor).trim().toUpperCase(),
        waktu_rekam: parseCeisaDate(row.waktuRekam || row.waktu_rekam),
        nip_petugas: String(row.nipPetugas || row.nip_petugas || "").trim(),
        nama_petugas: String(row.namaPetugas || row.nama_petugas || "").trim(),
        status: String(row.status || "").trim(),
        kode_kantor_peneliti: String(
          row.kodeKantorPeneliti || row.kode_kantor_peneliti || "",
        ).trim(),
        hkt1: String(row.hkt1 || row.HKT1 || "").trim(),
        hkt2: String(row.hkt2 || row.HKT2 || "").trim(),
        status_penelitian: String(
          row.statusPenelitian || row.status_penelitian || "",
        ).trim(),
        upload_batch: uploadBatch,
      };

      bulkOps.push({
        updateOne: {
          filter: { qr_code: doc.qr_code },
          update: { $set: doc },
          upsert: true,
        },
      });

      if (bulkOps.length >= BATCH_SIZE) {
        const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
        newRecords += result.upsertedCount;
        duplicateRecords += result.modifiedCount;
        bulkOps = [];
      }
    } catch (err) {
      if (err.code === 11000) duplicateRecords++;
      else errorRecords++;
    }
  }

  // Flush remaining
  if (bulkOps.length > 0) {
    const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
    newRecords += result.upsertedCount;
    duplicateRecords += result.modifiedCount;
  }

  await UploadLog.create({
    uploaded_by: uploadedBy,
    filename,
    total_records: dataSheet.length,
    new_records: newRecords,
    duplicate_records: duplicateRecords,
    notes: `Sheet: ${sheetName}, Errors: ${errorRecords}`,
  });

  console.log(
    "[IMPORT] Result:",
    newRecords,
    "new,",
    duplicateRecords,
    "dup,",
    errorRecords,
    "err",
  );
  return {
    total: dataSheet.length,
    newRecords,
    duplicateRecords,
    errorRecords,
    sheet: sheetName,
  };
}

async function importCSV(lines, uploadedBy, filename) {
  const uploadBatch = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  let newRecords = 0,
    duplicateRecords = 0;
  const BATCH_SIZE = 500;
  let bulkOps = [];

  for (let i = 1; i < lines.length; i++) {
    const f = lines[i]
      .replace(/^\uFEFF/, "")
      .replace(/\r/g, "")
      .split(";")
      .map((x) => x.trim());
    if (f.length < 6) continue;

    try {
      const doc = {
        kode_kantor: f[0],
        nomor_dokumen: f[1],
        tanggal_dokumen: parseCeisaDate(f[2]),
        paspor: f[3].toUpperCase(),
        waktu_rekam: parseCeisaDate(f[4]),
        qr_code: f[5],
        nip_petugas: f[6] || "",
        nama_petugas: f[7] || "",
        status: f[8] || "",
        kode_kantor_peneliti: f[9] || "",
        hkt1: f[10] || "",
        hkt2: f[11] || "",
        status_penelitian: f[12] || "",
        upload_batch: uploadBatch,
      };

      bulkOps.push({
        updateOne: {
          filter: { qr_code: doc.qr_code },
          update: { $set: doc },
          upsert: true,
        },
      });

      if (bulkOps.length >= BATCH_SIZE) {
        const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
        newRecords += result.upsertedCount;
        duplicateRecords += result.modifiedCount;
        bulkOps = [];
      }
    } catch (err) {
      if (err.code === 11000) duplicateRecords++;
    }
  }

  // Flush remaining
  if (bulkOps.length > 0) {
    const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
    newRecords += result.upsertedCount;
    duplicateRecords += result.modifiedCount;
  }

  await UploadLog.create({
    uploaded_by: uploadedBy,
    filename,
    total_records: lines.length - 1,
    new_records: newRecords,
    duplicate_records: duplicateRecords,
  });
  return { newRecords, duplicateRecords, total: lines.length - 1 };
}

async function getUploadLogs(limit = 20) {
  return UploadLog.find().sort({ uploaded_at: -1 }).limit(limit);
}

// Import Data Penetapan CSV - update nama_lengkap berdasarkan qrCode
async function importPenetapanCSV(lines, uploadedBy, filename) {
  let updatedRecords = 0,
    notFoundRecords = 0;
  const BATCH_SIZE = 500;
  let bulkOps = [];

  for (let i = 1; i < lines.length; i++) {
    const f = lines[i]
      .replace(/^\uFEFF/, "")
      .replace(/\r/g, "")
      .split(";")
      .map((x) => x.trim());
    if (f.length < 4) continue;

    const qrCode = f[1]; // qrCode di kolom 2
    const noIdentitas = f[2]; // noIdentitas (paspor)
    const namaLengkap = f[3]; // namaLengkap di kolom 4

    if (!qrCode || !namaLengkap) continue;

    bulkOps.push({
      updateOne: {
        filter: { qr_code: qrCode },
        update: { $set: { nama_lengkap: namaLengkap } },
      },
    });

    if (bulkOps.length >= BATCH_SIZE) {
      const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
      updatedRecords += result.modifiedCount;
      notFoundRecords += bulkOps.length - result.matchedCount;
      bulkOps = [];
    }
  }

  // Flush remaining
  if (bulkOps.length > 0) {
    const result = await Passenger.bulkWrite(bulkOps, { ordered: false });
    updatedRecords += result.modifiedCount;
    notFoundRecords += bulkOps.length - result.matchedCount;
  }

  await UploadLog.create({
    uploaded_by: uploadedBy,
    filename,
    total_records: lines.length - 1,
    new_records: updatedRecords,
    duplicate_records: notFoundRecords,
    notes: "Data Penetapan - Updated names",
  });

  console.log(
    "[PENETAPAN] Result:",
    updatedRecords,
    "updated,",
    notFoundRecords,
    "not found",
  );
  return { total: lines.length - 1, updatedRecords, notFoundRecords };
}

// ==================== EXPORT DATA ====================

async function exportData({ date_from, date_to, status, paspor }) {
  const filter = {};
  if (date_from || date_to) {
    filter.tanggal_dokumen = {};
    if (date_from) filter.tanggal_dokumen.$gte = new Date(date_from);
    if (date_to) filter.tanggal_dokumen.$lte = new Date(date_to + "T23:59:59");
  }
  if (status) filter.status_penelitian = status;
  if (paspor) filter.paspor = paspor.toUpperCase();

  const records = await Passenger.find(filter)
    .sort({ tanggal_dokumen: -1 })
    .limit(50000)
    .lean();

  const rows = records.map((r) => ({
    "Kode Kantor": r.kode_kantor || "",
    "Nomor Dokumen": r.nomor_dokumen || "",
    "Tanggal Dokumen": r.tanggal_dokumen
      ? new Date(r.tanggal_dokumen).toLocaleDateString("id-ID")
      : "",
    Paspor: r.paspor || "",
    "Nama Lengkap": r.nama_lengkap || "",
    "Waktu Rekam": r.waktu_rekam
      ? new Date(r.waktu_rekam).toLocaleString("id-ID")
      : "",
    "QR Code": r.qr_code || "",
    "NIP Petugas": r.nip_petugas || "",
    "Nama Petugas": r.nama_petugas || "",
    Status: r.status || "",
    "HKT 1": r.hkt1 || "",
    "HKT 2": r.hkt2 || "",
    "Status Penelitian": r.status_penelitian || "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  // Auto-width columns
  const colWidths = Object.keys(rows[0] || {}).map((k) => ({
    wch: Math.max(k.length, 15),
  }));
  ws["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, "Data Penumpang");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ==================== CHECK DUPLICATES ====================

async function checkDuplicates(input, type) {
  let qrCodes = [];

  if (type === "excel") {
    const workbook = XLSX.read(input, { type: "buffer" });
    if (workbook.SheetNames.length >= 2) {
      const sheet = workbook.Sheets[workbook.SheetNames[1]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      qrCodes = data
        .map((r) => String(r.qrCode || r.qr_code || r.QrCode || "").trim())
        .filter(Boolean);
    }
  } else {
    // CSV
    for (let i = 1; i < input.length; i++) {
      const f = input[i]
        .replace(/^\uFEFF/, "")
        .replace(/\r/g, "")
        .split(";")
        .map((x) => x.trim());
      if (f.length >= 6 && f[5]) qrCodes.push(f[5]);
    }
  }

  if (!qrCodes.length)
    return { totalInFile: 0, duplicatesInDb: 0, newRecords: 0, samples: [] };

  // Check which qrCodes already exist
  const existing = await Passenger.find(
    { qr_code: { $in: qrCodes } },
    { qr_code: 1, paspor: 1, nomor_dokumen: 1, tanggal_dokumen: 1, hkt1: 1 },
  )
    .limit(1000)
    .lean();

  const existingSet = new Set(existing.map((e) => e.qr_code));
  const dupInFile = qrCodes.length - new Set(qrCodes).size;

  return {
    totalInFile: qrCodes.length,
    uniqueInFile: new Set(qrCodes).size,
    duplicatesInFile: dupInFile,
    duplicatesInDb: existing.length,
    newRecords: new Set(qrCodes).size - existing.length,
    samples: existing.slice(0, 10).map((e) => ({
      qr_code: e.qr_code,
      paspor: e.paspor,
      nomor_dokumen: e.nomor_dokumen,
      tanggal: e.tanggal_dokumen,
      device: e.hkt1,
    })),
  };
}

module.exports = {
  calculateRiskScore,
  getByPaspor,
  getRepeaters,
  getStats,
  getAdvancedStats,
  importExcel,
  importCSV,
  importPenetapanCSV,
  getUploadLogs,
  exportData,
  checkDuplicates,
};
