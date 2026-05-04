const mongoose = require("mongoose");

// Satu dokumen per sesi upload data pendukung IKI
const pbcDataBatchSchema = new mongoose.Schema(
  {
    source_type: {
      type: String,
      required: true,
      index: true,
      // "rao" | "lembur" | "uang_makan" | "custom"
    },
    source_label: { type: String }, // label tampilan, mis. "Data RAO Januari 2026"
    original_filename: { type: String },
    period_month: { type: Number, min: 1, max: 12, index: true },
    period_year: { type: Number, index: true },
    total_records: { type: Number, default: 0 },
    uploaded_by: { type: String },
    status: {
      type: String,
      enum: ["processing", "imported", "failed"],
      default: "processing",
      index: true,
    },
    error_message: { type: String },
    notes: { type: String },
    column_map: { type: mongoose.Schema.Types.Mixed }, // mapping header → field
  },
  { timestamps: true }
);

pbcDataBatchSchema.index({ source_type: 1, period_year: 1, period_month: 1 });

module.exports = mongoose.model("PbcDataBatch", pbcDataBatchSchema, "pbc_data_batches");
