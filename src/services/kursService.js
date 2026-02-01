const https = require('https');

// Data kurs default dengan flag image URL
let kursData = {
  updated_at: new Date(),
  periode: '28 Jan 2026 - 03 Feb 2026',
  source: 'default',
  currencies: [
    { code: 'USD', name: 'Dolar Amerika Serikat', flag: 'https://flagcdn.com/w40/us.png', rate: 16924.00 },
    { code: 'AUD', name: 'Dolar Australia', flag: 'https://flagcdn.com/w40/au.png', rate: 11490.24 },
    { code: 'BND', name: 'Dolar Brunei Darussalam', flag: 'https://flagcdn.com/w40/bn.png', rate: 13200.24 },
    { code: 'CAD', name: 'Dolar Kanada', flag: 'https://flagcdn.com/w40/ca.png', rate: 12259.18 },
    { code: 'CHF', name: 'Franc Swiss', flag: 'https://flagcdn.com/w40/ch.png', rate: 21412.77 },
    { code: 'CNY', name: 'Yuan Renminbi Tiongkok', flag: 'https://flagcdn.com/w40/cn.png', rate: 2432.55 },
    { code: 'DKK', name: 'Kroner Denmark', flag: 'https://flagcdn.com/w40/dk.png', rate: 2656.91 },
    { code: 'EUR', name: 'Euro', flag: 'https://flagcdn.com/w40/eu.png', rate: 19847.89 },
    { code: 'GBP', name: 'Poundsterling Inggris', flag: 'https://flagcdn.com/w40/gb.png', rate: 22825.81 },
    { code: 'HKD', name: 'Dolar Hong Kong', flag: 'https://flagcdn.com/w40/hk.png', rate: 2175.32 },
    { code: 'JPY', name: 'Yen Jepang', flag: 'https://flagcdn.com/w40/jp.png', rate: 112.45 },
    { code: 'KRW', name: 'Won Korea Selatan', flag: 'https://flagcdn.com/w40/kr.png', rate: 12.85 },
    { code: 'MYR', name: 'Ringgit Malaysia', flag: 'https://flagcdn.com/w40/my.png', rate: 3890.50 },
    { code: 'NZD', name: 'Dolar Selandia Baru', flag: 'https://flagcdn.com/w40/nz.png', rate: 10250.75 },
    { code: 'SAR', name: 'Riyal Arab Saudi', flag: 'https://flagcdn.com/w40/sa.png', rate: 4512.00 },
    { code: 'SGD', name: 'Dolar Singapura', flag: 'https://flagcdn.com/w40/sg.png', rate: 13200.24 },
    { code: 'THB', name: 'Baht Thailand', flag: 'https://flagcdn.com/w40/th.png', rate: 498.25 },
    { code: 'AED', name: 'Dirham Uni Emirat Arab', flag: 'https://flagcdn.com/w40/ae.png', rate: 4608.50 }
  ]
};

async function scrapeKurs() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'fiskal.kemenkeu.go.id',
      path: '/informasi-publik/kurs-pajak',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const match = data.match(/USD[^0-9]*([0-9.,]+)/i);
          if (match) {
            const kurs = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
            if (kurs > 10000 && kurs < 25000) {
              const usd = kursData.currencies.find(c => c.code === 'USD');
              if (usd) usd.rate = kurs;
              kursData.updated_at = new Date();
              kursData.source = 'kemenkeu';
            }
          }
        } catch(e) {}
        resolve(kursData);
      });
    }).on('error', () => resolve(kursData));
  });
}

function getAllKurs() { return kursData; }
function getKurs(code = 'USD') {
  const currency = kursData.currencies.find(c => c.code === code);
  return currency ? { ...currency, updated_at: kursData.updated_at, source: kursData.source } : null;
}
function setKurs(code, rate) {
  const currency = kursData.currencies.find(c => c.code === code);
  if (currency) { currency.rate = rate; kursData.updated_at = new Date(); kursData.source = 'manual'; }
  return kursData;
}
function hitungPajak(fobUsd, jumlahUnit = 1, currency = 'USD') {
  const BEBAS_BEA = 500, TARIF_BM = 0.10, TARIF_PPN = 0.11;
  const kurs = kursData.currencies.find(c => c.code === currency)?.rate || 16924;
  const kenaFob = Math.max(0, fobUsd - BEBAS_BEA);
  const nilaiPabean = kenaFob * kurs;
  const bm = nilaiPabean * TARIF_BM;
  const ppn = (nilaiPabean + bm) * TARIF_PPN;
  return {
    input: { fob_usd: fobUsd, jumlah_unit: jumlahUnit, currency },
    kurs: { rate: kurs, source: kursData.source },
    perhitungan: { pembebasan_usd: BEBAS_BEA, kena_pajak_usd: kenaFob, nilai_pabean_idr: Math.round(nilaiPabean), bm_persen: '10%', bm_idr: Math.round(bm), ppn_persen: '11%', ppn_idr: Math.round(ppn), total_pajak_idr: Math.round(bm + ppn) },
    catatan: jumlahUnit > 2 ? 'PERINGATAN: Maksimal 2 IMEI per paspor!' : null
  };
}
module.exports = { scrapeKurs, getAllKurs, getKurs, setKurs, hitungPajak };
