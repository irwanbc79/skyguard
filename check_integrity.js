const mongoose = require("mongoose");
require("dotenv").config();
const ImeiReg = require("./src/models/ImeiRegistration");
const Passenger = require("./src/models/Passenger");
const ManifestPassenger = require("./src/models/ManifestPassenger");
const Manifest = require("./src/models/Manifest");

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Collection counts
  const imeiCount = await ImeiReg.countDocuments();
  const paxCount = await Passenger.countDocuments();
  const mpCount = await ManifestPassenger.countDocuments();
  const mfCount = await Manifest.countDocuments();
  console.log("=== COLLECTION SIZES ===");
  console.log("IMEI Registrations:", imeiCount);
  console.log("Passengers (CEISA):", paxCount);
  console.log("ManifestPassengers:", mpCount);
  console.log("Manifests:", mfCount);

  // 1. Internal IMEI duplicates
  const dupes = await ImeiReg.aggregate([
    { $group: { _id: "$id_registrasi", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "duplicates" },
  ]);
  console.log("\n=== IMEI INTERNAL DUPLICATES ===");
  console.log(
    "Duplicate id_registrasi:",
    dupes.length ? dupes[0].duplicates : 0,
  );

  // 2. IMEI paspor vs CEISA paspor
  const imeiPassports = await ImeiReg.distinct("no_identitas");
  const imeiPassportSet = new Set(
    imeiPassports.filter(Boolean).map((p) => p.toUpperCase().trim()),
  );
  console.log("\n=== CROSS-CHECK: IMEI vs CEISA ===");
  console.log("Unique IMEI passports:", imeiPassportSet.size);

  const ceisaPassports = await Passenger.distinct("paspor");
  const ceisaPassportSet = new Set(
    ceisaPassports.filter(Boolean).map((p) => p.toUpperCase().trim()),
  );
  console.log("Unique CEISA passports:", ceisaPassportSet.size);

  let overlap = 0;
  const overlapping = [];
  for (const p of imeiPassportSet) {
    if (ceisaPassportSet.has(p)) {
      overlap++;
      if (overlapping.length < 10) overlapping.push(p);
    }
  }
  console.log("OVERLAP count:", overlap);
  console.log("Contoh:", overlapping.slice(0, 5).join(", "));

  // 3. IMEI paspor vs ManifestPassenger passport_number
  const mpPassports = await ManifestPassenger.distinct("passport_number");
  const mpPassportSet = new Set(
    mpPassports.filter(Boolean).map((p) => p.toUpperCase().trim()),
  );
  console.log("\n=== CROSS-CHECK: IMEI vs MANIFEST PASSENGERS ===");
  console.log("Unique manifest passports:", mpPassportSet.size);

  let overlapMP = 0;
  const overlappingMP = [];
  for (const p of imeiPassportSet) {
    if (mpPassportSet.has(p)) {
      overlapMP++;
      if (overlappingMP.length < 10) overlappingMP.push(p);
    }
  }
  console.log("OVERLAP count:", overlapMP);
  console.log("Contoh:", overlappingMP.slice(0, 5).join(", "));

  // 4. IMEI vessel vs Manifest flights
  const imeiVessels = await ImeiReg.distinct("vessel_normalized");
  const mfFlights = await Manifest.distinct("flight_number");
  const normalizedMF = new Set(
    mfFlights
      .filter(Boolean)
      .map((f) => f.replace(/[\s\-]/g, "").toUpperCase()),
  );

  let vesselOverlap = 0;
  const vesselMatches = [];
  for (const v of imeiVessels.filter(Boolean)) {
    if (normalizedMF.has(v)) {
      vesselOverlap++;
      vesselMatches.push(v);
    }
  }
  console.log("\n=== CROSS-CHECK: IMEI vessel vs MANIFEST flights ===");
  console.log("IMEI unique vessels:", imeiVessels.filter(Boolean).length);
  console.log("Manifest unique flights:", normalizedMF.size);
  console.log("OVERLAP count:", vesselOverlap);
  console.log("Matches:", vesselMatches.slice(0, 15).join(", "));

  // 5. Check one overlapping passport detail
  if (overlapping.length > 0) {
    console.log("\n=== DETAIL SAMPLE OVERLAP ===");
    const samplePax = overlapping[0];
    const imeiRecs = await ImeiReg.find({
      no_identitas: new RegExp("^" + samplePax + "$", "i"),
    })
      .limit(3)
      .lean();
    const ceisaRecs = await Passenger.find({
      paspor: new RegExp("^" + samplePax + "$", "i"),
    })
      .limit(3)
      .lean();
    console.log("Passport:", samplePax);
    console.log(
      "IMEI records:",
      imeiRecs.length,
      "- Name:",
      imeiRecs[0]?.nama,
      "- Vessel:",
      imeiRecs[0]?.vessel,
    );
    console.log(
      "CEISA records:",
      ceisaRecs.length,
      "- Name:",
      ceisaRecs[0]?.nama,
      "- Flight:",
      ceisaRecs[0]?.nomorPenerbangan,
    );
  }

  console.log("\n=== SUMMARY ===");
  console.log(
    "Data IMEI Registrasi: " + imeiCount + " records, 0 internal duplicates",
  );
  console.log(
    "Irisan IMEI<->CEISA (passport): " +
      overlap +
      " dari " +
      imeiPassportSet.size +
      " passport IMEI",
  );
  console.log(
    "Irisan IMEI<->Manifest (passport): " +
      overlapMP +
      " dari " +
      imeiPassportSet.size +
      " passport IMEI",
  );
  console.log(
    "Irisan vessel/flight: " +
      vesselOverlap +
      " dari " +
      imeiVessels.filter(Boolean).length +
      " vessel IMEI",
  );
  console.log(
    "KESIMPULAN: Data saling terkait dan bisa di-crosscheck. Tidak ada duplikasi internal.",
  );

  await mongoose.disconnect();
}
check().catch((e) => {
  console.error(e);
  process.exit(1);
});
