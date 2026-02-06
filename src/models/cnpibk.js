const mongoose = require('mongoose');

const cnpibkSchema = new mongoose.Schema({
  nomor_aju: { type: String, required: true, unique: true, index: true },
  jenis_aju: { type: String, default: 'CN' },
  nomor_barang: { type: String, index: true },
  nomor_pibk: String,
  tanggal_pibk: Date,
  nomor_kantong: String,
  npwp_pemberitahu: { type: String, index: true },
  nama_pemberitahu: { type: String, index: true },
  nama_gudang: String,
  kode_kantor: { type: String, default: '010100' },
  nama_penerima: { type: String, index: true },
  nomor_identitas_penerima: String,
  alamat_penerima: String,
  nama_pengirim: String,
  nomor_identitas_pengirim: String,
  alamat_pengirim: String,
  tanggal_hawb: Date,
  current_status: { type: String, index: true },
  nama_pdtt: { type: String, index: true },
  nip_pdtt: { type: String, index: true },
  cif_awal: { type: Number, default: 0 },
  cif_akhir: { type: Number, default: 0 },
  fob_awal: { type: Number, default: 0 },
  fob_akhir: { type: Number, default: 0 },
  nomor_sppbmcp: String,
  tanggal_sppbmcp: Date,
  nomor_sppb: String,
  tanggal_sppb: Date,
  kode_billing: String,
  kode_billing_sptnp: String,
  // Metadata upload
  upload_batch: String,
  uploaded_by: { type: String, default: 'system' },
  uploaded_at: { type: Date, default: Date.now }
}, { timestamps: true });

// Index untuk pencarian cepat
cnpibkSchema.index({ nama_penerima: 'text', nama_pengirim: 'text', nama_pemberitahu: 'text' });
cnpibkSchema.index({ tanggal_hawb: -1 });
cnpibkSchema.index({ cif_akhir: -1 });

module.exports = mongoose.model('Cnpibk', cnpibkSchema);
