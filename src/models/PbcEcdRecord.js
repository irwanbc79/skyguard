const mongoose = require("mongoose");

// Hanya menyimpan record dengan kodeAtensi mengandung 'I' (atensi IMEI).
// Record non-IMEI discarded saat import — summary-nya tersimpan di PbcDataBatch.notes.
// Ini menghemat ~99.9% storage: 28.700 rows → ~16 rows per 7 hari.
const pbcEcdRecordSchema = new mongoose.Schema(
  {
    batch_id: { type: mongoose.Schema.Types.ObjectId, ref: "PbcDataBatch", required: true, index: true },
    paspor: { type: String, index: true },
    nama: String,
    nomorPenerbangan: String,
    kodeJalur: String,
    kodeAtensi: String,
    tanggalKedatangan: { type: Date, index: true },
    nipPetugasPindai: { type: String, index: true },
    namaPetugasPindai: String,
    waktuScanQr: { type: Date },    // T-start untuk SLA 3 jam IKI-001
    waktuPenelitian: { type: Date },
    kodeKantor: String,
    period_month: { type: Number, index: true },
    period_year: { type: Number, index: true },
  },
  { timestamps: true }
);

pbcEcdRecordSchema.index({ paspor: 1, tanggalKedatangan: -1 });
pbcEcdRecordSchema.index({ nipPetugasPindai: 1, period_year: 1, period_month: 1 });
pbcEcdRecordSchema.index({ tanggalKedatangan: -1 });

// TTL: auto-delete setelah 12 bulan — data sudah tidak diperlukan setelah IKI dihitung
pbcEcdRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 });

module.exports = mongoose.model("PbcEcdRecord", pbcEcdRecordSchema, "pbc_ecd_records");
