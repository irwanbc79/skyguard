/**
 * ============================================================
 *  SKYGUARD QSVM SERVICE — Quantum SVM Under-Invoicing Detection
 *  Bridge antara data MongoDB (CN-PIBK) dan Python QSVM engine
 * ============================================================
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const Cnpibk = require("../models/cnpibk");
const QsvmResult = require("../models/QsvmResult");

const PYTHON_SCRIPT = path.join(
  __dirname,
  "../../scripts/skyguard_qsvm_service.py",
);

// Python binary: env SKYGUARD_PYTHON_PATH, or project venv, or system python3
const PROJECT_ROOT = path.join(__dirname, "../..");
const VENV_PYTHON = path.join(PROJECT_ROOT, "venv", "bin", "python3");
function getPythonPath() {
  if (process.env.SKYGUARD_PYTHON_PATH) return process.env.SKYGUARD_PYTHON_PATH;
  try {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  } catch (_) {}
  return "python3";
}

/**
 * Calculate features from CN-PIBK data for QSVM input.
 * Maps MongoDB fields to the 5 QSVM features.
 */
function calculateFeatures(doc, importerFrequency) {
  const cifAwal = doc.cif_awal || 0;
  const cifAkhir = doc.cif_akhir || 0;
  const fobAwal = doc.fob_awal || 0;
  const fobAkhir = doc.fob_akhir || 0;

  // Feature 1: CIF per unit (gunakan cif_akhir sebagai proxy)
  const cifPerUnit = cifAkhir || fobAkhir || 0;

  // Feature 2: Gap ratio (selisih CIF awal vs akhir dibagi awal)
  let gapRatio = 0;
  if (cifAwal > 0 && cifAkhir > 0) {
    gapRatio = Math.abs(cifAkhir - cifAwal) / cifAwal;
  } else if (fobAwal > 0 && fobAkhir > 0) {
    gapRatio = Math.abs(fobAkhir - fobAwal) / fobAwal;
  }
  gapRatio = Math.min(gapRatio, 1.0); // Cap at 1.0

  // Feature 3: HS risk score (derive from status and CIF patterns)
  let hsRisk = 0.3; // Default medium-low
  if (doc.current_status === "SPPBMCP") hsRisk = 0.7;
  if (doc.current_status === "BILLING" || doc.kode_billing) hsRisk = 0.8;
  if (cifAkhir > cifAwal * 2) hsRisk = 0.9;

  // Feature 4: Country risk (derive from sender patterns)
  let countryRisk = 0.3;
  const sender = (doc.nama_pengirim || "").toUpperCase();
  // Higher risk for unknown or suspicious patterns
  if (!sender || sender.length < 3) countryRisk = 0.6;
  if (sender.includes("TRADING") || sender.includes("WHOLESALE"))
    countryRisk = 0.5;

  // Feature 5: Importer frequency (normalized 0-1, higher = more trusted)
  const freqImportir = Math.min(importerFrequency / 50, 1.0);

  return {
    cif_per_unit: cifPerUnit,
    gap_ratio: gapRatio,
    hs_risk: hsRisk,
    country_risk: countryRisk,
    freq_importir: freqImportir,
  };
}

/**
 * Run QSVM scan on recent CN-PIBK transactions.
 */
