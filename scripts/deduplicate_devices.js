/**
 * Script Pembersih & Deduplikasi Data Device SkyGuard (KNO)
 * 
 * Penggunaan:
 *   1. Mode Simulasi / Cek Duplikat (Aman, tidak mengubah DB):
 *      node scripts/deduplicate_devices.js --dry-run
 * 
 *   2. Mode Eksekusi Nyata (Dengan Auto-Backup):
 *      node scripts/deduplicate_devices.js --apply
 * 
 *   3. Mode Eksekusi di VPS:
 *      cd /root/skyguard && node scripts/deduplicate_devices.js --apply
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Cek env file
const envPathLocal = path.join(__dirname, '../.env');
const envPathProd = '/root/skyguard/.env';

if (fs.existsSync(envPathLocal)) {
  require('dotenv').config({ path: envPathLocal });
} else if (fs.existsSync(envPathProd)) {
  require('dotenv').config({ path: envPathProd });
} else {
  require('dotenv').config();
}

const Device = require('../src/models/Device');
const PriceReference = require('../src/models/PriceReference');

function normalizeKey(str) {
  return (str || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeCapacity(str) {
  return (str || '').toString().trim().replace(/\s+/g, '').toLowerCase();
}

function normalizeModel(str, capacity = '') {
  let s = (str || '').toString().trim().toLowerCase();
  s = s.replace(/pro\s*max/gi, 'pro max');
  s = s.replace(/promax/gi, 'pro max');
  s = s.replace(/\s*\+\s*/g, ' plus ');
  s = s.replace(/\s+/g, ' ').trim();
  
  // Apple tidak pernah memproduksi iPhone 15 Pro Max 128GB; entri 128GB $718.02 adalah iPhone 15 Pro
  if (/iphone 15 pro max/i.test(s) && /128/i.test(capacity)) {
    s = 'iphone 15 pro';
  }
  
  return s;
}

