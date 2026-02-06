const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  kode_kantor: { type: String, index: true },
  nomor_dokumen: { type: String, index: true },
  tanggal_dokumen: { type: Date, index: true },
  passport: { type: String, required: true, index: true },
  waktu_rekam: { type: Date },
  qr_code: { type: String },
  nip_petugas: { type: String, index: true },
  nama_petugas: { type: String },
  status: { type: String, index: true }, // PENELITIAN LEBIH LANJUT, SELESAI
  kode_kantor_peneliti: { type: String },
  hkt1: { type: String }, // Device 1
  hkt2: { type: String }, // Device 2
  status_penelitian: { type: String }, // PEMBEBASAN, BAYAR, dll
  
  // Enriched data (linked to device database)
  hkt1_device_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  hkt1_price_usd: { type: Number },
  hkt2_device_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  hkt2_price_usd: { type: Number },
  total_value_usd: { type: Number, default: 0 },
  
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema, 'transactions');
