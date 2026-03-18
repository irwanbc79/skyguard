const express = require("express");
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  scanAllCargoForSuspects,
  cleanup,
} = require("../services/notificationService");

// GET /api/notifications - Get all notifications with filters
router.get("/", async (req, res) => {
  try {
    const result = await getNotifications(req.query);
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("[NOTIF ROUTE]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// GET /api/notifications/unread-count - Fast polling endpoint
router.get("/unread-count", async (req, res) => {
  try {
    const result = await getUnreadCount();
    res.json({ status: "ok", ...result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// PUT /api/notifications/read-all - Mark all as read (HARUS sebelum /:id/read)
router.put("/read-all", async (req, res) => {
  try {
    const result = await markAllRead();
    res.json({ status: "ok", ...result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// PUT /api/notifications/:id/read - Mark single as read
router.put("/:id/read", async (req, res) => {
  try {
    const notif = await markRead(req.params.id);
    if (!notif)
      return res.status(404).json({ status: "error", message: "Not found" });
    res.json({ status: "ok", notification: notif });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/notifications/scan-cargo - Manual cargo-suspect scan trigger
router.post("/scan-cargo", async (req, res) => {
  try {
    const result = await scanAllCargoForSuspects();
    res.json({ status: "ok", ...result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// DELETE /api/notifications/cleanup - Manual cleanup
router.delete("/cleanup", async (req, res) => {
  try {
    const result = await cleanup();
    res.json({ status: "ok", ...result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
