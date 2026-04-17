const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const ceisaController = require("../controllers/ceisaController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      return cb(null, true);
    }
    cb(new Error("Hanya file XLSX/XLS yang didukung untuk import CEISA."));
  },
});

const router = express.Router();

// Upload file manifest CEISA
// POST /api/ceisa/upload
router.post("/upload", requireAuth, upload.single("file"), ceisaController.uploadCeisa);

// List semua batch upload
// GET /api/ceisa/batches
router.get("/batches", requireAuth, ceisaController.listBatches);

// Detail satu batch
// GET /api/ceisa/batches/:id
router.get("/batches/:id", requireAuth, ceisaController.getBatch);

// Hapus batch beserta semua recordnya
// DELETE /api/ceisa/batches/:id
router.delete("/batches/:id", requireAuth, ceisaController.deleteBatch);

// Query records (dengan filter & pagination)
// GET /api/ceisa/records?batch_id=&direction=&sarana_angkut=&date_from=&date_to=&search=&limit=&page=
router.get("/records", requireAuth, ceisaController.listRecords);

// Statistik & analitik aggregated
// GET /api/ceisa/stats?batch_id=&date_from=&date_to=
router.get("/stats", requireAuth, ceisaController.getStats);

module.exports = router;
