const mongoose = require("mongoose");

const pbcEcdRecordSchema = new mongoose.Schema(
  {
    batch_id: { type: mongoose.Schema.Types.ObjectId, ref: "PbcDataBatch", required: true, index: true },
    nomorDokumen: { type: String, index: true },
    qrCode: { type: String, index: true },
    paspor: { type: String, index: true },
    nama: String,
    kebangsaan: String,
    nomorPenerbangan: String,
    kodeJalur: String,           // M = Merah, H = Hijau
    statusDokumen: String,
    kodeAtensi: { type: String, index: true }, // D, I, A, D,A, null
    has_imei: { type: Boolean, default: false, index: true },
    tanggalKedatangan: { type: Date, index: true },
    nipPetugasPindai: { type: String, index: true },   // RAO officer
    namaPetugasPindai: String,
    nipPetugasPemeriksa: { type: String, index: true },
    namaPetugasPemeriksa: String,
    nipPetugasPeneliti: { type: String, index: true },
    namaPetugasPeneliti: String,
    waktuScanQr: { type: Date },     // T-start SLA 3 jam
    waktuPemeriksaan: { type: Date },
    waktuPenelitian: { type: Date }, // T-end jika ada
    waktuRekam: { type: Date },      // waktu penumpang submit form
    kodeKantor: String,
    period_month: { type: Number, index: true },
    period_year: { type: Number, index: true },
  },
  { timestamps: true }
);

pbcEcdRecordSchema.index({ paspor: 1, tanggalKedatangan: -1 });
pbcEcdRecordSchema.index({ nipPetugasPindai: 1, period_year: 1, period_month: 1 });
pbcEcdRecordSchema.index({ has_imei: 1, tanggalKedatangan: -1 });
pbcEcdRecordSchema.index({ batch_id: 1, nomorDokumen: 1 });

module.exports = mongoose.model("PbcEcdRecord", pbcEcdRecordSchema, "pbc_ecd_records");
