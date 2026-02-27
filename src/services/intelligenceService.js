/**
 * ============================================================
 *  SKYGUARD INTELLIGENCE RADAR ENGINE
 *  Global cross-reference & anomaly detection across
 *  Manifest Passengers, CEISA Records, and Watchlist
 * ============================================================
 */
const ManifestPassenger = require("../models/ManifestPassenger");
const Manifest = require("../models/Manifest");
const Passenger = require("../models/Passenger");
const Suspect = require("../models/Suspect");

// ──────────────────────────────────────
//  1. RADAR OVERVIEW — Main dashboard
// ──────────────────────────────────────
async function getRadarOverview() {
  const [
    totalManifestPax,
    withPassport,
    withoutPassport,
    totalCeisa,
    totalManifests,
    manifestsWithPax,
    totalSuspects,
    activeSuspects,
    uniqueManifestAgg,
    uniqueCeisaAgg,
    crossMatchedAgg,
  ] = await Promise.all([
    ManifestPassenger.countDocuments({}),
    ManifestPassenger.countDocuments({
      passport_number: { $exists: true, $nin: [null, ""] },
    }),
    ManifestPassenger.countDocuments({
      $or: [
        { passport_number: null },
        { passport_number: "" },
        { passport_number: { $exists: false } },
      ],
    }),
    Passenger.countDocuments({}),
    Manifest.countDocuments({}),
    Manifest.countDocuments({
      status: { $in: ["synced", "approved", "parsed"] },
    }),
    Suspect.countDocuments({}),
    Suspect.countDocuments({ status: { $in: ["ACTIVE", "MONITORING"] } }),
    ManifestPassenger.aggregate([
      { $match: { passport_number: { $exists: true, $nin: [null, ""] } } },
      {
        $group: { _id: { $toUpper: { $trim: { input: "$passport_number" } } } },
      },
      { $count: "total" },
    ]),
    Passenger.aggregate([
      { $match: { paspor: { $exists: true, $nin: [null, ""] } } },
      { $group: { _id: { $toUpper: { $trim: { input: "$paspor" } } } } },
      { $count: "total" },
    ]),
    ManifestPassenger.aggregate([
      { $match: { passport_number: { $exists: true, $nin: [null, ""] } } },
      {
        $group: { _id: { $toUpper: { $trim: { input: "$passport_number" } } } },
      },
      {
        $lookup: {
          from: "passengers",
          let: { passport_norm: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $toUpper: { $trim: { input: "$paspor" } } },
                    "$$passport_norm",
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "ceisa",
        },
      },
      { $match: { "ceisa.0": { $exists: true } } },
      { $count: "total" },
    ]),
  ]);

  const uniquePassportsManifest = uniqueManifestAgg[0]?.total || 0;
  const uniquePassportsCeisa = uniqueCeisaAgg[0]?.total || 0;
  const crossMatched = crossMatchedAgg[0]?.total || 0;

  const manifestOnly = uniquePassportsManifest - crossMatched;
  const ceisaOnly = uniquePassportsCeisa - crossMatched;

  // Nationality distribution from manifest passengers
  const nationalityAgg = await ManifestPassenger.aggregate([
    {
      $match: {
        nationality: { $exists: true, $nin: [null, ""] },
      },
    },
    { $group: { _id: "$nationality", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ]);

  // Airline distribution
  const airlineAgg = await ManifestPassenger.aggregate([
    {
      $match: {
        flight_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: {
          $trim: {
            input: {
              $replaceAll: {
                input: {
                  $substrCP: [
                    "$flight_number",
                    0,
                    {
                      $min: [
                        {
                          $indexOfCP: [
                            { $concat: ["$flight_number", " "] },
                            " ",
                          ],
                        },
                        {
                          $cond: [
                            { $gte: [{ $strLenCP: "$flight_number" }, 3] },
                            3,
                            { $strLenCP: "$flight_number" },
                          ],
                        },
                      ],
                    },
                  ],
                },
                find: " ",
                replacement: "",
              },
            },
          },
        },
        flights: { $addToSet: "$manifest_id" },
        passengers: { $sum: 1 },
        withPassport: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$passport_number", null] },
                  { $ne: ["$passport_number", ""] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        flights: { $size: "$flights" },
        passengers: 1,
        withPassport: 1,
      },
    },
    { $sort: { passengers: -1 } },
    { $limit: 10 },
  ]);

  // Quick anomaly counts (lightweight)
  const [frequentCount, watchlistHitCount] = await Promise.all([
    countFrequentTravelers(5),
    countWatchlistHits(),
  ]);
  const ghostCount = manifestOnly;

  return {
    overview: {
      total_manifest_passengers: totalManifestPax,
      with_passport: withPassport,
      without_passport: withoutPassport,
      total_ceisa_records: totalCeisa,
      total_manifests: totalManifests,
      manifests_with_pax: manifestsWithPax,
      unique_passports_manifest: uniquePassportsManifest,
      unique_passports_ceisa: uniquePassportsCeisa,
      cross_matched: crossMatched,
      manifest_only: manifestOnly,
      ceisa_only: ceisaOnly,
      match_rate:
        uniquePassportsManifest > 0
          ? ((crossMatched / uniquePassportsManifest) * 100).toFixed(1)
          : "0",
      total_suspects: totalSuspects,
      active_suspects: activeSuspects,
    },
    anomaly_counts: {
      ghost_passengers: ghostCount,
      frequent_travelers: frequentCount,
      watchlist_hits: watchlistHitCount,
    },
    nationality_distribution: nationalityAgg.map((n) => ({
      code: n._id,
      count: n.count,
    })),
    airline_stats: airlineAgg.map((a) => ({
      code: a._id,
      flights: a.flights,
      passengers: a.passengers,
      with_passport: a.withPassport,
    })),
  };
}

// Helper: count frequent travelers (5+ flights)
async function countFrequentTravelers(minFlights) {
  const result = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: { $trim: { input: "$passport_number" } } },
        flight_count: { $addToSet: "$manifest_id" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    { $project: { flights: { $size: "$flight_count" } } },
    { $match: { flights: { $gte: minFlights } } },
    { $count: "total" },
  ]);
  return result[0]?.total || 0;
}

// Helper: count watchlist hits
async function countWatchlistHits() {
  const suspects = await Suspect.find(
    { status: { $in: ["ACTIVE", "MONITORING"] } },
    { passport_number: 1 },
  ).lean();

  const passportNums = suspects
    .filter((s) => s.passport_number)
    .map((s) => s.passport_number.toUpperCase().trim());

  if (!passportNums.length) return 0;

  const hitsAgg = await ManifestPassenger.aggregate([
    { $match: { passport_number: { $exists: true, $nin: [null, ""] } } },
    { $group: { _id: { $toUpper: { $trim: { input: "$passport_number" } } } } },
    { $match: { _id: { $in: passportNums } } },
    { $count: "total" },
  ]);

  return hitsAgg[0]?.total || 0;
}

// ──────────────────────────────────────
//  2. GHOST PASSENGERS
//  On manifest but NEVER in CEISA
//  (No customs record = potential bypass)
// ──────────────────────────────────────
async function getGhostPassengers(page = 1, limit = 50) {
  const skip = (page - 1) * limit;

  const pipeline = [
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: { $trim: { input: "$passport_number" } } },
        name: { $first: "$name" },
        nationality: { $first: "$nationality" },
        gender: { $first: "$gender" },
        flights: { $addToSet: "$flight_number" },
        manifests: { $addToSet: "$manifest_id" },
        last_seen: { $max: "$flight_date" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    {
      $lookup: {
        from: "passengers",
        localField: "_id",
        foreignField: "paspor",
        as: "ceisa_match",
      },
    },
    {
      $match: {
        ceisa_match: { $size: 0 },
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        nationality: 1,
        gender: 1,
        flights: 1,
        flight_count: { $size: "$manifests" },
        last_seen: 1,
      },
    },
    { $sort: { flight_count: -1 } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];

  const result = await ManifestPassenger.aggregate(pipeline);
  const total = result[0]?.metadata[0]?.total || 0;
  const paginated = result[0]?.data || [];

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    data: paginated.map((g) => ({
      passport_number: g._id,
      name: g.name,
      nationality: g.nationality,
      gender: g.gender,
      flight_count: g.flight_count,
      flights: g.flights.filter(Boolean).slice(0, 10),
      last_seen: g.last_seen,
      risk_tag:
        g.flight_count >= 3 ? "HIGH" : g.flight_count >= 2 ? "MEDIUM" : "LOW",
    })),
  };
}

// ──────────────────────────────────────
//  3. NAME MISMATCHES
//  Same passport, different name between
//  manifest and CEISA (identity anomaly)
// ──────────────────────────────────────
async function getNameMismatches(page = 1, limit = 50) {
  // Get all unique passport → name from manifests
  const manifestPax = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
        name: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: { $trim: { input: "$passport_number" } } },
        manifest_names: { $addToSet: "$name" },
        nationality: { $first: "$nationality" },
        flights: { $addToSet: "$flight_number" },
      },
    },
  ]);

  // Get CEISA names for those passports
  const passportNorms = manifestPax.map((p) => p._id).filter(Boolean);
  if (!passportNorms.length) {
    return {
      total: 0,
      page,
      limit,
      pages: 0,
      data: [],
    };
  }
  const ceisaRecords = await Passenger.aggregate([
    {
      $match: {
        paspor: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $project: {
        paspor_norm: { $toUpper: { $trim: { input: "$paspor" } } },
        nama_lengkap: 1,
      },
    },
    {
      $match: {
        paspor_norm: { $in: passportNorms },
      },
    },
  ]);

  // Also try case-insensitive matching
  const ceisaMap = {};
  for (const c of ceisaRecords) {
    const key = c.paspor_norm;
    if (!ceisaMap[key])
      ceisaMap[key] = { names: new Set(), nama_ceisa: c.nama_lengkap };
    if (c.nama_lengkap)
      ceisaMap[key].names.add(c.nama_lengkap.trim().toUpperCase());
  }

  const mismatches = [];
  for (const mp of manifestPax) {
    const ceisa = ceisaMap[mp._id];
    if (!ceisa || !ceisa.names.size) continue;

    // Normalize manifest names
    const mNames = mp.manifest_names.map((n) =>
      n
        .replace(/\s+(MR|MRS|MS|MISS|MSTR|INF|CHD)$/i, "")
        .trim()
        .toUpperCase(),
    );

    // Check if ANY manifest name matches ANY ceisa name
    let hasMatch = false;
    for (const mn of mNames) {
      for (const cn of ceisa.names) {
        // Fuzzy: check if one contains the other or if similarity > 80%
        if (
          mn === cn ||
          mn.includes(cn) ||
          cn.includes(mn) ||
          similarityScore(mn, cn) > 0.8
        ) {
          hasMatch = true;
          break;
        }
      }
      if (hasMatch) break;
    }

    if (!hasMatch) {
      mismatches.push({
        passport_number: mp._id,
        manifest_names: mp.manifest_names.slice(0, 3),
        ceisa_name: ceisa.nama_ceisa,
        nationality: mp.nationality,
        flights: mp.flights.filter(Boolean).slice(0, 5),
        severity: "WARNING",
      });
    }
  }

  // Sort by number of flights (more flights = more important)
  mismatches.sort((a, b) => b.flights.length - a.flights.length);
  const total = mismatches.length;
  const paginated = mismatches.slice((page - 1) * limit, page * limit);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    data: paginated,
  };
}

