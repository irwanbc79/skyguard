const mongoose = require("mongoose");

// Satu dokumen per petugas per hari — dari upload jadwal bulanan
const pbcScheduleRecordSchema = new mongoose.Schema(
  {
    batch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PbcDataBatch",
      required: true,
      index: true,
    },
    nip: { type: String, index: true, trim: true },
    nama: { type: String, trim: true },
    tanggal: { type: Date, index: true },
    shift: { type: String, trim: true }, // M | S | P | L | LP | LS | PE | dll
    is_working: { type: Boolean, default: false }, // shift != L/LP/LS/null
    section: { type: String }, // "Terminal" | "Ekspor-Impor" | "PBC" | "Pelaksana"
    period_month: { type: Number, index: true },
    period_year: { type: Number, index: true },
  },
  { timestamps: true }
);

pbcScheduleRecordSchema.index({ nip: 1, period_year: 1, period_month: 1 });
pbcScheduleRecordSchema.index({ period_year: 1, period_month: 1, section: 1 });
pbcScheduleRecordSchema.index({ batch_id: 1, nip: 1 });

module.exports = mongoose.model(
  "PbcScheduleRecord",
  pbcScheduleRecordSchema,
  "pbc_schedule_records"
);
