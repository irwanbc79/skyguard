const mongoose = require("mongoose");

const dokumenSchema = new mongoose.Schema({
  filename:     { type: String, required: true },  // nama file di disk
  originalname: { type: String, required: true },  // nama asli dari petugas
  mimetype:     { type: String, required: true },  // image/jpeg, application/pdf, dst
  size:         { type: Number, default: 0 },
  uploaded_at:  { type: Date, default: Date.now },
}, { _id: true });

const pmiRecordSchema = new mongoose.Schema({
  // Identitas penumpang
  passport_number: { type: String, required: true, index: true, uppercase: true, trim: true },
  nama:            { type: String, index: true },

  // Data kartu PMI (opsional — diisi kalau ada)
  no_kartu_pmi:   String,
  lembaga:        { type: String, default: "BP2MI" }, // BP2MI, Kemenaker, dll
  tgl_terbit:     Date,
  tgl_berlaku:    Date,
  negara_tujuan:  String,

  // Pernyataan petugas — WAJIB
  catatan:        { type: String, required: true }, // "Penumpang menunjukkan kartu BP2MI no. xxx, valid"

  // Audit
  tagged_by_nip:  { type: String, index: true },
  tagged_by_nama: String,
  tagged_at:      { type: Date, default: Date.now, index: true },

  // Dokumen bukti (foto/PDF)
  dokumen:        [dokumenSchema],

  // Link ke data scraping (opsional)
  imei_reg_id:    { type: Number, index: true, sparse: true }, // ImeiDetail.registration_id

  // Status verifikasi
  status: {
    type: String,
    enum: ["CONFIRMED", "PENDING", "REVOKED"],
    default: "CONFIRMED",
    index: true,
  },
}, { timestamps: true });

pmiRecordSchema.index({ passport_number: 1, tagged_at: -1 });
pmiRecordSchema.index({ status: 1, tagged_at: -1 });

module.exports = mongoose.model("PmiRecord", pmiRecordSchema);