// ──────────────────────────────────────
//  4. FREQUENT TRAVELERS
//  Passengers appearing on 3+ flights
// ──────────────────────────────────────
async function getFrequentTravelers(minFlights = 3, page = 1, limit = 50) {
  const result = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: { $trim: { input: "$passport_number" } } },
        name: { $first: "$name" },
        nationality: { $first: "$nationality" },
        gender: { $first: "$gender" },
        flights: { $addToSet: "$flight_number" },
        manifests: { $addToSet: "$manifest_id" },
        dates: { $addToSet: "$flight_date" },
        first_seen: { $min: "$flight_date" },
        last_seen: { $max: "$flight_date" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    {
      $project: {
        _id: 1,
        name: 1,
        nationality: 1,
        gender: 1,
        flights: 1,
        flight_count: { $size: "$manifests" },
        unique_routes: { $size: "$flights" },
        first_seen: 1,
        last_seen: 1,
      },
    },
    { $match: { flight_count: { $gte: minFlights } } },
    { $sort: { flight_count: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ]);

  // Get total count
  const countResult = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: "$passport_number" },
        c: { $addToSet: "$manifest_id" },
      },
    },
    { $match: { _id: { $nin: [null, ""] } } },
    { $project: { cnt: { $size: "$c" } } },
    { $match: { cnt: { $gte: minFlights } } },
    { $count: "total" },
  ]);
  const total = countResult[0]?.total || 0;

  // Enrich: check CEISA and watchlist for each
  const passportNums = result.map((r) => r._id).filter(Boolean);
  const passportNumSet = new Set(passportNums);
  const [ceisaRecords, suspects] = await Promise.all([
    Passenger.aggregate([
      {
        $match: {
          paspor: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $project: {
          paspor_norm: { $toUpper: { $trim: { input: "$paspor" } } },
          status_penelitian: 1,
        },
      },
      { $match: { paspor_norm: { $in: passportNums } } },
      {
        $group: {
          _id: "$paspor_norm",
          count: { $sum: 1 },
          statuses: { $addToSet: "$status_penelitian" },
        },
      },
    ]),
    Suspect.find(
      {
        status: { $in: ["ACTIVE", "MONITORING"] },
      },
      { passport_number: 1, risk_level: 1, categories: 1 },
    ).lean(),
  ]);

  const ceisaMap = {};
  for (const c of ceisaRecords) ceisaMap[c._id] = c;
  const suspectMap = {};
  for (const s of suspects) {
    const normalized = normalizePassport(s.passport_number);
    if (normalized && passportNumSet.has(normalized)) {
      suspectMap[normalized] = s;
    }
  }

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    data: result.map((r) => {
      const ceisa = ceisaMap[r._id];
      const suspect = suspectMap[r._id];
      return {
        passport_number: r._id,
        name: r.name,
        nationality: r.nationality,
        gender: r.gender,
        flight_count: r.flight_count,
        flights: r.flights.filter(Boolean).slice(0, 10),
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        ceisa_records: ceisa?.count || 0,
        ceisa_statuses: ceisa?.statuses || [],
        is_suspect: !!suspect,
        suspect_risk: suspect?.risk_level || null,
        suspect_categories: suspect?.categories || [],
        risk_tag: suspect
          ? "WATCHLIST"
          : r.flight_count >= 10
            ? "HIGH"
            : r.flight_count >= 5
              ? "MEDIUM"
              : "MONITOR",
      };
    }),
  };
}

