const https = require('https');
const cron = require('node-cron');
const { Kurs, KursMeta } = require('../models/Kurs');

// Default kurs data (digunakan jika database kosong)
const defaultKurs = [
  { code: 'USD', name: 'Dolar Amerika Serikat', flag: 'https://flagcdn.com/w40/us.png', rate: 16777.00 },
  { code: 'AUD', name: 'Dolar Australia', flag: 'https://flagcdn.com/w40/au.png', rate: 11737.86 },
  { code: 'BND', name: 'Dolar Brunei Darussalam', flag: 'https://flagcdn.com/w40/bn.png', rate: 13254.70 },
  { code: 'CAD', name: 'Dolar Kanada', flag: 'https://flagcdn.com/w40/ca.png', rate: 12346.38 },
  { code: 'CHF', name: 'Franc Swiss', flag: 'https://flagcdn.com/w40/ch.png', rate: 21824.59 },
  { code: 'CNY', name: 'Yuan Renminbi Tiongkok', flag: 'https://flagcdn.com/w40/cn.png', rate: 2432.55 },
  { code: 'DKK', name: 'Kroner Denmark', flag: 'https://flagcdn.com/w40/dk.png', rate: 2682.18 },
  { code: 'EUR', name: 'Euro', flag: 'https://flagcdn.com/w40/eu.png', rate: 19847.89 },
  { code: 'GBP', name: 'Poundsterling Inggris', flag: 'https://flagcdn.com/w40/gb.png', rate: 23095.89 },
  { code: 'HKD', name: 'Dolar Hong Kong', flag: 'https://flagcdn.com/w40/hk.png', rate: 2149.93 },
  { code: 'JPY', name: 'Yen Jepang (per 100)', flag: 'https://flagcdn.com/w40/jp.png', rate: 10926.94 },
  { code: 'KRW', name: 'Won Korea Selatan (per 100)', flag: 'https://flagcdn.com/w40/kr.png', rate: 1150.00 },
  { code: 'MYR', name: 'Ringgit Malaysia', flag: 'https://flagcdn.com/w40/my.png', rate: 4255.29 },
  { code: 'NZD', name: 'Dolar Selandia Baru', flag: 'https://flagcdn.com/w40/nz.png', rate: 10126.60 },
  { code: 'SAR', name: 'Riyal Arab Saudi', flag: 'https://flagcdn.com/w40/sa.png', rate: 4472.00 },
  { code: 'SGD', name: 'Dolar Singapura', flag: 'https://flagcdn.com/w40/sg.png', rate: 13254.70 },
  { code: 'THB', name: 'Baht Thailand', flag: 'https://flagcdn.com/w40/th.png', rate: 498.25 },
  { code: 'AED', name: 'Dirham Uni Emirat Arab', flag: 'https://flagcdn.com/w40/ae.png', rate: 4568.00 }
];

// Cache untuk performance
let kursCache = null;
let metaCache = null;

// Initialize database dengan default data jika kosong
async function initKurs() {
  try {
    const count = await Kurs.countDocuments();
    if (count === 0) {
      console.log('Initializing kurs data...');
      await Kurs.insertMany(defaultKurs);
      await KursMeta.findOneAndUpdate(
        { _id: 'current' },
        { periode: '04 Feb 2026 - 10 Feb 2026', kmk_number: 'KMK 5/MK/EF.2/2026', source: 'initial', updated_at: new Date() },
        { upsert: true }
      );
      console.log('Kurs data initialized');
    }
    await refreshCache();
  } catch (err) { console.error('Init kurs error:', err); }
}

// Refresh cache dari database
async function refreshCache() {
  try {
    kursCache = await Kurs.find().lean();
    metaCache = await KursMeta.findById('current').lean();
  } catch (err) { console.error('Refresh cache error:', err); }
}

// Get all kurs
async function getAllKurs() {
  if (!kursCache) await refreshCache();
  return {
    updated_at: metaCache?.updated_at || new Date(),
    periode: metaCache?.periode || '-',
    kmk_number: metaCache?.kmk_number || '-',
    source: metaCache?.source || 'database',
    currencies: kursCache || defaultKurs
  };
}

// Get single kurs
async function getKurs(code = 'USD') {
  if (!kursCache) await refreshCache();
  const currency = kursCache?.find(c => c.code === code);
  if (!currency) return null;
  return { ...currency, updated_at: metaCache?.updated_at, source: metaCache?.source };
}

