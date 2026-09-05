const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  email: { type: String, index: true },
  full_name: { type: String },
  nip: { type: String, index: true },
  unit_kerja: { type: String },
  role: { type: String, index: true },

  // Aksi yang dilakukan (login, logout, create, update, delete, export, dll)
  action: {
    type: String,
    required: true,
    index: true,
  },

  // Kategori: AUTH, CRUD, EXPORT, SECURITY, SYSTEM
  category: {
    type: String,
    enum: ["AUTH", "CRUD", "EXPORT", "SECURITY", "SYSTEM"],
    default: "CRUD",
    index: true,
  },

  // Modul / Entitas terkait: suspects, imei, devices, passengers, manifests, prices, users, reports, dll.
  resource: { type: String, index: true },
  resource_id: { type: String, index: true },
  resource_name: { type: String },

  // Metadata teknis HTTP & Forensik
  method: { type: String }, // GET, POST, PUT, PATCH, DELETE
  path: { type: String },
  status_code: { type: Number },
  latency_ms: { type: Number },
  payload_summary: { type: mongoose.Schema.Types.Mixed },

  detail: { type: String },   // Human-readable description
  ip: { type: String, index: true },
  user_agent: { type: String },
  status: { type: String, enum: ["success", "failed", "warning", "blocked"], default: "success", index: true },
  created_at: { type: Date, default: Date.now },
});

// TTL: auto-delete logs older than 180 days
activityLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
activityLogSchema.index({ user_id: 1, created_at: -1 });
activityLogSchema.index({ category: 1, created_at: -1 });
activityLogSchema.index({ resource: 1, created_at: -1 });
activityLogSchema.index({ action: 1, created_at: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema, "activity_logs");
