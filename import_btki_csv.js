require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

const hsCodeSchema = new mongoose.Schema({
  hs_code: { type: String, required: true, unique: true, index: true },
  chapter: { type: String, required: true, index: true },
  description_id: { type: String, required: true },
  description_en: { type: String, required: true },
  import_duty: { type: String, default: '' },
  export_duty: { type: String, default: '' },
  ppn: { type: String, default: '' },
  ppnbm: { type: String, default: '' },
  hs_level: { type: Number, default: 8, index: true }
}, { timestamps: true });

const HsCode = mongoose.model('HsCode', hsCodeSchema, 'hs_codes');

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else current += c;
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] || '');
    return row;
  }).filter(r => r.hs_code);
}

async function run() {
  console.log('Connecting...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected! Reading CSV...');
  const records = parseCSV(fs.readFileSync('/tmp/btki_2022_data.csv', 'utf-8'));
  console.log('Records:', records.length);
  let done = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const ops = batch.map(r => ({
      updateOne: {
        filter: { hs_code: r.hs_code },
        update: { $set: { ...r, hs_level: parseInt(r.hs_level) || 8 } },
        upsert: true
      }
    }));
    await HsCode.bulkWrite(ops);
    done += batch.length;
    process.stdout.write('\rProgress: ' + done + '/' + records.length);
  }
  console.log('\nTotal:', await HsCode.countDocuments());
  await mongoose.connection.close();
}

run().catch(e => { console.error(e); process.exit(1); });
