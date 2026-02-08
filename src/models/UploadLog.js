const mongoose = require('mongoose');

const uploadLogSchema = new mongoose.Schema({
  uploaded_by: { type: String, required: true },
  uploaded_at: { type: Date, default: Date.now },
  filename: String,
  total_records: { type: Number, default: 0 },
  new_records: { type: Number, default: 0 },
  duplicate_records: { type: Number, default: 0 },
  error_records: { type: Number, default: 0 },
  module: { type: String, default: 'passenger' },
  notes: String
});

module.exports = mongoose.model('UploadLog', uploadLogSchema);