// Set single kurs
async function setKurs(code, rate) {
  try {
    await Kurs.findOneAndUpdate({ code }, { rate, updated_at: new Date() }, { upsert: true });
    await KursMeta.findOneAndUpdate({ _id: 'current' }, { source: 'manual', updated_at: new Date() });
    await refreshCache();
    return await getAllKurs();
  } catch (err) { console.error('Set kurs error:', err); return null; }
}

// Bulk update kurs (untuk admin)
async function bulkUpdateKurs(kursArray, periode, kmkNumber, updatedBy = 'admin') {
  try {
    for (const k of kursArray) {
      await Kurs.findOneAndUpdate(
        { code: k.code },
        { rate: k.rate, name: k.name || undefined, updated_at: new Date() },
        { upsert: true }
      );
    }
    await KursMeta.findOneAndUpdate(
      { _id: 'current' },
      { periode, kmk_number: kmkNumber, source: 'admin', updated_at: new Date(), updated_by: updatedBy },
      { upsert: true }
    );
    await refreshCache();
    return { status: 'ok', message: `${kursArray.length} kurs updated` };
  } catch (err) { 
    console.error('Bulk update error:', err); 
    return { status: 'error', message: err.message }; 
  }
}

// Scrape kurs dari Kemenkeu (basic)
async function scrapeKurs() {
  return new Promise(async (resolve) => {
    const options = {
      hostname: 'fiskal.kemenkeu.go.id',
      path: '/informasi-publik/kurs-pajak',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          // Parse USD rate
          const usdMatch = data.match(/USD[^0-9]*?([\d.,]+)/i);
          if (usdMatch) {
            const rate = parseFloat(usdMatch[1].replace(/\./g, '').replace(',', '.'));
            if (rate > 10000 && rate < 25000) {
              await Kurs.findOneAndUpdate({ code: 'USD' }, { rate, updated_at: new Date() });
              await KursMeta.findOneAndUpdate({ _id: 'current' }, { source: 'auto-scrape', updated_at: new Date() });
              await refreshCache();
              console.log(`Auto-scraped USD: ${rate}`);
            }
          }
        } catch (e) { console.error('Scrape parse error:', e); }
        resolve(await getAllKurs());
      });
    }).on('error', async (err) => {
      console.error('Scrape error:', err);
      resolve(await getAllKurs());
    });
  });
}

// Hitung pajak
async function hitungPajak(fobUsd, jumlahUnit = 1, currency = 'USD') {
  if (!kursCache) await refreshCache();
  
  const BEBAS_BEA = 500, TARIF_BM = 0.10, TARIF_PPN = 0.11;
  const kursData = kursCache?.find(c => c.code === currency);
  const kurs = kursData?.rate || 16777;
  
  const kenaFob = Math.max(0, fobUsd - BEBAS_BEA);
  const nilaiPabean = kenaFob * kurs;
  const bm = nilaiPabean * TARIF_BM;
  const ppn = (nilaiPabean + bm) * TARIF_PPN;
  
  return {
    input: { fob_usd: fobUsd, jumlah_unit: jumlahUnit, currency },
    kurs: { rate: kurs, source: metaCache?.source || 'database' },
    perhitungan: {
      pembebasan_usd: BEBAS_BEA,
      kena_pajak_usd: kenaFob,
      nilai_pabean_idr: Math.round(nilaiPabean),
      bm_persen: '10%',
      bm_idr: Math.round(bm),
      ppn_persen: '11%',
      ppn_idr: Math.round(ppn),
      total_pajak_idr: Math.round(bm + ppn)
    },
    catatan: jumlahUnit > 2 ? 'PERINGATAN: Maksimal 2 IMEI per paspor!' : null
  };
}

// Scheduler: Auto scrape setiap Rabu jam 10:00 WIB
cron.schedule('0 10 * * 3', async () => {
  console.log('Running scheduled kurs scrape (Wednesday 10:00 WIB)...');
  await scrapeKurs();
}, { timezone: 'Asia/Jakarta' });

console.log('Kurs scheduler initialized - Auto scrape every Wednesday 10:00 WIB');

module.exports = { 
  initKurs, 
  getAllKurs, 
  getKurs, 
  setKurs, 
  bulkUpdateKurs, 
  scrapeKurs, 
  hitungPajak,
  refreshCache 
};
