/**
 * Buat semua index yang didefinisikan di schema Mongoose tapi belum ada di MongoDB.
 *
 * Latar belakang: app.js connect dengan `autoIndex: false`, sehingga index yang
 * dideklarasikan di src/models/*.js TIDAK pernah dibuat otomatis. Akibatnya
 * beberapa koleksi (activity_logs, pbc_schedule_records, manifests) berjalan
 * tanpa index — termasuk TTL index activity_logs (retensi 90 hari) yang tidak
 * pernah aktif.
 *
 * Aman dijalankan berulang: hanya createIndexes (tidak pernah drop index).
 * Jalankan di server saat traffic rendah:
 *   cd /root/skyguard && node scripts/sync_indexes.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MODELS_DIR = path.join(__dirname, "../src/models");

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI tidak di-set");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  console.log("Terhubung ke MongoDB\n");

  const files = fs
    .readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith(".js") && !f.includes(".bak"));

  let ok = 0;
  let fail = 0;
  for (const file of files) {
    const model = require(path.join(MODELS_DIR, file));
    if (!model || !model.createIndexes) continue;
    const started = Date.now();
    try {
      await model.createIndexes();
      const idx = await model.collection.indexes();
      console.log(
        `✓ ${model.collection.collectionName} (${Date.now() - started}ms) — ${idx.length} index: ${idx.map((i) => i.name).join(", ")}`,
      );
      ok++;
    } catch (err) {
      console.error(`✗ ${file}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nSelesai: ${ok} model OK, ${fail} gagal`);
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
