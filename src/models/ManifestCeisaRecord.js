const mongoose = require("mongoose");

// Satu dokumen per baris penerbangan dalam file CEISA
const manifestCeisaRecordSchema = new mongoose.Schema(
  {
    batch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManifestCeisa",
      required: true,
      index: true,
    },
    jenis_dokumen: { type: String }, // "Inward (BC 1.1)" | "Outward (BC 1.1)"
    direction: {
      type: String,
      enum: ["inward", "outward", "unknown"],
      default: "unknown",
      index: true,
    },
    nomor_aju: { type: String, index: true },
    nomor_daftar: { type: String },
    tanggal_daftar: { type: Date },
    sarana_angkut: { type: String, index: true }, // nama maskapai
    pelabuhan_asal: { type: String, index: true }, // kode IATA/LOCODE
    npwp: { type: String, index: true },
    nama_perusahaan: { type: String },
    nomor_voyage: { type: String, index: true }, // nomor penerbangan
    tanggal_tiba: { type: Date, index: true },
    tanggal_berangkat: { type: Date },
    moda: { type: String, default: "UDARA" }, // UDARA | LAUT | DARAT
    mmsi: { type: String },
    jumlah_pos: { type: Number, default: 0 },
    jumlah_container: { type: Number, default: 0 },
    volume: { type: Number, default: 0 },
    berat: { type: Number, default: 0 }, // kg
    jumlah_kemasan: { type: Number, default: 0 },
    status_ceisa: { type: String, index: true }, // "BC 1.1" | "PERSETUJUAN PERBAIKAN" | "READY"
  },
  { timestamps: true }
);

// Compound index untuk analitik dan cross-check
manifestCeisaRecordSchema.index({ batch_id: 1, direction: 1 });
manifestCeisaRecordSchema.index({ nomor_voyage: 1, tanggal_tiba: 1 });
manifestCeisaRecordSchema.index({ tanggal_tiba: 1, sarana_angkut: 1 });
manifestCeisaRecordSchema.index({ status_ceisa: 1, tanggal_tiba: 1 });
manifestCeisaRecordSchema.index({ npwp: 1, tanggal_tiba: 1 });

module.exports = mongoose.model(
  "ManifestCeisaRecord",
  manifestCeisaRecordSchema,
  "manifest_ceisa_records"
);
