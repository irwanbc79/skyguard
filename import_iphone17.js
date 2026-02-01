const mongoose = require('mongoose');
require('dotenv').config({ path: '/root/skyguard/.env' });

const deviceSchema = new mongoose.Schema({
  brand: String,
  model: String,
  capacity: String,
  created_at: { type: Date, default: Date.now }
});

const priceSchema = new mongoose.Schema({
  device_id: mongoose.Schema.Types.ObjectId,
  price_usd: Number,
  tax_idr: Number,
  source: String,
  is_latest: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

const Device = mongoose.model('Device', deviceSchema);
const PriceReference = mongoose.model('PriceReference', priceSchema);

// Data iPhone 17 series dari Excel
const newDevices = [
  // iPhone 17
  { model: 'iPhone 17', capacity: '256GB', price: 799, tax: 1119293 },
  { model: 'iPhone 17', capacity: '512GB', price: 999, tax: 1866854 },
  
  // iPhone 17 Pro
  { model: 'iPhone 17 Pro', capacity: '256GB', price: 1099, tax: 2240635 },
  { model: 'iPhone 17 Pro', capacity: '512GB', price: 1299, tax: 2989195 },
  { model: 'iPhone 17 Pro', capacity: '1TB', price: 1499, tax: 3736756 },
  
  // iPhone 17 Pro Max
  { model: 'iPhone 17 Pro Max', capacity: '256GB', price: 1199, tax: 1866854 },
  { model: 'iPhone 17 Pro Max', capacity: '512GB', price: 1399, tax: 3362976 },
  { model: 'iPhone 17 Pro Max', capacity: '1TB', price: 1599, tax: 4110537 },
  { model: 'iPhone 17 Pro Max', capacity: '2TB', price: 1999, tax: 5606658 }
];

async function importData() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  
  for (const item of newDevices) {
    // Check if exists
    let device = await Device.findOne({ brand: 'Apple', model: item.model, capacity: item.capacity });
    
    if (!device) {
      device = await Device.create({ brand: 'Apple', model: item.model, capacity: item.capacity });
      console.log(`Created: ${item.model} ${item.capacity}`);
    } else {
      console.log(`Exists: ${item.model} ${item.capacity}`);
    }
    
    // Mark old prices as not latest
    await PriceReference.updateMany({ device_id: device._id }, { is_latest: false });
    
    // Add new price
    await PriceReference.create({
      device_id: device._id,
      price_usd: item.price,
      tax_idr: item.tax,
      source: 'excel',
      is_latest: true
    });
    console.log(`  Price: $${item.price}, Tax: Rp ${item.tax.toLocaleString()}`);
  }
  
  const total = await Device.countDocuments();
  console.log(`\nTotal devices: ${total}`);
  
  await mongoose.disconnect();
}

importData().catch(console.error);