async function runScan(options = {}) {
  const { limit = 100, dateFrom, dateTo } = options;

  // 1. Fetch CN-PIBK data
  const query = {};
  if (dateFrom || dateTo) {
    query.tanggal_hawb = {};
    if (dateFrom) query.tanggal_hawb.$gte = new Date(dateFrom);
    if (dateTo) query.tanggal_hawb.$lte = new Date(dateTo + "T23:59:59");
  }

  const records = await Cnpibk.find(query)
    .sort({ tanggal_hawb: -1 })
    .limit(limit)
    .lean();

  if (!records.length) {
    return {
      status: "ok",
      message: "Tidak ada data CN-PIBK untuk di-scan",
      total_scanned: 0,
    };
  }

  // 2. Calculate importer frequencies
  const importerCounts = {};
  const allImporters = await Cnpibk.aggregate([
    { $match: { nama_penerima: { $nin: ["", null] } } },
    { $group: { _id: "$nama_penerima", count: { $sum: 1 } } },
  ]);
  allImporters.forEach((i) => (importerCounts[i._id] = i.count));

  // 3. Build transaction features for QSVM
  const transactions = records.map((doc) => {
    const freq = importerCounts[doc.nama_penerima] || 1;
    const features = calculateFeatures(doc, freq);
    return {
      nomor_aju: doc.nomor_aju,
      nomor_pibk: doc.nomor_pibk,
      nama_penerima: doc.nama_penerima,
      nama_pengirim: doc.nama_pengirim,
      cif_awal: doc.cif_awal,
      cif_akhir: doc.cif_akhir,
      ...features,
    };
  });

  // 4. Call Python QSVM engine
  const qsvmResult = await callPythonQSVM(transactions);

  // 5. Save result to MongoDB
  const scanId = `SCAN-${Date.now()}`;
  const savedResult = await QsvmResult.create({
    scan_id: scanId,
    scan_date: new Date(),
    engine: qsvmResult.engine || "unknown",
    total_scanned: qsvmResult.total_scanned || 0,
    total_flagged: qsvmResult.total_flagged || 0,
    total_normal: qsvmResult.total_normal || 0,
    avg_confidence: qsvmResult.avg_confidence || 0,
    predictions: qsvmResult.predictions || [],
    status: qsvmResult.status === "ok" ? "completed" : "error",
    error_message: qsvmResult.message || null,
  });

  return {
    status: "ok",
    scan_id: scanId,
    engine: qsvmResult.engine,
    total_scanned: qsvmResult.total_scanned,
    total_flagged: qsvmResult.total_flagged,
    total_normal: qsvmResult.total_normal,
    avg_confidence: qsvmResult.avg_confidence,
    predictions: qsvmResult.predictions,
    saved: savedResult._id,
  };
}

/**
 * Call Python QSVM script via child_process.
 */
function callPythonQSVM(transactions) {
  return new Promise((resolve, reject) => {
    const pythonBin = getPythonPath();
    const python = spawn(pythonBin, [PYTHON_SCRIPT]);
    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (code !== 0) {
        console.error("[QSVM] Python error:", stderr);
        resolve({
          status: "error",
          message: `Python process exited with code ${code}: ${stderr}`,
          engine: "unknown",
          total_scanned: 0,
          total_flagged: 0,
          total_normal: 0,
          avg_confidence: 0,
          predictions: [],
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        resolve({
          status: "error",
          message: `Failed to parse QSVM output: ${e.message}`,
          engine: "unknown",
          total_scanned: 0,
          total_flagged: 0,
          total_normal: 0,
          avg_confidence: 0,
          predictions: [],
        });
      }
    });

    python.on("error", (err) => {
      resolve({
        status: "error",
        message: `Failed to start Python: ${err.message}`,
        engine: "unavailable",
        total_scanned: 0,
        total_flagged: 0,
        total_normal: 0,
        avg_confidence: 0,
        predictions: [],
      });
    });

    // Send transactions as JSON to stdin
    const input = JSON.stringify({ transactions });
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Run self-test (no data, just checks if Python + QSVM engine works).
 */
async function selfTest() {
  return callPythonQSVM([]);
}

/**
 * Get recent scan results.
 */
async function getResults(options = {}) {
  const { limit = 10, page = 1 } = options;
  const skip = (page - 1) * limit;

  const [results, total] = await Promise.all([
    QsvmResult.find({ status: "completed" })
      .sort({ scan_date: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    QsvmResult.countDocuments({ status: "completed" }),
  ]);

  return { results, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Get QSVM statistics overview.
 */
async function getStats() {
  const [totalScans, totalFlagged, recentScan, engineInfo] = await Promise.all([
    QsvmResult.countDocuments({ status: "completed" }),

    QsvmResult.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, flagged: { $sum: "$total_flagged" }, scanned: { $sum: "$total_scanned" } } },
    ]),

    QsvmResult.findOne({ status: "completed" }).sort({ scan_date: -1 }).lean(),

    selfTest().catch(() => ({
      status: "error",
      message: "Python not available",
      engine: "unavailable",
    })),
  ]);

  return {
    total_scans: totalScans,
    total_flagged: totalFlagged[0]?.flagged || 0,
    total_scanned: totalFlagged[0]?.scanned || 0,
    last_scan: recentScan
      ? {
          scan_id: recentScan.scan_id,
          date: recentScan.scan_date,
          flagged: recentScan.total_flagged,
          scanned: recentScan.total_scanned,
          engine: recentScan.engine,
        }
      : null,
    engine_status: engineInfo,
  };
}

/**
 * Get detailed result for a specific scan.
 */
async function getScanDetail(scanId) {
  return QsvmResult.findOne({ scan_id: scanId }).lean();
}

module.exports = {
  runScan,
  selfTest,
  getResults,
  getStats,
  getScanDetail,
};
