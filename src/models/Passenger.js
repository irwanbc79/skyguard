const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema({
  passport: { type: String, required: true, unique: true, index: true },
  total_arrivals: { type: Number, default: 0 },
  total_devices: { type: Number, default: 0 },
  first_arrival: { type: Date },
  last_arrival: { type: Date },
  flags: [{
    type: { type: String }, // frequent_traveler, imei_collector, high_value
    created_at: { type: Date, default: Date.now }
  }],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Passenger', passengerSchema, 'passengers');
