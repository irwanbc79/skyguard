const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  email: { type: String, index: true },
  full_name: { type: String },
  role: { type: String },

  action: {
    type: String,
    enum: [
      "login",
      "login_failed",
      "logout",
      "password_reset",
      "profile_update",
      "user_created",
      "user_deleted",
      "user_toggled",
      "user_verified",
      "role_changed",
      "api_access",
    ],
    index: true,
  },

  detail: { type: String },   // human-readable description
  ip: { type: String },
  user_agent: { type: String },
  status: { type: String, enum: ["success", "failed", "warning"], default: "success" },
  created_at: { type: Date, default: Date.now, index: true },
});

// TTL: auto-delete logs older than 90 days
activityLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
activityLogSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema, "activity_logs");
