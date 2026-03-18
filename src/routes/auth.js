const express = require("express");
const router = express.Router();
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const {
  generateToken,
  signJwt,
  sendVerificationEmail,
  sendResetEmail,
} = require("../services/authService");

const ALLOWED_DOMAIN = "kemenkeu.go.id";

function getIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

function logActivity(data) {
  ActivityLog.create(data).catch(() => {});
}

function isDomainAllowed(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, full_name, nip, unit_kerja } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ status: "error", message: "Email, password, dan nama lengkap wajib diisi" });
    }
    if (!isDomainAllowed(email)) {
      return res.status(403).json({ status: "error", message: `Hanya email @${ALLOWED_DOMAIN} yang diizinkan mendaftar` });
    }
    if (password.length < 8) {
      return res.status(400).json({ status: "error", message: "Password minimal 8 karakter" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (!existing.is_verified) {
        // Resend verification
        existing.verification_token = generateToken();
        existing.verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await existing.save();
        await sendVerificationEmail(existing).catch(() => {});
        return res.json({ status: "ok", message: "Email sudah terdaftar tapi belum diverifikasi. Link verifikasi baru telah dikirim." });
      }
      return res.status(409).json({ status: "error", message: "Email sudah terdaftar. Silakan login." });
    }

    const verToken = generateToken();
    const user = new User({
      email: email.toLowerCase(),
      password,
      full_name: full_name.trim(),
      nip: nip?.trim() || "",
      unit_kerja: unit_kerja?.trim() || "",
      verification_token: verToken,
      verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await user.save();
    await sendVerificationEmail(user).catch((e) => console.error("[AUTH] Send verify email error:", e.message));

    res.status(201).json({
      status: "ok",
      message: `Registrasi berhasil! Link verifikasi telah dikirim ke ${email}. Cek inbox atau folder Spam Anda.`,
    });
  } catch (err) {
    console.error("[AUTH REGISTER]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/auth/verify/:token ──────────────────────────────────────────────
router.get("/verify/:token", async (req, res) => {
  try {
    const user = await User.findOne({
      verification_token: req.params.token,
      verification_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.redirect("/login?status=verify-expired");
    }

    user.is_verified = true;
    user.verification_token = undefined;
    user.verification_expires = undefined;
    await user.save();

    res.redirect("/login?status=verified");
  } catch (err) {
    res.redirect("/login?status=error");
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: "error", message: "Email dan password wajib diisi" });
    }
    if (!isDomainAllowed(email)) {
      return res.status(403).json({ status: "error", message: `Hanya email @${ALLOWED_DOMAIN} yang diizinkan` });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      logActivity({
        email: email.toLowerCase(),
        full_name: user?.full_name || "",
        role: user?.role || "",
        action: "login_failed",
        detail: `Gagal login: email atau password salah`,
        ip: getIp(req),
        user_agent: req.headers["user-agent"] || "",
        status: "failed",
      });
      return res.status(401).json({ status: "error", message: "Email atau password salah" });
    }
    if (!user.is_verified) {
      return res.status(403).json({ status: "error", message: "Email belum diverifikasi. Cek inbox Anda untuk link aktivasi." });
    }
    if (!user.is_active) {
      logActivity({
        user_id: user._id, email: user.email, full_name: user.full_name, role: user.role,
        action: "login_failed", detail: "Gagal login: akun nonaktif",
        ip: getIp(req), user_agent: req.headers["user-agent"] || "", status: "warning",
      });
      return res.status(403).json({ status: "error", message: "Akun Anda telah dinonaktifkan. Hubungi administrator." });
    }

    user.last_login = new Date();
    user.last_seen = new Date();
    user.login_count = (user.login_count || 0) + 1;
    await user.save();

    logActivity({
      user_id: user._id, email: user.email, full_name: user.full_name, role: user.role,
      action: "login", detail: `Login berhasil (login ke-${user.login_count})`,
      ip: getIp(req), user_agent: req.headers["user-agent"] || "", status: "success",
    });

    const token = signJwt({ id: user._id, email: user.email, role: user.role });

    res.json({
      status: "ok",
      token,
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        nip: user.nip,
        unit_kerja: user.unit_kerja,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[AUTH LOGIN]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isDomainAllowed(email)) {
      return res.status(400).json({ status: "error", message: `Masukkan email @${ALLOWED_DOMAIN} yang valid` });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return success to prevent user enumeration
    if (user && user.is_verified && user.is_active) {
      user.reset_token = generateToken();
      user.reset_expires = new Date(Date.now() + 60 * 60 * 1000); // 1 jam
      await user.save();
      await sendResetEmail(user).catch((e) => console.error("[AUTH] Send reset email error:", e.message));
    }

    res.json({ status: "ok", message: "Jika email terdaftar, link reset password telah dikirim." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ status: "error", message: "Token dan password baru (min. 8 karakter) wajib diisi" });
    }

    const user = await User.findOne({
      reset_token: token,
      reset_expires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ status: "error", message: "Link reset tidak valid atau sudah kadaluarsa" });
    }

    user.password = password;
    user.reset_token = undefined;
    user.reset_expires = undefined;
    await user.save();

    res.json({ status: "ok", message: "Password berhasil diubah. Silakan login dengan password baru Anda." });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GET /api/auth/me — Verify token & return current user ───────────────────
router.get("/me", async (req, res) => {
  try {
    const { verifyJwt } = require("../services/authService");
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ status: "error", message: "Token tidak ditemukan" });
    }
    const payload = verifyJwt(header.slice(7));
    const user = await User.findById(payload.id).select("-password -verification_token -reset_token");
    if (!user || !user.is_active) {
      return res.status(401).json({ status: "error", message: "Akun tidak valid" });
    }
    res.json({ status: "ok", user });
  } catch {
    res.status(401).json({ status: "error", message: "Token tidak valid atau sudah kadaluarsa" });
  }
});

module.exports = router;
