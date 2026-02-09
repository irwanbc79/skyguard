const mongoose = require('mongoose');

const manifestPassengerSchema = new mongoose.Schema(
  {
    manifest_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Manifest', index: true, required: true },
    flight_number: { type: String, index: true },
    flight_date: Date,
    segment_index: Number,
    status: { type: String, enum: ['checked_in', 'no_show'], required: true },
    name: String,
    level: String,
    pnr: String,
    fare_class: String,
    seq_no: Number,
    travel_date: String,
    seat_no: String,
    destination_code: String,
    flight_no: String,
    raw_line: String
  },
  { timestamps: true }
);

manifestPassengerSchema.index({ manifest_id: 1, seq_no: 1, status: 1 });

module.exports = mongoose.model('ManifestPassenger', manifestPassengerSchema, 'manifest_passengers');
