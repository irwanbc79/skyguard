const mongoose = require("mongoose");

const pbcIkiRealizationSchema = new mongoose.Schema(
  {
    iki_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PbcIkiIndicator",
      required: true,
      index: true,
    },
    nip: { type: String, required: true, index: true, trim: true },
    nama: { type: String, trim: true }, // denormalisasi untuk kemudahan display
    period_month: { type: Number, required: true, min: 1, max: 12, index: true },
    period_year: { type: Number, required: true, index: true },
    realisasi: { type: Number, required: true },
    capaian_pct: { type: Number }, // dihitung otomatis: (realisasi/target)*100
    input_by: { type: String },
    keterangan: { type: String, trim: true },
  },
  { timestamps: true }
);

// Satu realisasi per IKI per petugas per bulan
pbcIkiRealizationSchema.index(
  { iki_id: 1, nip: 1, period_year: 1, period_month: 1 },
  { unique: true }
);
pbcIkiRealizationSchema.index({ nip: 1, period_year: 1, period_month: 1 });

module.exports = mongoose.model(
  "PbcIkiRealization",
  pbcIkiRealizationSchema,
  "pbc_iki_realizations"
);
