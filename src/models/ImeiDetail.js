const mongoose = require("mongoose");

const imeiDetailSchema = new mongoose.Schema(
  {
    // Registration link
    registration_id: { type: Number, index: true }, // ID from CSV
    no_dokumen: { type: String, index: true },
    tgl_dokumen: Date,

    // Identity (denormalized for fast queries)
    nama: { type: String, index: true },
    no_identitas: { type: String, index: true }, // passport
    kebangsaan: String,
    npwp_nik: String,

    // Flight/Vessel
    flight_voyage: { type: String, index: true },
    flight_normalized: { type: String, index: true },
    waktu_kedatangan: { type: Date, index: true },
    waktu_rekam: Date,

    // Payment
    cara_pembayaran: {
      type: String,
      enum: ["PEMBEBASAN", "BILLING", "BPPM", "WAITINGLIST", "UNKNOWN"],
      default: "UNKNOWN",
      index: true,
    },
    kode_billing: String,
    tgl_billing: Date,
    ndpbm: { type: Number, default: 0 }, // exchange rate
    pembebasan_usd: { type: Number, default: 0 }, // USD exemption

    // Device info
    device_no: { type: Number, default: 1 }, // sequence no within registration
    merk: { type: String, index: true }, // brand
    tipe: String, // model
    storage: String, // e.g. "256GB"
    storage_normalized: Number, // in GB, for queries
    ram: String,
    warna: String,

    // IMEI Numbers - the goldmine
    imei1: { type: String, index: true, sparse: true },
    imei2: { type: String, index: true, sparse: true },

    // Valuation
    harga_fob: { type: Number, default: 0 },
    mata_uang: { type: String, default: "USD" },
    harga_fob_usd: { type: Number, default: 0 },
    hs_code: { type: String, default: "8517.13.00" },
    bekas: { type: Boolean, default: false }, // used device?

    // CIF & Customs
    cif_usd: { type: Number, default: 0 },
    total_cif_usd: { type: Number, default: 0 },
    total_cif_pembebasan_usd: { type: Number, default: 0 },
    nilai_pabean_rp: { type: Number, default: 0 },

    // Tax breakdown
    tarif_bm: String, // e.g. "10%"
    pungutan_bm: { type: Number, default: 0 },
    tarif_ppn: String, // e.g. "11%"
    pungutan_ppn: { type: Number, default: 0 },
    tarif_pph: String, // e.g. "0%"
    pungutan_pph: { type: Number, default: 0 },
    total_pungutan: { type: Number, default: 0 },

    // Kantor (extracted from no_dokumen)
    kode_kantor: { type: String, index: true },

    // Meta
    source_file: String,
    imported_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Compound indexes for intelligence queries
imeiDetailSchema.index({ imei1: 1, no_identitas: 1 }); // IMEI ownership tracking
imeiDetailSchema.index({ imei2: 1, no_identitas: 1 });
imeiDetailSchema.index({ merk: 1, tipe: 1 }); // Brand/model analytics
imeiDetailSchema.index({ no_identitas: 1, waktu_kedatangan: -1 }); // passport timeline
imeiDetailSchema.index({ registration_id: 1, device_no: 1 }, { unique: true }); // dedup
imeiDetailSchema.index({ harga_fob_usd: -1 }); // high-value device queries
imeiDetailSchema.index({ merk: 1, harga_fob_usd: -1 }); // brand pricing
imeiDetailSchema.index({ kode_kantor: 1, waktu_kedatangan: -1 }); // office analysis
imeiDetailSchema.index({ cara_pembayaran: 1, total_pungutan: -1 }); // payment analysis

module.exports = mongoose.model("ImeiDetail", imeiDetailSchema);
