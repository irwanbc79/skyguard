const mongoose = require("mongoose");

const manifestPassengerSchema = new mongoose.Schema(
  {
    manifest_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manifest",
      index: true,
      required: true,
    },
    flight_number: { type: String, index: true },
    flight_date: Date,
    segment_index: Number,
    status: { type: String, enum: ["checked_in", "no_show"], required: true },
    name: String,
    level: String,
    pnr: String,
    fare_class: String,
    seq_no: Number,
    travel_date: String,
    seat_no: String,
    destination_code: String,
    flight_no: String,
    raw_line: String,
    // Data paspor (dari APIS / Lion Air MANIFEST)
    passport_number: { type: String },
    nationality: String,
    gender: String,
    date_of_birth: String,
    passport_expiry: String,
    doc_type: String,
    // Hasil crosscheck dengan CEISA
    ceisa_match: { type: Boolean, default: null },
    ceisa_records_count: { type: Number, default: 0 },
    // ENH / Baggage fields
    bag_weight: Number,
    ticket_number: String,
    pax_type: String,
  },
  { timestamps: true },
);

manifestPassengerSchema.index({ manifest_id: 1, seq_no: 1, status: 1 });
manifestPassengerSchema.index({ name: 1 });
manifestPassengerSchema.index({ pnr: 1 });
manifestPassengerSchema.index(
  { passport_number: 1 },
  { partialFilterExpression: { passport_number: { $type: "string" } } },
);

module.exports = mongoose.model(
  "ManifestPassenger",
  manifestPassengerSchema,
  "manifest_passengers",
);
