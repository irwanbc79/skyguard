const nodemailer = require("nodemailer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "skyguard-fallback-secret-change-in-prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "10h";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

// ─── EMAIL TRANSPORTER ────────────────────────────────────────────────────────
function createTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  // Dev mode: log email to console
  return null;
}

async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();
  if (!transporter) {
    // Dev mode — tampilkan di console
    console.log(`\n[EMAIL DEV MODE]`);
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body snippet: ${html.replace(/<[^>]+>/g, "").substring(0, 200)}\n`);
    return { messageId: "dev-mode" };
  }
  const from = process.env.SMTP_FROM || `"SkyGuard Intelligence" <noreply@kemenkeu.go.id>`;
  return transporter.sendMail({ from, to, subject, html });
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
const emailBase = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#0a0f1e; margin:0; padding:20px; color:#e2e8f0; }
  .container { max-width:520px; margin:0 auto; background:linear-gradient(135deg,#0d1b2a,#1a2744); border:1px solid rgba(96,165,250,.3); border-radius:16px; overflow:hidden; }
  .header { background:linear-gradient(135deg,#1e3a5f,#0f2744); padding:28px 32px; text-align:center; }
  .logo-text { font-size:22px; font-weight:800; color:#60a5fa; letter-spacing:2px; }
  .subtitle { font-size:12px; color:#94a3b8; margin-top:4px; letter-spacing:1px; }
  .body { padding:28px 32px; }
  .btn { display:inline-block; background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff!important; text-decoration:none; padding:14px 32px; border-radius:10px; font-weight:700; font-size:15px; margin:20px 0; letter-spacing:.5px; }
  .footer { padding:16px 32px; background:rgba(0,0,0,.3); font-size:11px; color:#64748b; text-align:center; }
  .alert { background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); border-radius:8px; padding:12px 16px; font-size:13px; color:#fca5a5; margin-top:16px; }
  p { line-height:1.7; color:#cbd5e1; }
</style></head>
<body><div class="container">
  <div class="header">
    <div class="logo-text">⚡ SKYGUARD INTELLIGENCE</div>
    <div class="subtitle">DIREKTORAT JENDERAL BEA DAN CUKAI · KUALANAMU</div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">Email ini dikirim otomatis dari sistem SkyGuard Intelligence. Jangan membalas email ini.<br>© 2026 Kantor BC Kualanamu — Kementerian Keuangan RI</div>
</div></body></html>`;

function verifyEmailTemplate(name, link) {
  return emailBase(`
    <p>Halo, <strong style="color:#60a5fa">${name}</strong>.</p>
    <p>Terima kasih telah mendaftar di <strong>SkyGuard Intelligence</strong>. Silakan verifikasi alamat email Anda untuk mengaktifkan akun.</p>
    <div style="text-align:center">
      <a href="${link}" class="btn">✓ Verifikasi Email Saya</a>
    </div>
    <div class="alert">⏱ Link verifikasi berlaku selama <strong>24 jam</strong>. Jika Anda tidak mendaftar, abaikan email ini.</div>
    <div style="margin-top:20px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.25);border-radius:10px;padding:14px 16px">
      <p style="font-size:12px;font-weight:700;color:#67e8f9;margin-bottom:8px;text-transform:uppercase;letter-spacing:.8px">
        ⚠️ Link diblokir keamanan email? Salin URL ini ke browser:
      </p>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;line-height:1.6">
        Microsoft Defender / Safe Links mungkin memindai link di atas. Jika muncul halaman pemindaian,
        silakan <strong style="color:#e2e8f0">salin URL di bawah</strong> dan tempel langsung di address bar browser Anda.
      </p>
      <div style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:10px 12px;word-break:break-all;font-size:12px;color:#93c5fd;font-family:monospace">
        ${link}
      </div>
    </div>
  `);
}

function resetPasswordTemplate(name, link) {
  return emailBase(`
    <p>Halo, <strong style="color:#60a5fa">${name}</strong>.</p>
    <p>Kami menerima permintaan reset password untuk akun SkyGuard Intelligence Anda.</p>
    <div style="text-align:center;margin:20px 0">
      <a href="${link}" class="btn">🔑 Reset Password Saya</a>
    </div>
    <div class="alert">⏱ Link reset berlaku selama <strong>1 jam</strong>. Jika Anda tidak meminta reset, abaikan dan password Anda aman.</div>
    <div style="margin-top:20px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.25);border-radius:10px;padding:14px 16px">
      <p style="font-size:12px;font-weight:700;color:#67e8f9;margin-bottom:8px;text-transform:uppercase;letter-spacing:.8px">
        ⚠️ Link diblokir keamanan email? Salin URL ini ke browser:
      </p>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;line-height:1.6">
        Microsoft Defender / Safe Links mungkin memindai link di atas. Jika muncul halaman pemindaian,
        silakan <strong style="color:#e2e8f0">salin URL di bawah</strong> dan tempel langsung di address bar browser Anda.
      </p>
      <div style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:10px 12px;word-break:break-all;font-size:12px;color:#93c5fd;font-family:monospace">
        ${link}
      </div>
    </div>
  `);
}

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── SEND VERIFICATION EMAIL ──────────────────────────────────────────────────
async function sendVerificationEmail(user) {
  const link = `${APP_URL}/api/auth/verify/${user.verification_token}`;
  await sendEmail({
    to: user.email,
    subject: "✓ Verifikasi Email — SkyGuard Intelligence",
    html: verifyEmailTemplate(user.full_name, link),
  });
}

// ─── SEND RESET PASSWORD EMAIL ────────────────────────────────────────────────
async function sendResetEmail(user) {
  const link = `${APP_URL}/login?reset=${user.reset_token}`;
  await sendEmail({
    to: user.email,
    subject: "🔑 Reset Password — SkyGuard Intelligence",
    html: resetPasswordTemplate(user.full_name, link),
  });
}

module.exports = {
  generateToken,
  signJwt,
  verifyJwt,
  sendVerificationEmail,
  sendResetEmail,
};
