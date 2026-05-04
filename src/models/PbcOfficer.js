const mongoose = require("mongoose");

const pbcOfficerSchema = new mongoose.Schema(
  {
    nip: { type: String, required: true, unique: true, index: true, trim: true },
    nama: { type: String, required: true, trim: true },
    pangkat: { type: String, trim: true },   // "PENATA TK.I" | "PENATA" | "PENATA MUDA TK.I" | dst
    golongan: { type: String, trim: true },  // "III d" | "III c" | "III b" | dst
    nomor_skp: { type: String, trim: true }, // "SKP-1/BC.15.7/JF/2026"
    tahun: { type: Number, required: true, default: 2026, index: true },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

pbcOfficerSchema.index({ tahun: 1, is_active: 1 });

module.exports = mongoose.model("PbcOfficer", pbcOfficerSchema, "pbc_officers");
