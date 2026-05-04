const mongoose = require("mongoose");

// Satu dokumen per baris data per upload batch
const pbcDataRecordSchema = new mongoose.Schema(
  {
    batch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PbcDataBatch",
      required: true,
      index: true,
    },
    source_type: { type: String, index: true },
    nip: { type: String, index: true },
    nama: { type: String },
    tanggal: { type: Date, index: true },
    period_month: { type: Number },
    period_year: { type: Number },
    nilai: { type: Number, default: 0 }, // nilai utama (jumlah ECD, jam lembur, dll)
    satuan: { type: String },            // "ECD" | "jam" | "hari" | dst
    keterangan: { type: String },
    raw_data: { type: mongoose.Schema.Types.Mixed }, // row asli dari Excel
  },
  { timestamps: true }
);

pbcDataRecordSchema.index({ nip: 1, period_year: 1, period_month: 1 });
pbcDataRecordSchema.index({ source_type: 1, period_year: 1, period_month: 1 });
pbcDataRecordSchema.index({ batch_id: 1, nip: 1 });

module.exports = mongoose.model("PbcDataRecord", pbcDataRecordSchema, "pbc_data_records");
