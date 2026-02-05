const mongoose = require('mongoose');

const kursSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  flag: { type: String },
  rate: { type: Number, required: true },
  updated_at: { type: Date, default: Date.now }
});

const kursMetaSchema = new mongoose.Schema({
  _id: { type: String, default: 'current' },
  periode: { type: String, required: true },
  kmk_number: { type: String },
  source: { type: String, default: 'manual' },
  updated_at: { type: Date, default: Date.now },
  updated_by: { type: String, default: 'system' }
});

const Kurs = mongoose.model('Kurs', kursSchema, 'kurs');
const KursMeta = mongoose.model('KursMeta', kursMetaSchema, 'kurs_meta');

module.exports = { Kurs, KursMeta };
