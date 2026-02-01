const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Models
const Passenger = require('./src/models/Passenger');
const Transaction = require('./src/models/Transaction');

async function parseDate(dateStr) {
  if (!dateStr) return null;
  // Format: DD-MM-YYYY atau DD-MM-YYYY HH:MM:SS
  const parts = dateStr.split(' ')[0].split('-');
  if (parts.length === 3) {
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  return null;
}

async function importCSV(filePath) {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const header = lines[0].split(';');
  
  console.log('Headers:', header);
  console.log('Total lines:', lines.length);
  
  let imported = 0;
  let errors = 0;
  const passengerMap = new Map(); // Track passenger stats
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(';');
    if (values.length < 13) continue;
    
    try {
      const passport = values[3]?.toUpperCase();
      if (!passport) continue;
      
      // Create transaction
      const transaction = {
        kode_kantor: values[0],
        nomor_dokumen: values[1],
        tanggal_dokumen: await parseDate(values[2]),
        passport: passport,
        waktu_rekam: await parseDate(values[4]),
        qr_code: values[5],
        nip_petugas: values[6],
        nama_petugas: values[7],
        status: values[8],
        kode_kantor_peneliti: values[9],
        hkt1: values[10] || null,
        hkt2: values[11] || null,
        status_penelitian: values[12]
      };
      
      await Transaction.findOneAndUpdate(
        { nomor_dokumen: transaction.nomor_dokumen },
        transaction,
        { upsert: true, new: true }
      );
      
      // Track passenger stats
      if (!passengerMap.has(passport)) {
        passengerMap.set(passport, {
          arrivals: 0,
          devices: new Set(),
          first: transaction.tanggal_dokumen,
          last: transaction.tanggal_dokumen
        });
      }
      
      const pData = passengerMap.get(passport);
      pData.arrivals++;
      if (transaction.hkt1) pData.devices.add(transaction.hkt1);
      if (transaction.hkt2) pData.devices.add(transaction.hkt2);
      if (transaction.tanggal_dokumen < pData.first) pData.first = transaction.tanggal_dokumen;
      if (transaction.tanggal_dokumen > pData.last) pData.last = transaction.tanggal_dokumen;
      
      imported++;
      if (imported % 1000 === 0) console.log(`Imported ${imported} transactions...`);
      
    } catch (err) {
      errors++;
      if (errors < 5) console.error(`Error line ${i}:`, err.message);
    }
  }
  
  console.log(`\nTransactions imported: ${imported}`);
  console.log(`Errors: ${errors}`);
  
  // Update/Create passengers
  console.log('\nUpdating passenger profiles...');
  let pCount = 0;
  for (const [passport, data] of passengerMap) {
    await Passenger.findOneAndUpdate(
      { passport },
      {
        passport,
        total_arrivals: data.arrivals,
        total_devices: data.devices.size,
        first_arrival: data.first,
        last_arrival: data.last,
        updated_at: new Date()
      },
      { upsert: true }
    );
    pCount++;
    if (pCount % 500 === 0) console.log(`Updated ${pCount} passengers...`);
  }
  
  console.log(`\nPassengers updated: ${pCount}`);
  
  // Show alerts
  const frequentTravelers = await Passenger.countDocuments({ total_arrivals: { $gte: 3 } });
  const imeiCollectors = await Passenger.countDocuments({ total_devices: { $gte: 4 } });
  
  console.log('\n=== ALERTS ===');
  console.log(`Frequent Travelers (≥3 arrivals): ${frequentTravelers}`);
  console.log(`IMEI Collectors (≥4 devices): ${imeiCollectors}`);
  
  await mongoose.disconnect();
  console.log('\nDone!');
}

// Usage: node import_passengers.js /path/to/file.csv
const filePath = process.argv[2];
if (!filePath) {
  console.log('Usage: node import_passengers.js <csv_file_path>');
  process.exit(1);
}

importCSV(filePath).catch(console.error);
