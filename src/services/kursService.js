const https = require("https");
const cron = require("node-cron");
const { Kurs, KursMeta } = require("../models/Kurs");

// Default kurs data (digunakan jika database kosong)
const defaultKurs = [
  {
    code: "USD",
    name: "Dolar Amerika Serikat",
    flag: "https://flagcdn.com/w40/us.png",
    rate: 16777.0,
  },
  {
    code: "AUD",
    name: "Dolar Australia",
    flag: "https://flagcdn.com/w40/au.png",
    rate: 11737.86,
  },
  {
    code: "BND",
    name: "Dolar Brunei Darussalam",
    flag: "https://flagcdn.com/w40/bn.png",
    rate: 13254.7,
  },
  {
    code: "CAD",
    name: "Dolar Kanada",
    flag: "https://flagcdn.com/w40/ca.png",
    rate: 12346.38,
  },
  {
    code: "CHF",
    name: "Franc Swiss",
    flag: "https://flagcdn.com/w40/ch.png",
    rate: 21824.59,
  },
  {
    code: "CNY",
    name: "Yuan Renminbi Tiongkok",
    flag: "https://flagcdn.com/w40/cn.png",
    rate: 2432.55,
  },
  {
    code: "DKK",
    name: "Kroner Denmark",
    flag: "https://flagcdn.com/w40/dk.png",
    rate: 2682.18,
  },
  {
    code: "EUR",
    name: "Euro",
    flag: "https://flagcdn.com/w40/eu.png",
    rate: 19847.89,
  },
  {
    code: "GBP",
    name: "Poundsterling Inggris",
    flag: "https://flagcdn.com/w40/gb.png",
    rate: 23095.89,
  },
  {
    code: "HKD",
    name: "Dolar Hong Kong",
    flag: "https://flagcdn.com/w40/hk.png",
    rate: 2149.93,
  },
  {
    code: "JPY",
    name: "Yen Jepang (per 100)",
    flag: "https://flagcdn.com/w40/jp.png",
    rate: 10926.94,
  },
  {
    code: "KRW",
    name: "Won Korea Selatan (per 100)",
    flag: "https://flagcdn.com/w40/kr.png",
    rate: 1150.0,
  },
  {
    code: "MYR",
    name: "Ringgit Malaysia",
    flag: "https://flagcdn.com/w40/my.png",
    rate: 4255.29,
  },
  {
    code: "NZD",
    name: "Dolar Selandia Baru",
    flag: "https://flagcdn.com/w40/nz.png",
    rate: 10126.6,
  },
  {
    code: "SAR",
    name: "Riyal Arab Saudi",
    flag: "https://flagcdn.com/w40/sa.png",
    rate: 4472.0,
  },
  {
    code: "SGD",
    name: "Dolar Singapura",
    flag: "https://flagcdn.com/w40/sg.png",
    rate: 13254.7,
  },
  {
    code: "THB",
    name: "Baht Thailand",
    flag: "https://flagcdn.com/w40/th.png",
    rate: 498.25,
  },
  {
    code: "AED",
    name: "Dirham Uni Emirat Arab",
    flag: "https://flagcdn.com/w40/ae.png",
    rate: 4568.0,
  },
];

// Cache untuk performance
let kursCache = null;
let metaCache = null;

// Initialize database dengan default data jika kosong
async function initKurs() {
  try {
    const count = await Kurs.estimatedDocumentCount();
    if (count === 0) {
      console.log("Initializing kurs data...");
      await Kurs.insertMany(defaultKurs);
      await KursMeta.findOneAndUpdate(
        { _id: "current" },
        {
          periode: "04 Feb 2026 - 10 Feb 2026",
          kmk_number: "KMK 5/MK/EF.2/2026",
          source: "initial",
          updated_at: new Date(),
        },
        { upsert: true },
      );
      console.log("Kurs data initialized");
    }
    await refreshCache();
    startKursScheduler();
  } catch (err) {
    console.warn("[KURS] DB tidak tersedia, pakai data default:", err.message);
    kursCache = defaultKurs;
    metaCache = {
      periode: "04 Feb 2026 - 10 Feb 2026",
      kmk_number: "KMK 5/MK/EF.2/2026",
      source: "default",
      updated_at: new Date(),
    };
  }
}

// Refresh cache dari database
async function refreshCache() {
  try {
    kursCache = await Kurs.find().lean();
    metaCache = await KursMeta.findById("current").lean();
  } catch (err) {
    console.warn(
      "[KURS] Refresh cache gagal, tetap pakai cache sebelumnya:",
      err.message,
    );
    if (!kursCache) kursCache = defaultKurs;
  }
}

