const express = require("express");
const router = express.Router();
const multer = require("multer");
const suspectService = require("../services/suspectService");

// Multer config - memory storage for resize pipeline
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

const photoFields = upload.fields([
  { name: "passport_photo", maxCount: 1 },
  { name: "passenger_photo", maxCount: 1 },
  { name: "additional_photos", maxCount: 5 },
]);

// GET /api/suspects - list with filters
router.get("/", async (req, res) => {
  try {
    const result = await suspectService.getSuspects(req.query);
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/suspects/stats - statistics
router.get("/stats", async (req, res) => {
  try {
    const stats = await suspectService.getStats();
    res.json({ status: "ok", data: stats });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/suspects/:id - single suspect detail
router.get("/:id", async (req, res) => {
  try {
    const suspect = await suspectService.getSuspectById(req.params.id);
    res.json({ status: "ok", data: suspect });
  } catch (err) {
    res.status(404).json({ status: "error", message: err.message });
  }
});

// POST /api/suspects - create new suspect
router.post("/", photoFields, async (req, res) => {
  try {
    const suspect = await suspectService.createSuspect(req.body, req.files);
    res.json({
      status: "ok",
      data: suspect,
      message: "Suspect berhasil ditambahkan ke watchlist",
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// PUT /api/suspects/:id - update suspect
router.put("/:id", photoFields, async (req, res) => {
  try {
    const suspect = await suspectService.updateSuspect(
      req.params.id,
      req.body,
      req.files,
    );
    res.json({
      status: "ok",
      data: suspect,
      message: "Data suspect berhasil diperbarui",
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/suspects/:id/actions - add action to timeline
router.post("/:id/actions", async (req, res) => {
  try {
    const suspect = await suspectService.addAction(req.params.id, req.body);
    res.json({
      status: "ok",
      data: suspect,
      message: "Tindakan berhasil dicatat",
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// DELETE /api/suspects/:id - delete suspect
router.delete("/:id", async (req, res) => {
  try {
    await suspectService.deleteSuspect(req.params.id);
    res.json({ status: "ok", message: "Suspect berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// DELETE /api/suspects/:id/photos - delete additional photo
router.delete("/:id/photos", async (req, res) => {
  try {
    const suspect = await suspectService.deleteAdditionalPhoto(
      req.params.id,
      req.body.path,
    );
    res.json({ status: "ok", data: suspect });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
