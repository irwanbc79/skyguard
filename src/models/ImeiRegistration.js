const mongoose = require("mongoose");

const imeiRegistrationSchema = new mongoose.Schema(
  {
    // Identity
    nama: { type: String, index: true },
    jenis_identitas: { type: String, default: "PASSPORT" },
    no_identitas: { type: String, index: true }, // passport number or NIK
    kebangsaan: { type: String, index: true },
    npwp_nik: String,

    // Flight/Vessel
    vessel: { type: String, index: true }, // flight number e.g. "CZ 8353"
    vessel_normalized: { type: String, index: true }, // normalized e.g. "CZ8353"
    tgl_kedatangan: { type: Date, index: true },

    // Document
    no_dok: String, // e.g. "031394/CD/HKT/050100/2026"
    tgl_dok: Date,

    // Payment
    total_pungutan: { type: Number, default: 0 },
    status_pembayaran: {
      type: String,
      enum: ["PEMBEBASAN", "BILLING", "BPPM", "WAITINGLIST", "UNKNOWN"],
      default: "UNKNOWN",
      index: true,
    },

    // Officer & Office
    nip_petugas: String,
    id_registrasi: { type: String, unique: true, sparse: true },
    kode_kantor: { type: String, index: true },

    // Meta
    source_file: String, // CSV filename
    imported_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Compound indexes for cross-referencing
imeiRegistrationSchema.index({ no_identitas: 1, tgl_kedatangan: -1 });
imeiRegistrationSchema.index({ vessel_normalized: 1, tgl_kedatangan: -1 });
imeiRegistrationSchema.index({ kebangsaan: 1, kode_kantor: 1 });
imeiRegistrationSchema.index({ status_pembayaran: 1, total_pungutan: 1 });
imeiRegistrationSchema.index({ kode_kantor: 1, tgl_kedatangan: -1 });

module.exports = mongoose.model("ImeiRegistration", imeiRegistrationSchema);
