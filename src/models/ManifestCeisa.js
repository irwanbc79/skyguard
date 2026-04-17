const mongoose = require("mongoose");

// Batch upload — satu dokumen per file XLSX yang diupload
const manifestCeisaSchema = new mongoose.Schema(
  {
    original_filename: { type: String, required: true },
    csv_gz_path: { type: String }, // path file CSV.gz hasil konversi
    periode_label: { type: String }, // e.g. "Januari 2026"
    date_from: { type: Date },
    date_to: { type: Date },
    total_records: { type: Number, default: 0 },
    inward_count: { type: Number, default: 0 },
    outward_count: { type: Number, default: 0 },
    airlines: [{ type: String }], // daftar maskapai unik dalam batch ini
    status: {
      type: String,
      enum: ["processing", "imported", "failed"],
      default: "processing",
    },
    uploaded_by: { type: String, default: "manual" },
    error_message: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ManifestCeisa", manifestCeisaSchema, "manifest_ceisa");