// Get all kurs
async function getAllKurs() {
  if (!kursCache) await refreshCache();
  return {
    updated_at: metaCache?.updated_at || new Date(),
    periode: metaCache?.periode || "-",
    kmk_number: metaCache?.kmk_number || "-",
    source: metaCache?.source || "database",
    currencies: kursCache || defaultKurs,
  };
}

// Get single kurs
async function getKurs(code = "USD") {
  if (!kursCache) await refreshCache();
  const currency = kursCache?.find((c) => c.code === code);
  if (!currency) return null;
  return {
    ...currency,
    updated_at: metaCache?.updated_at,
    source: metaCache?.source,
  };
}

// Set single kurs
async function setKurs(code, rate) {
  try {
    await Kurs.findOneAndUpdate(
      { code },
      { rate, updated_at: new Date() },
      { upsert: true },
    );
    await KursMeta.findOneAndUpdate(
      { _id: "current" },
      { source: "manual", updated_at: new Date() },
    );
    await refreshCache();
    return await getAllKurs();
  } catch (err) {
    console.error("Set kurs error:", err);
    return null;
  }
}

// Scrape kurs dari Kemenkeu - full parsing
async function scrapeKurs() {
  console.log("[KURS] Scraping kurs from fiskal.kemenkeu.go.id...");

  const html = await new Promise((resolve, reject) => {
    const options = {
      hostname: "fiskal.kemenkeu.go.id",
      path: "/informasi-publik/kurs-pajak",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 20000,
    };

    const req = https.get(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });

  try {
    // Extract periode: "25 Februari 2026 - 03 Maret 2026"
    const periodeMatch = html.match(
      /(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4})\s*-\s*(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4})/i,
    );

    // Extract KMK number
    const kmkMatch = html.match(/KMK\s+Nomor\s+([\d]+\/MK[^<"]+)/i);

    // Map Indonesian month to short English for display
    const monthMap = {
      Januari: "Jan",
      Februari: "Feb",
      Maret: "Mar",
      April: "Apr",
      Mei: "May",
      Juni: "Jun",
      Juli: "Jul",
      Agustus: "Aug",
      September: "Sep",
      Oktober: "Oct",
      November: "Nov",
      Desember: "Dec",
    };

    const convertDate = (dateStr) => {
      if (!dateStr) return dateStr;
      return dateStr.replace(
        /(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)/gi,
        (m) => monthMap[m] || m,
      );
    };

    let periode = null;
    if (periodeMatch) {
      periode =
        convertDate(periodeMatch[1]) + " - " + convertDate(periodeMatch[2]);
    }

    const kmkNumber = kmkMatch ? kmkMatch[1].trim() : null;

    // Flag mapping for currencies
    const flagMap = {
      USD: "us",
      AUD: "au",
      CAD: "ca",
      DKK: "dk",
      HKD: "hk",
      MYR: "my",
      NZD: "nz",
      NOK: "no",
      GBP: "gb",
      SGD: "sg",
      SEK: "se",
      CHF: "ch",
      JPY: "jp",
      MMK: "mm",
      INR: "in",
      KWD: "kw",
      PKR: "pk",
      PHP: "ph",
      SAR: "sa",
      LKR: "lk",
      THB: "th",
      BND: "bn",
      EUR: "eu",
      CNY: "cn",
      KRW: "kr",
      AED: "ae",
    };

    // Parse table rows: extract currency name, code, and rate
    const currencies = [];
    const rowRegex = /<tr\s+class="table-bordered">([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];

      // Extract currency name: <span class='hidden-xs'>Dolar Amerika Serikat (USD)</span>
      const nameMatch = row.match(/hidden-xs[^>]*>([^<]+)\((\w{3})\)/);
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      const code = nameMatch[2].trim();

      // Extract rate: <div class="m-l-5">16.898,00</div>
      const rateMatch = row.match(/m-l-5[^>]*>([\d.,]+)/);
      if (!rateMatch) continue;

      // Parse Indonesian number format: "16.898,00" → 16898.00
      const rate = parseFloat(
        rateMatch[1].replace(/\./g, "").replace(",", "."),
      );
      if (isNaN(rate) || rate <= 0) continue;

      const flag = flagMap[code]
        ? `https://flagcdn.com/w40/${flagMap[code]}.png`
        : null;

      // Special naming for per-100 currencies
      let displayName = `${name}(${code})`;
      if (code === "JPY") displayName = "Yen Jepang (per 100)";
      else if (code === "KRW") displayName = "Won Korea Selatan (per 100)";
      else displayName = `${name}(${code})`;

      currencies.push({ code, name: displayName, rate, flag });
    }

    console.log(`[KURS] Parsed ${currencies.length} currencies from Kemenkeu`);
    console.log(`[KURS] Periode: ${periode || "not found"}`);
    console.log(`[KURS] KMK: ${kmkNumber || "not found"}`);

    if (currencies.length >= 10) {
      // Bulk update all currencies
      const ops = currencies.map((c) => ({
        updateOne: {
          filter: { code: c.code },
          update: {
            $set: {
              rate: c.rate,
              name: c.name,
              flag: c.flag,
              updated_at: new Date(),
            },
          },
          upsert: true,
        },
      }));
      await Kurs.bulkWrite(ops);

      // Update meta
      const metaUpdate = {
        source: "auto-scrape",
        updated_at: new Date(),
        updated_by: "auto-scheduler",
      };
      if (periode) metaUpdate.periode = periode;
      if (kmkNumber) metaUpdate.kmk_number = kmkNumber;
      await KursMeta.findOneAndUpdate({ _id: "current" }, metaUpdate, {
        upsert: true,
      });

      await refreshCache();

      const usd = currencies.find((c) => c.code === "USD");
      console.log(
        `[KURS] Successfully updated ${currencies.length} currencies. USD: ${usd?.rate || "-"}`,
      );
    } else {
      console.warn(
        `[KURS] Only found ${currencies.length} currencies, skipping update (minimum 10 required)`,
      );
    }
  } catch (e) {
    console.error("[KURS] Scrape parse error:", e.message);
  }

  return getAllKurs();
}

// Hitung pajak
async function hitungPajak(fobUsd, jumlahUnit = 1, currency = "USD") {
  if (!kursCache) await refreshCache();

  const BEBAS_BEA = 500,
    TARIF_BM = 0.1,
    TARIF_PPN = 0.11;
  const kursData = kursCache?.find((c) => c.code === currency);
  const kurs = kursData?.rate || 16777;

  const kenaFob = Math.max(0, fobUsd - BEBAS_BEA);
  const nilaiPabean = kenaFob * kurs;
  const bm = nilaiPabean * TARIF_BM;
  const ppn = (nilaiPabean + bm) * TARIF_PPN;

  return {
    input: { fob_usd: fobUsd, jumlah_unit: jumlahUnit, currency },
    kurs: { rate: kurs, source: metaCache?.source || "database" },
    perhitungan: {
      pembebasan_usd: BEBAS_BEA,
      kena_pajak_usd: kenaFob,
      nilai_pabean_idr: Math.round(nilaiPabean),
      bm_persen: "10%",
      bm_idr: Math.round(bm),
      ppn_persen: "11%",
      ppn_idr: Math.round(ppn),
      total_pajak_idr: Math.round(bm + ppn),
    },
    catatan: jumlahUnit > 2 ? "PERINGATAN: Maksimal 2 IMEI per paspor!" : null,
  };
}

// Scheduler: Auto scrape kurs setiap Rabu jam 07:00, 08:00 & 09:00 WIB
function startKursScheduler() {
  // Run at 07:00, 08:00, 09:00 WIB on Wednesday to ensure we catch the latest published rate
  cron.schedule(
    "0 7,8,9 * * 3",
    async () => {
      const now = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
      });
      console.log(`[KURS] Running scheduled scrape at ${now}...`);
      try {
        await scrapeKurs();
      } catch (err) {
        console.error("[KURS] Scheduled scrape failed:", err.message);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
  console.log(
    "[KURS] Scheduler initialized - Auto scrape every Wednesday 07:00, 08:00 & 09:00 WIB",
  );
}

// Bulk update kurs with bulkWrite
async function bulkUpdateKurs(
  kursArray,
  periode,
  kmkNumber,
  updatedBy = "admin",
) {
  try {
    const ops = kursArray.map((k) => ({
      updateOne: {
        filter: { code: k.code },
        update: {
          $set: {
            rate: k.rate,
            name: k.name || undefined,
            updated_at: new Date(),
          },
        },
        upsert: true,
      },
    }));
    await Kurs.bulkWrite(ops);
    await KursMeta.findOneAndUpdate(
      { _id: "current" },
      {
        periode,
        kmk_number: kmkNumber,
        source: "admin",
        updated_at: new Date(),
        updated_by: updatedBy,
      },
      { upsert: true },
    );
    await refreshCache();
    return { status: "ok", message: `${kursArray.length} kurs updated` };
  } catch (err) {
    console.error("Bulk update error:", err);
    return { status: "error", message: err.message };
  }
}

module.exports = {
  initKurs,
  getAllKurs,
  getKurs,
  setKurs,
  bulkUpdateKurs,
  scrapeKurs,
  hitungPajak,
  startKursScheduler,
  refreshCache,
};