// ──────────────────────────────────────
//  5. WATCHLIST CROSS-REFERENCE
//  Active suspects found in manifest data
// ──────────────────────────────────────
async function getWatchlistHits() {
  const suspects = await Suspect.find({
    status: { $in: ["ACTIVE", "MONITORING"] },
  }).lean();

  if (!suspects.length) return { total: 0, data: [] };

  const passportNums = suspects
    .filter((s) => s.passport_number)
    .map((s) => s.passport_number.toUpperCase().trim());

  // Find manifest appearances
  const manifestHits = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $addFields: {
        passport_upper: { $toUpper: { $trim: { input: "$passport_number" } } },
      },
    },
    {
      $match: {
        passport_upper: { $in: passportNums },
      },
    },
    {
      $group: {
        _id: "$passport_upper",
        flights: { $addToSet: "$flight_number" },
        manifests: { $addToSet: "$manifest_id" },
        dates: { $push: "$flight_date" },
        last_seen: { $max: "$flight_date" },
        names_used: { $addToSet: "$name" },
      },
    },
    {
      $project: {
        _id: 1,
        flights: 1,
        flight_count: { $size: "$manifests" },
        last_seen: 1,
        names_used: 1,
      },
    },
    { $sort: { flight_count: -1 } },
  ]);

  // Enrich with suspect info
  const suspectMap = {};
  for (const s of suspects) {
    if (s.passport_number) suspectMap[s.passport_number.toUpperCase()] = s;
  }

  // Also find CEISA records
  const ceisaRecords = await Passenger.aggregate([
    { $match: { paspor: { $exists: true, $nin: [null, ""] } } },
    {
      $project: {
        paspor_norm: { $toUpper: { $trim: { input: "$paspor" } } },
        tanggal_dokumen: 1,
        hkt1: 1,
        status_penelitian: 1,
      },
    },
    { $match: { paspor_norm: { $in: passportNums } } },
    {
      $group: {
        _id: "$paspor_norm",
        count: { $sum: 1 },
        last_ceisa: { $max: "$tanggal_dokumen" },
        devices: { $addToSet: "$hkt1" },
        statuses: { $addToSet: "$status_penelitian" },
      },
    },
  ]);
  const ceisaMap = {};
  for (const c of ceisaRecords) ceisaMap[c._id] = c;

  const hits = manifestHits.map((h) => {
    const suspect = suspectMap[h._id];
    const ceisa = ceisaMap[h._id];
    return {
      passport_number: h._id,
      suspect_name: suspect?.full_name || "?",
      risk_level: suspect?.risk_level || "MEDIUM",
      categories: suspect?.categories || [],
      suspect_status: suspect?.status || "ACTIVE",
      flight_count: h.flight_count,
      flights: h.flights.filter(Boolean).slice(0, 10),
      last_flight_date: h.last_seen,
      names_used: h.names_used,
      ceisa_records: ceisa?.count || 0,
      ceisa_last_date: ceisa?.last_ceisa,
      ceisa_devices: ceisa?.devices?.filter(Boolean) || [],
      ceisa_statuses: ceisa?.statuses || [],
      alert_level: suspect?.risk_level === "HIGH" ? "CRITICAL" : "WARNING",
    };
  });

  // Include suspects NOT found in manifests (for completeness)
  const foundPassports = new Set(manifestHits.map((h) => h._id));
  const notFound = suspects
    .filter(
      (s) =>
        s.passport_number &&
        !foundPassports.has(s.passport_number.toUpperCase().trim()),
    )
    .map((s) => ({
      passport_number: s.passport_number.toUpperCase(),
      suspect_name: s.full_name,
      risk_level: s.risk_level,
      categories: s.categories,
      suspect_status: s.status,
      flight_count: 0,
      flights: [],
      last_flight_date: null,
      names_used: [],
      ceisa_records: 0,
      alert_level: "MONITORING",
    }));

  return {
    total_hits: hits.length,
    total_suspects: suspects.length,
    total_not_found: notFound.length,
    data: [...hits, ...notFound],
  };
}

