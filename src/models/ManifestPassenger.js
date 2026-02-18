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
    raw_line: String,

    // === APIS / Document Intelligence Fields ===
    doc_number: { type: String, index: true },   // Nomor paspor / dokumen perjalanan
    doc_type: String,                             // P = Passport, V = Visa
    doc_expiry: Date,                             // Tanggal kedaluwarsa dokumen
    nationality: { type: String, index: true },   // Kode negara 2-huruf (MY, ID, AU, SG)
    residence: String,                            // Negara domisili
    gender: { type: String, enum: ['M', 'F', 'I', null] },
    dob: Date,                                    // Tanggal lahir
    country_of_issue: String,                     // Negara penerbit dokumen
    full_name_apis: String,                       // Nama lengkap dari APIS (lebih akurat)
    apis_synced: { type: Boolean, default: false }// Flag: apakah data APIS sudah digabung
  },
  { timestamps: true }
);

manifestPassengerSchema.index({ manifest_id: 1, seq_no: 1, status: 1 });
manifestPassengerSchema.index({ doc_number: 1, flight_date: -1 });
manifestPassengerSchema.index({ nationality: 1, flight_date: -1 });

module.exports = mongoose.model('ManifestPassenger', manifestPassengerSchema, 'manifest_passengers');
