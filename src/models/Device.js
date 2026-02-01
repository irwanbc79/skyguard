const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  brand: { type: String, required: true, index: true },
  model: { type: String, required: true, index: true },
  capacity: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

deviceSchema.index({ brand: 1, model: 1 });

module.exports = mongoose.model('Device', deviceSchema);
