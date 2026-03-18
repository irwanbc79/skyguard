const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema({
  nomor_aju: String,
  nomor_pibk: String,
  nama_penerima: String,
  prediction: { type: String, enum: ['NORMAL', 'UNDER-INVOICING'] },
  label: Number,
  confidence: Number,
  features: {
    cif_per_unit: Number,
    gap_ratio: Number,
    hs_risk: Number,
    country_risk: Number,
    freq_importir: Number,
  },
}, { _id: false });

const qsvmResultSchema = new mongoose.Schema({
  scan_id: { type: String, required: true, unique: true, index: true },
  scan_date: { type: Date, default: Date.now, index: true },
  engine: { type: String, default: 'quantum' }, // 'quantum' or 'classical-rbf'
  total_scanned: { type: Number, default: 0 },
  total_flagged: { type: Number, default: 0 },
  total_normal: { type: Number, default: 0 },
  avg_confidence: { type: Number, default: 0 },
  predictions: [predictionSchema],
  status: { type: String, default: 'completed', index: true }, // completed, error
  error_message: String,
  scanned_by: { type: String, default: 'system' },
}, { timestamps: true });

module.exports = mongoose.model('QsvmResult', qsvmResultSchema, 'qsvm_results');
