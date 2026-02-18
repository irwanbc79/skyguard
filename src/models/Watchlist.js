/**
 * Watchlist.js
 * Daftar pantau paspor/dokumen perjalanan untuk petugas Bea Cukai.
 * Saat paspor muncul di manifest, sistem akan otomatis memberi flag.
 */
const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema(
  {
    doc_number: { type: String, required: true, index: true, uppercase: true, trim: true },
    doc_type: { type: String, default: 'P' }, // P = Passport

    // Identitas (opsional, diisi otomatis dari data APIS jika ada)
    name: { type: String },
    nationality: { type: String },

    // Keterangan kasus
    priority: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' },
    reason: { type: String, required: true }, // Alasan masuk watchlist
    notes: { type: String },                  // Catatan investigatif tambahan
    case_number: { type: String },            // Nomor kasus referensi (opsional)

    // Petugas yang menambahkan
    added_by: { type: String, required: true }, // Nama / NIP petugas

    // Status
    is_active: { type: Boolean, default: true, index: true },
    hit_count: { type: Number, default: 0 },  // Berapa kali terdeteksi di manifest
    last_hit_flight: { type: String },         // Penerbangan terakhir yang cocok
    last_hit_date: { type: Date }              // Tanggal deteksi terakhir
  },
  { timestamps: true }
);

watchlistSchema.index({ doc_number: 1, is_active: 1 });

module.exports = mongoose.model('Watchlist', watchlistSchema, 'watchlist');
