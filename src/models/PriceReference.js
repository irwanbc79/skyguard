const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema({
  device_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
  price_usd: { type: Number, required: true },
  tax_idr: { type: Number, default: 0 },
  source: { type: String },
  is_latest: { type: Boolean, default: true, index: true },
  created_at: { type: Date, default: Date.now, index: true },
  created_by: { type: String }
});

module.exports = mongoose.model('PriceReference', priceSchema, 'price_references');
