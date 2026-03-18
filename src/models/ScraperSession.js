const mongoose = require("mongoose");

const scraperSessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, unique: true, required: true },
    status: {
      type: String,
      enum: ["running", "paused", "completed", "error", "cancelled"],
      default: "running",
      index: true,
    },

    // Config
    type: { type: String, default: "imei_detail" }, // imei_detail | imei_registration
    total_pages: { type: Number, default: 0 },
    date_range: {
      start: String, // DD-MM-YYYY
      end: String,
    },

    // Progress
    current_page: { type: Number, default: 0 },
    total_records: { type: Number, default: 0 },
    new_records: { type: Number, default: 0 },
    duplicate_records: { type: Number, default: 0 },
    error_records: { type: Number, default: 0 },
    batches_received: { type: Number, default: 0 },

    // Stats
    brands: { type: Map, of: Number, default: {} },
    nationalities: { type: Map, of: Number, default: {} },
    total_fob_usd: { type: Number, default: 0 },
    total_pungutan: { type: Number, default: 0 },

    // Timing
    started_at: { type: Date, default: Date.now },
    last_activity: { type: Date, default: Date.now },
    completed_at: Date,
    elapsed_seconds: { type: Number, default: 0 },

    // Errors log (last 50)
    error_log: [
      {
        page: Number,
        id: String,
        message: String,
        time: { type: Date, default: Date.now },
      },
    ],

    // Meta
    user_agent: String,
    notes: String,
  },
  { timestamps: true },
);

scraperSessionSchema.index({ started_at: -1 });
scraperSessionSchema.index({ status: 1, last_activity: -1 });

module.exports = mongoose.model("ScraperSession", scraperSessionSchema);
