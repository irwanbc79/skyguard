const mongoose = require('mongoose');

const manifestSchema = new mongoose.Schema(
  {
    flight_number: { type: String, index: true },
    flight_date: Date,
    direction: { type: String, enum: ['inbound', 'outbound', 'unknown'], default: 'unknown' },
    origin: String,
    destination: String,
    carrier: String,
    sender: String,
    email_subject: String,
    filename: String,
    file_path: String,
    file_type: String,
    status: {
      type: String,
      enum: ['received', 'parsed', 'needs_review', 'approved', 'rejected', 'synced', 'failed'],
      default: 'received'
    },
    parsed_fields: { type: Object, default: {} },
    parsing_notes: String,
    uploaded_by: { type: String, default: 'system' },
    source: { type: String, enum: ['manual', 'email', 'api'], default: 'manual' },
    received_at: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Manifest', manifestSchema);
