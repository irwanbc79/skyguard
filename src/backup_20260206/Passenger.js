const mongoose = require('mongoose');

// Schema untuk data CEISA Page 2 (Data Pendaftaran HKT)
const passengerSchema = new mongoose.Schema({
  // Identitas unik record
  qr_code: { type: String, required: true, unique: true, index: true },
  
  // Data Kantor & Dokumen
  kode_kantor: { type: String, index: true },
  nomor_dokumen: { type: String, index: true },
  tanggal_dokumen: { type: Date, index: true },
  
  // Data Penumpang
  paspor: { type: String, required: true, index: true },
  nama_lengkap: { type: String }, // Nama pemilik paspor dari Data Penetapan
  
  // Data Rekam
  waktu_rekam: { type: Date },
  
  // Data Petugas
  nip_petugas: { type: String, index: true },
  nama_petugas: { type: String },
  
  // Status & Penelitian
  status: { type: String, index: true }, // PENELITIAN LEBIH LANJUT, PEMBEBASAN, dll
  kode_kantor_peneliti: { type: String },
  
  // Data Device (HKT)
  hkt1: { type: String }, // Device 1 - "APPLE IPHONE 13"
  hkt2: { type: String }, // Device 2 - "APPLE IPHONE 11"
  
  // Status Penelitian
  status_penelitian: { type: String, index: true }, // PEMBEBASAN, BILLING
  
  // Metadata
  created_at: { type: Date, default: Date.now },
  upload_batch: { type: String, index: true } // Track upload batch
});

// Compound index untuk pencarian cepat
passengerSchema.index({ paspor: 1, tanggal_dokumen: -1 });
passengerSchema.index({ hkt1: 1 });
passengerSchema.index({ status_penelitian: 1, tanggal_dokumen: -1 });

module.exports = mongoose.model('Passenger', passengerSchema, 'passengers');