function canonicalModel(modelStr, capacity = '') {
  let s = (modelStr || '').toString().trim();
  s = s.replace(/\bpro\s*max\b/gi, 'Pro Max');
  s = s.replace(/\bpromax\b/gi, 'Pro Max');
  s = s.replace(/\bpro\b/gi, 'Pro');
  s = s.replace(/\bplus\b/gi, 'Plus');
  s = s.replace(/\bmini\b/gi, 'Mini');
  s = s.replace(/\s*\+\s*/g, ' Plus ');
  s = s.replace(/\biphone\b/gi, 'iPhone');
  s = s.replace(/\s+/g, ' ').trim();
  if (/iphone 15 pro max/i.test(s) && /128/i.test(capacity)) {
    s = 'iPhone 15 Pro';
  }
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  console.log('====================================================');
  console.log('  SKYGUARD - DEVICE DEDUPLICATION & CLEANUP TOOL');
  console.log('====================================================');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (Simulasi Tanpa Ubah Database)' : '⚡ APPLY (Eksekusi Nyata ke MongoDB)'}`);
  console.log(`Waktu: ${new Date().toISOString()}`);
  console.log('----------------------------------------------------\n');

  if (!process.env.MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI tidak ditemukan di file .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
    console.log('✅ Berhasil terhubung ke MongoDB\n');

    // 1. Ambil semua device beserta price_references
    console.log('Memindai database devices...');
    const allDevices = await Device.find().lean();
    const allPrices = await PriceReference.find().lean();
    console.log(`Total data terdaftar: ${allDevices.length} devices, ${allPrices.length} price references.\n`);

    // Grouping prices by device_id
    const priceMap = {};
    allPrices.forEach(p => {
      const dId = p.device_id?.toString();
      if (dId) {
        if (!priceMap[dId]) priceMap[dId] = [];
        priceMap[dId].push(p);
      }
    });

    // Grouping devices by normalized brand + model + capacity
    const groups = {};
    allDevices.forEach(d => {
      const key = `${normalizeKey(d.brand)}:::${normalizeModel(d.model, d.capacity)}:::${normalizeCapacity(d.capacity)}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          brand: d.brand,
          model: canonicalModel(d.model, d.capacity),
          capacity: d.capacity,
          items: []
        };
      }
      const prices = (priceMap[d._id.toString()] || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      groups[key].items.push({
        ...d,
        prices,
        latestPrice: prices.find(p => p.is_latest) || prices[0] || null
      });
    });

    // Filter duplicate groups
    const duplicateGroups = Object.values(groups).filter(g => g.items.length > 1);

    if (duplicateGroups.length === 0) {
      console.log('🎉 Selamat! Tidak ditemukan data device duplikat. Database sudah bersih.');
      await mongoose.disconnect();
      return;
    }

    console.log(`⚠️  DITEMUKAN ${duplicateGroups.length} GRUP PERANGKAT DUPLIKAT:\n`);

    let totalExcess = 0;
    duplicateGroups.forEach((g, idx) => {
      totalExcess += (g.items.length - 1);
      console.log(`[${idx + 1}] ${g.brand} ${g.model} (${g.capacity}) - Terdaftar ${g.items.length} entitas:`);
      g.items.forEach((item, itemIdx) => {
        const priceStr = item.latestPrice ? `$${item.latestPrice.price_usd} (Rp ${Number(item.latestPrice.tax_idr || 0).toLocaleString()})` : 'Tanpa Harga';
        console.log(`    ${itemIdx === 0 ? '👑 [MASTER Candidate]' : '❌ [DUPLIKAT]'} ID: ${item._id} | Harga: ${priceStr} | ${item.prices.length} riwayat harga | Dibuat: ${new Date(item.created_at).toLocaleDateString('id-ID')}`);
      });
      console.log('');
    });

    console.log(`Ringkasan: ${duplicateGroups.length} grup duplikat, total ${totalExcess} entitas redundan.`);

    if (isDryRun) {
      console.log('\n💡 CATATAN: Ini adalah DRY-RUN. Tidak ada data yang diubah di database.');
      console.log('Untuk mengeksekusi pembersihan nyata, jalankan:');
      console.log('  node scripts/deduplicate_devices.js --apply\n');
      await mongoose.disconnect();
      return;
    }

    // Eksekusi nyata (--apply)
    // 1. Buat Backup JSON terlebih dahulu
    const backupDir = path.join(__dirname, '../backup_dedup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilePath = path.join(backupDir, `backup_devices_before_dedup_${timestamp}.json`);
    fs.writeFileSync(backupFilePath, JSON.stringify({ devices: allDevices, prices: allPrices }, null, 2));
    console.log(`\n💾 Backup tersimpan di: ${backupFilePath}`);

    let cleanedGroups = 0;
    let deletedDevicesCount = 0;
    let reassignedPricesCount = 0;

    for (const g of duplicateGroups) {
      // Urutkan untuk memilih master (yang memiliki update harga terbaru)
      g.items.sort((a, b) => {
        const timeA = a.latestPrice?.created_at ? new Date(a.latestPrice.created_at).getTime() : new Date(a.created_at).getTime();
        const timeB = b.latestPrice?.created_at ? new Date(b.latestPrice.created_at).getTime() : new Date(b.created_at).getTime();
        return timeB - timeA;
      });

      const master = g.items[0];
      const duplicates = g.items.slice(1);
      const duplicateIds = duplicates.map(d => d._id);

      // Reassign semua price_references dari duplikat ke master
      const updateResult = await PriceReference.updateMany(
        { device_id: { $in: duplicateIds } },
        { $set: { device_id: master._id } }
      );
      reassignedPricesCount += (updateResult.modifiedCount || 0);

      // Pastikan harga terbaru berstatus is_latest: true
      const allMasterPrices = await PriceReference.find({ device_id: master._id }).sort({ created_at: -1 });
      if (allMasterPrices.length > 0) {
        await PriceReference.updateMany({ device_id: master._id }, { $set: { is_latest: false } });
        await PriceReference.findByIdAndUpdate(allMasterPrices[0]._id, { $set: { is_latest: true } });
      }

      // Pastikan master model memiliki penamaan standar kanonikal (misal: iPhone 13 Pro Max)
      const cleanModel = canonicalModel(master.model);
      await Device.findByIdAndUpdate(master._id, { $set: { model: cleanModel } });

      // Hapus entitas Device duplikat
      const deleteResult = await Device.deleteMany({ _id: { $in: duplicateIds } });
      deletedDevicesCount += (deleteResult.deletedCount || 0);
      cleanedGroups++;

      console.log(`  ✅ Dibersihkan: ${master.brand} ${cleanModel} (${master.capacity}) -> Master ID: ${master._id} (Dihapus: ${duplicates.length} duplikat)`);
    }

    console.log('\n====================================================');
    console.log('  HASIL PEMBERSIHAN DUPLIKAT:');
    console.log('====================================================');
    console.log(`  Grup duplikat diproses : ${cleanedGroups}`);
    console.log(`  Device ganda dihapus   : ${deletedDevicesCount}`);
    console.log(`  Riwayat harga diamankan: ${reassignedPricesCount}`);
    console.log('====================================================\n');

    await mongoose.disconnect();
    console.log('Selesai.');
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat memproses deduplikasi:', err);
    process.exit(1);
  }
}

main();
