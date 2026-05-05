const mongoose = require("mongoose");

const pbcIkiIndicatorSchema = new mongoose.Schema(
  {
    kode: { type: String, unique: true, trim: true }, // IKI-001 dst — auto-generate jika kosong
    nama: { type: String, required: true, trim: true },
    target: { type: Number, required: true },
    satuan: {
      type: String,
      enum: ["%", "indeks", "hari", "dokumen", "unit", "lainnya"],
      default: "%",
    },
    tahun: { type: Number, required: true, default: 2026, index: true },
    is_active: { type: Boolean, default: true, index: true },
    keterangan: { type: String, trim: true },
    urutan: { type: Number, default: 99 }, // untuk sorting tampilan
  },
  { timestamps: true }
);

pbcIkiIndicatorSchema.index({ tahun: 1, is_active: 1 });

module.exports = mongoose.model(
  "PbcIkiIndicator",
  pbcIkiIndicatorSchema,
  "pbc_iki_indicators"
);
