const express = require("express");
const router = express.Router();
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");

function logActivity(data) {
  ActivityLog.create(data).catch(() => {});
}

// ── Middleware: only superadmin or admin ──────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user || !["admin", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({ status: "error", message: "Akses ditolak. Hanya admin yang diizinkan." });
  }
  next();
}

// Only superadmin can promote/demote to admin or superadmin
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ status: "error", message: "Akses ditolak. Hanya superadmin yang diizinkan." });
  }
  next();
}

const ROLES = ["petugas", "admin", "superadmin"];

// ─── GET /api/admin/users — list all users ────────────────────────────────────
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const { role, is_active, is_verified, q, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (is_active !== undefined) filter.is_active = is_active === "true";
    if (is_verified !== undefined) filter.is_verified = is_verified === "true";
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ email: re }, { full_name: re }, { nip: re }, { unit_kerja: re }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password -verification_token -verification_expires -reset_token -reset_expires")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ status: "ok", data: users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/users/stats ───────────────────────────────────────────────
router.get("/users/stats", requireAdmin, async (req, res) => {
  try {
    const [total, active, verified, byRole] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ is_active: true }),
      User.countDocuments({ is_verified: true }),
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    ]);
    const roles = {};
    byRole.forEach((r) => { roles[r._id] = r.count; });
    res.json({ status: "ok", data: { total, active, verified, inactive: total - active, unverified: total - verified, roles } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
router.get("/users/:id", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -verification_token -reset_token")
      .lean();
    if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
    res.json({ status: "ok", data: user });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── PATCH /api/admin/users/:id — update role / status ───────────────────────
router.patch("/users/:id", requireAdmin, async (req, res) => {
  try {
    const { role, is_active, full_name, nip, unit_kerja } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });

    // Prevent self-demotion of superadmin
    if (String(user._id) === String(req.user._id) && role && role !== req.user.role) {
      return res.status(400).json({ status: "error", message: "Tidak dapat mengubah role akun sendiri." });
    }

    // Only superadmin can assign admin/superadmin roles
    if (role && ["admin", "superadmin"].includes(role) && req.user.role !== "superadmin") {
      return res.status(403).json({ status: "error", message: "Hanya superadmin yang dapat menentukan role admin." });
    }

    const changes = [];
    if (role && ROLES.includes(role) && role !== user.role) { changes.push(`role: ${user.role}→${role}`); user.role = role; }
    if (is_active !== undefined && Boolean(is_active) !== user.is_active) { changes.push(`status: ${user.is_active ? "aktif" : "nonaktif"}→${Boolean(is_active) ? "aktif" : "nonaktif"}`); user.is_active = Boolean(is_active); }
    if (full_name) user.full_name = full_name.trim();
    if (nip !== undefined) user.nip = nip.trim();
    if (unit_kerja !== undefined) user.unit_kerja = unit_kerja.trim();

    await user.save();

    if (changes.length) {
      const action = changes.some(c => c.startsWith("role")) ? "role_changed" : changes.some(c => c.startsWith("status")) ? "user_toggled" : "profile_update";
      logActivity({
        user_id: req.user._id, email: req.user.email, full_name: req.user.full_name || req.user.email, role: req.user.role,
        action, detail: `Update ${user.email}: ${changes.join(", ")}`,
        ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown",
        user_agent: req.headers["user-agent"] || "", status: "success",
      });
    }

    res.json({ status: "ok", message: "Data user berhasil diperbarui.", data: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── POST /api/admin/users/:id/verify — manual email verification ─────────────
router.post("/users/:id/verify", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
    user.is_verified = true;
    user.verification_token = undefined;
    user.verification_expires = undefined;
    await user.save();
    res.json({ status: "ok", message: `Akun ${user.email} berhasil diverifikasi manual.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── POST /api/admin/users/:id/reset-password — admin set new password ────────
router.post("/users/:id/reset-password", requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ status: "error", message: "Password minimal 8 karakter." });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
    user.password = password;
    await user.save();
    res.json({ status: "ok", message: `Password ${user.email} berhasil direset.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── DELETE /api/admin/users/:id — hard delete ────────────────────────────────
router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ status: "error", message: "Tidak dapat menghapus akun sendiri." });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ status: "error", message: "User tidak ditemukan" });
    logActivity({
      user_id: req.user._id, email: req.user.email, full_name: req.user.full_name || req.user.email, role: req.user.role,
      action: "user_deleted", detail: `Hapus akun: ${user.email} (${user.full_name})`,
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown",
      user_agent: req.headers["user-agent"] || "", status: "success",
    });
    res.json({ status: "ok", message: `Akun ${user.email} berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/online-users — users active in last 30 min ───────────────
router.get("/online-users", requireAdmin, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const users = await User.find({ last_seen: { $gte: since }, is_active: true })
      .select("_id email full_name role nip unit_kerja last_seen last_login login_count")
      .sort({ last_seen: -1 })
      .lean();
    res.json({ status: "ok", data: users, count: users.length });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/activity-log — paginated audit log ───────────────────────
router.get("/activity-log", requireAdmin, async (req, res) => {
  try {
    const { user_id, action, status, q, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (user_id) filter.user_id = user_id;
    if (action) filter.action = action;
    if (status) filter.status = status;
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ email: re }, { full_name: re }, { detail: re }, { ip: re }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({ status: "ok", data: logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/users/:id/activity — per-user activity history ────────────
router.get("/users/:id/activity", requireAdmin, async (req, res) => {
  try {
    const logs = await ActivityLog.find({ user_id: req.params.id })
      .sort({ created_at: -1 })
      .limit(100)
      .lean();
    const loginCount = logs.filter(l => l.action === "login").length;
    const failedCount = logs.filter(l => l.action === "login_failed").length;
    const lastLogin = logs.find(l => l.action === "login");
    res.json({ status: "ok", data: logs, summary: { login_count: loginCount, failed_count: failedCount, last_login: lastLogin?.created_at } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/admin/activity-stats — summary stats for dashboard ──────────────
router.get("/activity-stats", requireAdmin, async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since30m = new Date(Date.now() - 30 * 60 * 1000);
    const [logins24h, failed24h, online, totalLogs] = await Promise.all([
      ActivityLog.countDocuments({ action: "login", created_at: { $gte: since24h } }),
      ActivityLog.countDocuments({ action: "login_failed", created_at: { $gte: since24h } }),
      User.countDocuments({ last_seen: { $gte: since30m }, is_active: true }),
      ActivityLog.countDocuments(),
    ]);
    res.json({ status: "ok", data: { logins_24h: logins24h, failed_24h: failed24h, online_now: online, total_logs: totalLogs } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
