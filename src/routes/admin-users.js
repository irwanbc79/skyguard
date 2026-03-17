const express = require("express");
const router = express.Router();
const User = require("../models/User");

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

    if (role && ROLES.includes(role)) user.role = role;
    if (is_active !== undefined) user.is_active = Boolean(is_active);
    if (full_name) user.full_name = full_name.trim();
    if (nip !== undefined) user.nip = nip.trim();
    if (unit_kerja !== undefined) user.unit_kerja = unit_kerja.trim();

    await user.save();
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
    res.json({ status: "ok", message: `Akun ${user.email} berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
