const express = require("express");
const router = express.Router();
const multer = require("multer");
const ps = require("../services/passengerService");

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".csv", ".xls", ".xlsx"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const extension = (file.originalname || "").toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.some((ext) => extension.endsWith(ext));
    if (!isAllowed) {
      return cb(
        new Error("Format file harus CSV atau Excel (.csv, .xls, .xlsx)."),
      );
    }
    return cb(null, true);
  },
});

router.get("/stats", async (req, res) => {
  try {
    res.json({ status: "ok", data: await ps.getStats() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// NEW: Advanced Stats Endpoint
router.get("/stats/advanced", async (req, res) => {
  try {
    res.json({ status: "ok", data: await ps.getAdvancedStats() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.get("/repeaters", async (req, res) => {
  try {
    res.json({
      status: "ok",
      data: await ps.getRepeaters(parseInt(req.query.min) || 5),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.get("/upload-logs", async (req, res) => {
  try {
    res.json({ status: "ok", data: await ps.getUploadLogs() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Download/Export passenger data as Excel
router.get("/export", async (req, res) => {
  try {
    const { date_from, date_to, status, paspor } = req.query;
    const result = await ps.exportData({ date_from, date_to, status, paspor });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="data_penumpang_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    );
    res.send(result);
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Check duplicates before upload (preview)
router.post("/check-duplicates", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ status: "error", message: "File tidak ditemukan" });
    const filename = req.file.originalname;
    const isExcel = filename.match(/\.(xlsx|xls)$/i);
    let result;
    if (isExcel) {
      result = await ps.checkDuplicates(req.file.buffer, "excel");
    } else {
      const lines = req.file.buffer
        .toString("utf-8")
        .split("\n")
        .filter((l) => l.trim());
      result = await ps.checkDuplicates(lines, "csv");
    }
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.get("/:paspor", async (req, res) => {
  try {
    const result = await ps.getByPaspor(req.params.paspor);
    if (!result)
      return res
        .status(404)
        .json({ status: "error", message: "Paspor tidak ditemukan" });
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    if (!req.file)
      return res
        .status(400)
        .json({ status: "error", message: "File tidak ditemukan" });

    const filename = req.file.originalname;
    const uploadedBy = req.body.uploaded_by || "Unknown";
    const isExcel = filename.match(/\.(xlsx|xls)$/i);
    const fileSizeMB = (req.file.size / 1024 / 1024).toFixed(2);

    console.log(
      `[UPLOAD] File: ${filename}, Size: ${fileSizeMB}MB, Type: ${isExcel ? "Excel" : "CSV"}`,
    );

    let result;
    if (isExcel) {
      result = await ps.importExcel(req.file.buffer, uploadedBy, filename);
    } else {
      const lines = req.file.buffer
        .toString("utf-8")
        .split("\n")
        .filter((l) => l.trim());

      // Detect file type from filename or header
      const isPenetapan =
        filename.toLowerCase().includes("penetapan") ||
        (lines[0] && lines[0].includes("namaLengkap"));

      if (isPenetapan) {
        console.log("[UPLOAD] Detected: Data Penetapan CSV");
        result = await ps.importPenetapanCSV(lines, uploadedBy, filename);
        result.fileType = "penetapan";
      } else {
        result = await ps.importCSV(lines, uploadedBy, filename);
      }
    }

    res.json({
      status: "ok",
      message: `Import selesai: ${result.newRecords} baru, ${result.duplicateRecords} duplikat${result.errorRecords ? `, ${result.errorRecords} error` : ""}`,
      data: {
        filename,
        uploaded_by: uploadedBy,
        file_type: isExcel ? "excel" : "csv",
        file_size_mb: fileSizeMB,
        ...result,
      },
    });
  } catch (err) {
    console.error("[UPLOAD ERROR]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