// ──────────────────────────────────────
//  6. MULTI-IDENTITY DETECTION
//  Same passport with different nationalities
//  or same name with multiple passports
// ──────────────────────────────────────
async function getMultiIdentity(page = 1, limit = 50) {
  // A) Same passport, different nationalities
  const multiNat = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
        nationality: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toUpper: "$passport_number" },
        nationalities: { $addToSet: "$nationality" },
        names: { $addToSet: "$name" },
        flights: { $addToSet: "$flight_number" },
      },
    },
    {
      $match: {
        "nationalities.1": { $exists: true }, // at least 2 different nationalities
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // B) Same normalized name with multiple passports
  const multiPassport = await ManifestPassenger.aggregate([
    {
      $match: {
        passport_number: { $exists: true, $nin: [null, ""] },
        name: { $exists: true, $nin: [null, ""] },
      },
    },
    {
      $project: {
        passport_upper: { $toUpper: "$passport_number" },
        name_normalized: {
          $trim: {
            input: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: {
                      $replaceAll: {
                        input: {
                          $replaceAll: {
                            input: { $toUpper: "$name" },
                            find: " MR",
                            replacement: "",
                          },
                        },
                        find: " MRS",
                        replacement: "",
                      },
                    },
                    find: " MS",
                    replacement: "",
                  },
                },
                find: " MISS",
                replacement: "",
              },
            },
          },
        },
        flight_number: 1,
        nationality: 1,
      },
    },
    {
      $group: {
        _id: "$name_normalized",
        passports: { $addToSet: "$passport_upper" },
        nationalities: { $addToSet: "$nationality" },
        flights: { $addToSet: "$flight_number" },
      },
    },
    {
      $match: {
        "passports.1": { $exists: true }, // at least 2 different passports
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const anomalies = [];

  for (const m of multiNat) {
    anomalies.push({
      type: "MULTI_NATIONALITY",
      passport_number: m._id,
      names: m.names.slice(0, 3),
      nationalities: m.nationalities,
      flights: m.flights.filter(Boolean).slice(0, 5),
      severity: m.nationalities.length > 2 ? "CRITICAL" : "WARNING",
    });
  }

  for (const m of multiPassport) {
    anomalies.push({
      type: "MULTI_PASSPORT",
      name: m._id,
      passports: m.passports.slice(0, 5),
      nationalities: (m.nationalities || []).filter(Boolean),
      flights: m.flights.filter(Boolean).slice(0, 5),
      severity: m.passports.length > 2 ? "CRITICAL" : "WARNING",
    });
  }

  anomalies.sort((a, b) =>
    a.severity === "CRITICAL" && b.severity !== "CRITICAL" ? -1 : 1,
  );

  const total = anomalies.length;
  const paginated = anomalies.slice((page - 1) * limit, page * limit);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    data: paginated,
  };
}

// ──────────────────────────────────────
//  UTILITY FUNCTIONS
// ──────────────────────────────────────
function normalizePassport(value) {
  if (!value) return "";
  return String(value).trim().toUpperCase();
}

function similarityScore(a, b) {
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const costs = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longer.length - costs[shorter.length]) / longer.length;
}

module.exports = {
  getRadarOverview,
  getGhostPassengers,
  getNameMismatches,
  getFrequentTravelers,
  getWatchlistHits,
  getMultiIdentity,
};
