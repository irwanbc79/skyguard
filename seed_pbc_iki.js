/**
 * seed_pbc_iki.js
 * Jalankan SEKALI: node seed_pbc_iki.js
 * Seed 7 IKI yang umum digunakan petugas PBC KPPBC TMP B Kualanamu 2026
 */

require("dotenv").config();
const mongoose = require("mongoose");
const PbcIkiIndicator = require("./src/models/PbcIkiIndicator");

const IKI_LIST = [
  { urutan: 1, kode: "IKI-001", nama: "Persentase kualitas layanan registrasi IMEI",                                   target: 82,  satuan: "%",      tahun: 2026 },
  { urutan: 2, kode: "IKI-002", nama: "Persentase Efektivitas Analisis Pembetulan PEB",                                 target: 100, satuan: "%",      tahun: 2026 },
  { urutan: 3, kode: "IKI-003", nama: "Persentase Ketepatan Waktu Penyelesaian Dokumen Rush Handling",                 target: 100, satuan: "%",      tahun: 2026 },
  { urutan: 4, kode: "IKI-004", nama: "Indeks rata-rata ketepatan waktu penatalayanan TPB",                            target: 3.1, satuan: "indeks", tahun: 2026 },
  { urutan: 5, kode: "IKI-005", nama: "Persentase kualitas penelitian barang kiriman",                                 target: 82,  satuan: "%",      tahun: 2026 },
  { urutan: 6, kode: "IKI-006", nama: "Indeks efektivitas Pengelolaan BTD dan BDN dan BMMN",                          target: 3.3, satuan: "indeks", tahun: 2026 },
  { urutan: 7, kode: "IKI-007", nama: "Persentase Pencapaian Target Peningkatan Kompetensi Pegawai dan Dukungan Manajemen", target: 80, satuan: "%", tahun: 2026 },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("MongoDB connected.");

  let inserted = 0, skipped = 0;
  for (const iki of IKI_LIST) {
    try {
      await PbcIkiIndicator.updateOne(
        { kode: iki.kode, tahun: iki.tahun },
        { $setOnInsert: iki },
        { upsert: true }
      );
      console.log(`  [${iki.kode}] ${iki.nama} → Target: ${iki.target} ${iki.satuan}`);
      inserted++;
    } catch (e) {
      console.warn(`  SKIP ${iki.kode}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`\nSelesai: ${inserted} IKI diproses, ${skipped} dilewati.`);
  console.log("IKI tambahan bisa ditambahkan langsung dari UI Skyguard → LAPORAN PBC → Rekap IKI.");
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
