const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "SUSPECT_DETECTED", // Suspect found in manifest crosscheck
        "MANIFEST_RECEIVED", // New manifest uploaded/ingested
        "SUSPECT_CREATED", // New suspect added to watchlist
        "HIGH_RISK_PASSENGER", // Passenger with high intel score detected
        "CARGO_SUSPECT_LINK", // Cargo linked to suspect identity
        "SYSTEM", // General system notification
      ],
      required: true,
      index: true,
    },

    // Priority: CRITICAL > HIGH > MEDIUM > LOW
    priority: {
      type: String,
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM",
      index: true,
    },

    title: { type: String, required: true },
    message: { type: String, required: true },

    // Rich data for navigation & context
    data: {
      // Reference IDs for click-to-navigate
      manifest_id: { type: mongoose.Schema.Types.ObjectId },
      suspect_id: { type: mongoose.Schema.Types.ObjectId },
      passenger_passport: { type: String },
      cargo_id: { type: mongoose.Schema.Types.ObjectId },

      // Context data
      flight_number: { type: String },
      flight_date: { type: Date },
      suspect_name: { type: String },
      risk_level: { type: String },
      categories: [{ type: String }],
      intel_score: { type: Number },
      extra: { type: mongoose.Schema.Types.Mixed },
    },

    // Read status
    is_read: { type: Boolean, default: false, index: true },
    read_at: { type: Date },

    // Auto-expire after 30 days
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for efficient queries
notificationSchema.index({ is_read: 1, createdAt: -1 });
notificationSchema.index({ type: 1, is_read: 1, createdAt: -1 });
notificationSchema.index({ priority: 1, is_read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
