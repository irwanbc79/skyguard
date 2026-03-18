/**
 * ============================================================
 *  SKYGUARD PRICE INTELLIGENCE — Smart Reference for Officers
 * ============================================================
 *  Solusi untuk petugas yang menemukan HP tanpa harga referensi.
 *  Menggunakan data real transaksi ImeiDetail 1:496 records
 *  untuk generate harga referensi cerdas.
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const ImeiDetail = require("../models/ImeiDetail");
const Device = require("../models/Device");
const PriceReference = require("../models/PriceReference");

// ==========================================
// 1. SMART LOOKUP — Cari harga berdasarkan brand/model/storage
//    Ketika petugas menemukan HP tanpa referensi, cari di data real
// ==========================================
router.get("/lookup", async (req, res) => {
  try {
    const { brand, model, storage } = req.query;
    if (!brand && !model)
      return res
        .status(400)
        .json({ success: false, error: "Brand atau model diperlukan" });

    const query = {};
    if (brand)
      query.merk = {
        $regex: brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    if (model)
      query.tipe = {
        $regex: model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    if (storage) {
      const storageNum = parseInt(storage);
      if (storageNum) query.storage_normalized = storageNum;
    }

    // Get all matching transactions
    const transactions = await ImeiDetail.find(query)
      .sort({ waktu_kedatangan: -1 })
      .limit(200)
      .lean();

    if (!transactions.length) {
      // Try fuzzy match — search with just brand
      const fuzzyQuery = {};
      if (brand)
        fuzzyQuery.merk = {
          $regex: brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };

      const similar = await ImeiDetail.aggregate([
        { $match: fuzzyQuery },
        {
          $group: {
            _id: { merk: "$merk", tipe: "$tipe", storage: "$storage" },
            avgFob: { $avg: "$harga_fob_usd" },
            minFob: { $min: "$harga_fob_usd" },
            maxFob: { $max: "$harga_fob_usd" },
            count: { $sum: 1 },
            conditions: { $addToSet: "$bekas" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]);

      return res.json({
        success: true,
        exactMatch: false,
        message: "Tidak ditemukan kecocokan persis, berikut model serupa",
        suggestions: similar.map((s) => ({
          merk: s._id.merk,
          tipe: s._id.tipe,
          storage: s._id.storage,
          avgFob: Math.round(s.avgFob * 100) / 100,
          minFob: s.minFob,
          maxFob: s.maxFob,
          sampleCount: s.count,
          conditions: s.conditions,
        })),
      });
    }

    // Calculate price statistics
    const prices = transactions
      .map((t) => t.harga_fob_usd)
      .filter((p) => p > 0);
    prices.sort((a, b) => a - b);
    const median =
      prices.length % 2 === 0
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)];

    const avgFob = prices.reduce((a, b) => a + b, 0) / (prices.length || 1);

    // Group by condition (baru/bekas)
    const conditionStats = {};
    transactions.forEach((t) => {
      const cond = t.bekas ? "BEKAS" : "BARU";
      if (!conditionStats[cond])
        conditionStats[cond] = { prices: [], count: 0 };
      conditionStats[cond].count++;
      if (t.harga_fob_usd > 0)
        conditionStats[cond].prices.push(t.harga_fob_usd);
    });
    Object.keys(conditionStats).forEach((k) => {
      const cp = conditionStats[k].prices;
      conditionStats[k].avg = cp.length
        ? Math.round((cp.reduce((a, b) => a + b, 0) / cp.length) * 100) / 100
        : 0;
      conditionStats[k].min = cp.length ? Math.min(...cp) : 0;
      conditionStats[k].max = cp.length ? Math.max(...cp) : 0;
      delete conditionStats[k].prices;
    });

    // Storage variants found
    const storageVariants = {};
    transactions.forEach((t) => {
      const key = t.storage || "Unknown";
      if (!storageVariants[key])
        storageVariants[key] = { prices: [], count: 0 };
      storageVariants[key].count++;
      if (t.harga_fob_usd > 0)
        storageVariants[key].prices.push(t.harga_fob_usd);
    });
    const storageBreakdown = Object.entries(storageVariants).map(([k, v]) => ({
      storage: k,
      count: v.count,
      avgFob: v.prices.length
        ? Math.round(
            (v.prices.reduce((a, b) => a + b, 0) / v.prices.length) * 100,
          ) / 100
        : 0,
      minFob: v.prices.length ? Math.min(...v.prices) : 0,
      maxFob: v.prices.length ? Math.max(...v.prices) : 0,
    }));

    // Payment breakdown
    const paymentBreak = {};
    transactions.forEach((t) => {
      const p = t.cara_pembayaran || "UNKNOWN";
      if (!paymentBreak[p]) paymentBreak[p] = 0;
      paymentBreak[p]++;
    });

    // Recommended price (weighted: most recent + median)
    const recentPrices = transactions
      .slice(0, 10)
      .map((t) => t.harga_fob_usd)
      .filter((p) => p > 0);
    const recentAvg = recentPrices.length
      ? recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
      : avgFob;
    const recommendedPrice =
      Math.round((recentAvg * 0.4 + median * 0.4 + avgFob * 0.2) * 100) / 100;

    // Tax estimation at recommended price
    const ndpbm = transactions[0]?.ndpbm || 16300;
    const taxEstimate = calculateTax(recommendedPrice, ndpbm);

    // Check if exists in manual reference DB
    const existingRef = await Device.findOne({
      brand: {
        $regex: `^${(brand || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
      model: {
        $regex: (model || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      },
    }).lean();

    let manualRefPrice = null;
    if (existingRef) {
      const refPrice = await PriceReference.findOne({
        device_id: existingRef._id,
        is_latest: true,
      }).lean();
      if (refPrice)
        manualRefPrice = {
          price_usd: refPrice.price_usd,
          source: refPrice.source,
          date: refPrice.created_at,
        };
    }

    // Recent examples
    const recentExamples = transactions.slice(0, 5).map((t) => ({
      nama: t.nama,
      flight: t.flight_voyage,
      tanggal: t.waktu_kedatangan,
      fob_usd: t.harga_fob_usd,
      storage: t.storage,
      kondisi: t.bekas ? "Bekas" : "Baru",
      pembayaran: t.cara_pembayaran,
      kantor: t.kode_kantor,
    }));

    res.json({
      success: true,
      exactMatch: true,
      query: { brand, model, storage },
      priceIntel: {
        sampleCount: transactions.length,
        priceRange: {
          min: Math.min(...prices),
          max: Math.max(...prices),
          avg: Math.round(avgFob * 100) / 100,
          median: Math.round(median * 100) / 100,
        },
        recommendedPrice,
        conditionStats,
        storageBreakdown,
        paymentBreakdown: paymentBreak,
      },
      taxEstimate,
      manualRefPrice,
      hasManualRef: !!manualRefPrice,
      recentExamples,
    });
  } catch (e) {
    console.error("[Price Intel Lookup]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 2. AUTO-SUGGEST — Search-as-you-type for brand/model
// ==========================================
router.get("/suggest", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, suggestions: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const results = await ImeiDetail.aggregate([
      {
        $match: {
          $or: [
            { merk: { $regex: escaped, $options: "i" } },
            { tipe: { $regex: escaped, $options: "i" } },
          ],
        },
      },
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe", storage: "$storage" },
          avgFob: { $avg: "$harga_fob_usd" },
          count: { $sum: 1 },
          lastSeen: { $max: "$waktu_kedatangan" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    res.json({
      success: true,
      suggestions: results.map((r) => ({
        merk: r._id.merk,
        tipe: r._id.tipe,
        storage: r._id.storage,
        avgFob: Math.round(r.avgFob * 100) / 100,
        count: r.count,
        lastSeen: r.lastSeen,
        label: `${r._id.merk} ${r._id.tipe} ${r._id.storage || ""} — $${Math.round(r.avgFob)} (${r.count}x)`,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 3. COVERAGE ANALYSIS — Devices mana yang sudah/belum ada referensi
// ==========================================
router.get("/coverage", async (req, res) => {
  try {
    // All unique device models from real transaction data
    const realDevices = await ImeiDetail.aggregate([
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe" },
          storageVariants: { $addToSet: "$storage" },
          avgFob: { $avg: "$harga_fob_usd" },
          minFob: { $min: "$harga_fob_usd" },
          maxFob: { $max: "$harga_fob_usd" },
          count: { $sum: 1 },
          lastSeen: { $max: "$waktu_kedatangan" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // All devices in manual reference DB
    const refDevices = await Device.aggregate([
      {
        $lookup: {
          from: "price_references",
          let: { devId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$device_id", "$$devId"] },
                    { $eq: ["$is_latest", true] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "price",
        },
      },
      { $unwind: { path: "$price", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          brand: 1,
          model: 1,
          capacity: 1,
          hasPrice: { $cond: [{ $gt: ["$price.price_usd", 0] }, true, false] },
          price_usd: "$price.price_usd",
        },
      },
    ]);

    // Cross-reference: which real devices have manual refs?
    const refSet = new Set(
      refDevices.map((r) => `${r.brand}|||${r.model}`.toUpperCase()),
    );

    const covered = [];
    const notCovered = [];

    realDevices.forEach((rd) => {
      const key = `${rd._id.merk}|||${rd._id.tipe}`.toUpperCase();
      const entry = {
        merk: rd._id.merk,
        tipe: rd._id.tipe,
        storageVariants: rd.storageVariants,
        avgFob: Math.round(rd.avgFob * 100) / 100,
        minFob: rd.minFob,
        maxFob: rd.maxFob,
        sampleCount: rd.count,
        lastSeen: rd.lastSeen,
      };
      if (refSet.has(key)) {
        covered.push(entry);
      } else {
        notCovered.push(entry);
      }
    });

    // Ref devices not seen in real data
    const realSet = new Set(
      realDevices.map((r) => `${r._id.merk}|||${r._id.tipe}`.toUpperCase()),
    );
    const refOnly = refDevices.filter(
      (r) => !realSet.has(`${r.brand}|||${r.model}`.toUpperCase()),
    );

    res.json({
      success: true,
      summary: {
        totalRealModels: realDevices.length,
        totalRefModels: refDevices.length,
        coveredModels: covered.length,
        notCoveredModels: notCovered.length,
        refOnlyModels: refOnly.length,
        coveragePercent: realDevices.length
          ? Math.round((covered.length / realDevices.length) * 100)
          : 0,
      },
      covered,
      notCovered: notCovered.sort((a, b) => b.sampleCount - a.sampleCount),
      refOnly: refOnly.map((r) => ({
        brand: r.brand,
        model: r.model,
        capacity: r.capacity,
        hasPrice: r.hasPrice,
        price_usd: r.price_usd,
      })),
    });
  } catch (e) {
    console.error("[Price Intel Coverage]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 4. QUICK TAX CALCULATOR — Input FOB → get full tax breakdown
// ==========================================
router.get("/calc-tax", async (req, res) => {
  try {
    const fobUsd = parseFloat(req.query.fob) || 0;
    const qty = parseInt(req.query.qty) || 1;
    const bekas = req.query.bekas === "true" || req.query.bekas === "1";

    // Get latest NDPBM from ImeiDetail
    const latestNdpbm = await ImeiDetail.findOne({ ndpbm: { $gt: 0 } })
      .sort({ waktu_kedatangan: -1 })
      .select("ndpbm")
      .lean();
    const ndpbm = parseFloat(req.query.ndpbm) || latestNdpbm?.ndpbm || 16300;

    const result = calculateTax(fobUsd, ndpbm, qty, bekas);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 5. SYNC TO REFERENCE — Auto-populasi harga referensi dari data real
// ==========================================
router.post("/sync-references", async (req, res) => {
  try {
    const { minSamples = 3, overwrite = false } = req.body || {};

    // Aggregate real price data
    const realPrices = await ImeiDetail.aggregate([
      { $match: { harga_fob_usd: { $gt: 0 } } },
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe", storage: "$storage" },
          avgFob: { $avg: "$harga_fob_usd" },
          medianPrices: { $push: "$harga_fob_usd" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gte: minSamples } } },
      { $sort: { count: -1 } },
    ]);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const rp of realPrices) {
      const brand = rp._id.merk;
      const model = rp._id.tipe;
      const capacity = rp._id.storage || "N/A";

      // Calculate median
      const sorted = rp.medianPrices.sort((a, b) => a - b);
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

      const price = Math.round((median * 0.6 + rp.avgFob * 0.4) * 100) / 100;

      // Find or create device
      let device = await Device.findOne({
        brand: {
          $regex: `^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
        model: {
          $regex: `^${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
        capacity: {
          $regex: `^${capacity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      });

      if (!device) {
        device = await Device.create({ brand, model, capacity });
      }

      // Check existing price
      const existingPrice = await PriceReference.findOne({
        device_id: device._id,
        is_latest: true,
      });

      if (existingPrice && !overwrite) {
        skipped++;
        continue;
      }

      if (existingPrice) {
        existingPrice.is_latest = false;
        await existingPrice.save();
        updated++;
      } else {
        created++;
      }

      await PriceReference.create({
        device_id: device._id,
        price_usd: price,
        tax_idr: 0,
        source: `Auto-sync dari ${rp.count} transaksi real (median+avg)`,
        is_latest: true,
        created_by: "system_sync",
      });
    }

    res.json({
      success: true,
      message: "Sync selesai",
      stats: {
        processed: realPrices.length,
        created,
        updated,
        skipped,
        minSamplesUsed: minSamples,
      },
    });
  } catch (e) {
    console.error("[Price Intel Sync]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 6. GAPS — Model HP yang paling banyak masuk tapi TIDAK punya referensi
// ==========================================
router.get("/gaps", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // Top models from real data
    const topModels = await ImeiDetail.aggregate([
      { $match: { harga_fob_usd: { $gt: 0 } } },
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe" },
          storages: { $addToSet: "$storage" },
          avgFob: { $avg: "$harga_fob_usd" },
          minFob: { $min: "$harga_fob_usd" },
          maxFob: { $max: "$harga_fob_usd" },
          totalValue: { $sum: "$harga_fob_usd" },
          count: { $sum: 1 },
          lastSeen: { $max: "$waktu_kedatangan" },
          payments: { $push: "$cara_pembayaran" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ]);

    // Get all existing reference devices (capped to avoid memory spike)
    const allDevices = await Device.find().limit(20000).lean();
    const refSet = new Set(
      allDevices.map((d) => `${d.brand}|||${d.model}`.toUpperCase()),
    );

    const gaps = topModels
      .filter((m) => !refSet.has(`${m._id.merk}|||${m._id.tipe}`.toUpperCase()))
      .slice(0, limit)
      .map((m) => {
        const billingCount = m.payments.filter((p) => p === "BILLING").length;
        return {
          merk: m._id.merk,
          tipe: m._id.tipe,
          storages: m.storages,
          avgFob: Math.round(m.avgFob * 100) / 100,
          minFob: m.minFob,
          maxFob: m.maxFob,
          totalValue: Math.round(m.totalValue * 100) / 100,
          sampleCount: m.count,
          lastSeen: m.lastSeen,
          billingRate: Math.round((billingCount / m.count) * 100) + "%",
          priority: m.count >= 10 ? "HIGH" : m.count >= 5 ? "MEDIUM" : "LOW",
        };
      });

    res.json({
      success: true,
      totalGaps: gaps.length,
      highPriority: gaps.filter((g) => g.priority === "HIGH").length,
      mediumPriority: gaps.filter((g) => g.priority === "MEDIUM").length,
      gaps,
    });
  } catch (e) {
    console.error("[Price Intel Gaps]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 7. PRICE COMPARISON — Compare deklarasi vs referensi
//    Deteksi under/over declared value
// ==========================================
router.get("/compare", async (req, res) => {
  try {
    // Find devices where declared FOB deviates significantly from avg
    const deviations = await ImeiDetail.aggregate([
      { $match: { harga_fob_usd: { $gt: 0 } } },
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe" },
          avgFob: { $avg: "$harga_fob_usd" },
          stddev: { $stdDevPop: "$harga_fob_usd" },
          prices: {
            $push: {
              fob: "$harga_fob_usd",
              nama: "$nama",
              passport: "$no_identitas",
              flight: "$flight_voyage",
              date: "$waktu_kedatangan",
              payment: "$cara_pembayaran",
              storage: "$storage",
            },
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gte: 3 }, stddev: { $gt: 0 } } },
      { $sort: { count: -1 } },
    ]);

    const underDeclared = [];
    const overDeclared = [];

    deviations.forEach((d) => {
      const threshold = d.stddev * 1.5;
      d.prices.forEach((p) => {
        const deviation = p.fob - d.avgFob;
        if (deviation < -threshold && Math.abs(deviation) > 30) {
          underDeclared.push({
            merk: d._id.merk,
            tipe: d._id.tipe,
            declaredFob: p.fob,
            marketAvg: Math.round(d.avgFob * 100) / 100,
            deviation: Math.round(deviation * 100) / 100,
            deviationPercent: Math.round((deviation / d.avgFob) * 100) + "%",
            nama: p.nama,
            passport: p.passport,
            flight: p.flight,
            date: p.date,
            payment: p.payment,
            storage: p.storage,
            severity: Math.abs(deviation / d.avgFob) > 0.5 ? "HIGH" : "MEDIUM",
          });
        } else if (deviation > threshold && deviation > 50) {
          overDeclared.push({
            merk: d._id.merk,
            tipe: d._id.tipe,
            declaredFob: p.fob,
            marketAvg: Math.round(d.avgFob * 100) / 100,
            deviation: Math.round(deviation * 100) / 100,
            deviationPercent:
              "+" + Math.round((deviation / d.avgFob) * 100) + "%",
            nama: p.nama,
            passport: p.passport,
            flight: p.flight,
            date: p.date,
            payment: p.payment,
            storage: p.storage,
          });
        }
      });
    });

    // Sort by severity
    underDeclared.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
    overDeclared.sort((a, b) => b.deviation - a.deviation);

    res.json({
      success: true,
      summary: {
        totalUnderDeclared: underDeclared.length,
        totalOverDeclared: overDeclared.length,
        totalAnalyzed: deviations.reduce((s, d) => s + d.count, 0),
        modelsAnalyzed: deviations.length,
      },
      underDeclared: underDeclared.slice(0, 50),
      overDeclared: overDeclared.slice(0, 30),
    });
  } catch (e) {
    console.error("[Price Intel Compare]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 8. MARKET PRICE INDEX — Harga pasar per-brand per-storage
// ==========================================
router.get("/market-index", async (req, res) => {
  try {
    const index = await ImeiDetail.aggregate([
      { $match: { harga_fob_usd: { $gt: 0 } } },
      {
        $group: {
          _id: {
            merk: "$merk",
            tipe: "$tipe",
            storage: "$storage",
            bekas: "$bekas",
          },
          avgFob: { $avg: "$harga_fob_usd" },
          minFob: { $min: "$harga_fob_usd" },
          maxFob: { $max: "$harga_fob_usd" },
          count: { $sum: 1 },
          avgPungutan: { $avg: "$total_pungutan" },
          lastSeen: { $max: "$waktu_kedatangan" },
        },
      },
      { $sort: { "_id.merk": 1, "_id.tipe": 1, count: -1 } },
    ]);

    // Group by brand
    const brandIndex = {};
    index.forEach((i) => {
      const brand = i._id.merk;
      if (!brandIndex[brand]) brandIndex[brand] = [];
      brandIndex[brand].push({
        tipe: i._id.tipe,
        storage: i._id.storage,
        kondisi: i._id.bekas ? "Bekas" : "Baru",
        avgFob: Math.round(i.avgFob * 100) / 100,
        minFob: i.minFob,
        maxFob: i.maxFob,
        count: i.count,
        avgPungutan: Math.round(i.avgPungutan),
        lastSeen: i.lastSeen,
      });
    });

    res.json({
      success: true,
      totalEntries: index.length,
      brands: Object.keys(brandIndex).sort(),
      index: brandIndex,
    });
  } catch (e) {
    console.error("[Price Intel Market Index]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// 9. FIELD OFFICER QUICK CHECK — Single endpoint for officers
//    Input: just the phone brand+model text
//    Output: everything they need
// ==========================================
router.get("/officer-check", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 3)
      return res
        .status(400)
        .json({ success: false, error: "Query terlalu pendek (min 3 char)" });

    // Parse query: try to extract brand and model
    const words = q.toUpperCase().trim().split(/\s+/);
    const knownBrands = [
      "APPLE",
      "SAMSUNG",
      "OPPO",
      "VIVO",
      "XIAOMI",
      "REDMI",
      "HUAWEI",
      "REALME",
      "INFINIX",
      "HONOR",
      "IQOO",
      "ONEPLUS",
      "POCO",
      "TECNO",
      "GOOGLE",
      "NOKIA",
      "MOTOROLA",
      "ITEL",
      "MEIZU",
      "TIANYI",
      "IPHONE",
    ];

    let detectedBrand = words.find((w) => knownBrands.includes(w));
    if (detectedBrand === "IPHONE") detectedBrand = "APPLE";

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Search in real data
    const matchQuery = {
      $or: [
        { tipe: { $regex: escaped, $options: "i" } },
        { merk: { $regex: escaped, $options: "i" } },
      ],
    };

    const results = await ImeiDetail.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { merk: "$merk", tipe: "$tipe", storage: "$storage" },
          avgFob: { $avg: "$harga_fob_usd" },
          minFob: { $min: "$harga_fob_usd" },
          maxFob: { $max: "$harga_fob_usd" },
          count: { $sum: 1 },
          avgPungutan: { $avg: "$total_pungutan" },
          latestNdpbm: { $max: "$ndpbm" },
          conditions: { $addToSet: "$bekas" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]);

    if (!results.length) {
      return res.json({
        success: true,
        found: false,
        message: `Tidak ditemukan data untuk "${q}". Petugas perlu input harga manual.`,
        suggestion:
          "Gunakan fitur Input Data untuk menambah harga referensi baru",
      });
    }

    // Build officer-friendly response
    const devices = results.map((r) => {
      const ndpbm = r.latestNdpbm || 16300;
      const tax = calculateTax(r.avgFob, ndpbm);
      return {
        device: `${r._id.merk} ${r._id.tipe}`,
        storage: r._id.storage || "-",
        hargaReferensi: Math.round(r.avgFob * 100) / 100,
        range: `$${r.minFob} — $${r.maxFob}`,
        sampleCount: r.count,
        kondisi: r.conditions.includes(false) ? "Ada Baru" : "Semua Bekas",
        estimasiPajak: {
          bm: tax.bm,
          ppn: tax.ppn,
          pph: tax.pph,
          total: tax.totalPungutan,
          totalFormatted: "Rp " + tax.totalPungutan.toLocaleString("id-ID"),
        },
      };
    });

    res.json({
      success: true,
      found: true,
      query: q,
      detectedBrand,
      totalMatches: devices.length,
      devices,
    });
  } catch (e) {
    console.error("[Price Intel Officer Check]", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// HELPER: Tax Calculator
// ==========================================
function calculateTax(fobUsd, ndpbm = 16300, qty = 1, bekas = true) {
  const pembebasan = 500; // USD exemption per person
  const totalFob = fobUsd * qty;
  const kenaFob = Math.max(0, totalFob - pembebasan);
  const cifMultiplier = 1.0; // simplified
  const cifUsd = kenaFob * cifMultiplier;
  const nilaiPabean = cifUsd * ndpbm;

  // BM 10%
  const tarifBm = 0.1;
  const bm = Math.round(nilaiPabean * tarifBm);

  // PPN 11%
  const tarifPpn = 0.11;
  const ppn = Math.round((nilaiPabean + bm) * tarifPpn);

  // PPh 0% (for foreign passport) or 10% (local without NPWP) or 0.5% (local with NPWP)
  // Default: 0% for simplicity, officer can adjust
  const tarifPph = 0;
  const pph = 0;

  const totalPungutan = bm + ppn + pph;

  return {
    input: { fobUsd, ndpbm, qty, bekas },
    pembebasan,
    fobKenaPajak: kenaFob,
    cifUsd,
    nilaiPabean,
    bm,
    ppn,
    pph,
    totalPungutan,
    breakdown: {
      "FOB Total": `$${totalFob}`,
      Pembebasan: `$${pembebasan}`,
      "FOB Kena Pajak": `$${kenaFob}`,
      "Nilai Pabean": `Rp ${nilaiPabean.toLocaleString("id-ID")}`,
      "BM (10%)": `Rp ${bm.toLocaleString("id-ID")}`,
      "PPN (11%)": `Rp ${ppn.toLocaleString("id-ID")}`,
      PPh: `Rp ${pph.toLocaleString("id-ID")}`,
      TOTAL: `Rp ${totalPungutan.toLocaleString("id-ID")}`,
    },
  };
}

module.exports = router;
