const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const c = require("../controllers/pbcController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      return cb(null, true);
    }
    cb(new Error("Hanya file XLSX/XLS/CSV yang didukung."));
  },
});

const router = express.Router();

// Master Petugas PBC
router.get("/officers", requireAuth, c.listOfficers);
router.post("/officers", requireAuth, c.createOfficer);
router.put("/officers/:id", requireAuth, c.updateOfficer);
router.delete("/officers/:id", requireAuth, c.deleteOfficer);

// Upload Data Pendukung IKI
router.post("/upload", requireAuth, upload.single("file"), c.uploadData);
router.get("/batches", requireAuth, c.listBatches);
router.delete("/batches/:id", requireAuth, c.deleteBatch);
router.get("/records", requireAuth, c.listRecords);

// Rekapitulasi data pendukung (cikal bakal IKI)
router.get("/summary", requireAuth, c.getSummary);

// Jadwal Bulanan
router.post("/jadwal/upload", requireAuth, upload.single("file"), c.uploadJadwal);
router.get("/jadwal/summary", requireAuth, c.getJadwalSummary);
router.delete("/jadwal/batches/:id", requireAuth, c.deleteJadwalBatch);

// IKI Master Indicators
router.get("/iki/indicators", requireAuth, c.listIkiIndicators);
router.post("/iki/indicators", requireAuth, c.createIkiIndicator);
router.put("/iki/indicators/:id", requireAuth, c.updateIkiIndicator);
router.delete("/iki/indicators/:id", requireAuth, c.deleteIkiIndicator);

// IKI Realisasi & Dashboard
router.post("/iki/realisasi", requireAuth, c.upsertRealisasi);
router.get("/iki/dashboard", requireAuth, c.getIkiDashboard);

module.exports = router;
