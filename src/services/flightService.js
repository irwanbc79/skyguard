/**
 * FlightRadar24 Integration Service for SkyGuard
 * KNO (Kualanamu International Airport) - ICAO: WIMM, IATA: KNO
 * Strategy: UNIFIED single-endpoint polling via /live/flight-positions/full
 */
const NodeCache = require("node-cache");

const KNO = {
  iata: "KNO",
  icao: "WIMM",
  lat: 3.6422,
  lon: 98.8853,
  name: "Kualanamu International Airport",
};

const GEOFENCE_ZONES = [
  { name: "APPROACH", radius_km: 50, color: "#ef4444" },
  { name: "REGION", radius_km: 120, color: "#f59e0b" },
];

const CACHE_TTL = 200; // seconds
const POLL_MS = 3 * 60 * 1000; // 3 minutes
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 60 });

let FR24_API_KEY = process.env.FR24_API_KEY || "";
const FR24_BASE_URL =
  process.env.FR24_BASE_URL || "https://fr24api.flightradar24.com/api";

let pollingActive = false;
let pollTimer = null;
let creditUsage = { today: 0, total: 0, lastReset: new Date().toDateString() };

// Landing time tracker - persists across polls, auto-cleans >2 hours
const landedFlights = new Map(); // key: flight_number (normalized) -> { landing_time, flight_data }
const LANDED_KEEP_MS = 2 * 60 * 60 * 1000; // Keep landed flights for 2 hours

// ---------- Airline lookup ----------
const AIRLINE_NAMES = {
  SIA: "Singapore Airlines",
  SLK: "Silk Air",
  TGW: "Scoot",
  SCO: "Scoot",
  AXM: "AirAsia",
  MAS: "Malaysia Airlines",
  SVA: "Saudia",
  AWQ: "Indonesia AirAsia",
  LNI: "Lion Air",
  GIA: "Garuda Indonesia",
  BTK: "Batik Air",
  CTV: "Citilink",
  SJY: "Sriwijaya Air",
  THA: "Thai Airways",
  QTR: "Qatar Airways",
  ETH: "Ethiopian Airlines",
  UAE: "Emirates",
  CPA: "Cathay Pacific",
  SAS: "SAS Scandinavian",
  SL: "Thai Lion Air",
  FDX: "FedEx",
  GTI: "Atlas Air",
  QZ: "AirAsia Indonesia",
  JSA: "JetStar Asia",
  JST: "Jetstar",
};

// ---------- Indonesian airport IATA codes (for domestic detection) ----------
const ID_AIRPORTS = new Set([
  "CGK",
  "SUB",
  "DPS",
  "UPG",
  "BPN",
  "PKU",
  "PDG",
  "PLM",
  "BTH",
  "BDO",
  "SOC",
  "JOG",
  "SRG",
  "MDC",
  "AMQ",
  "DJJ",
  "BDJ",
  "PNK",
  "TKG",
  "PKY",
  "KNO",
  "MES",
  "BTJ",
  "TNJ",
  "TJQ",
  "LOP",
  "KOE",
  "KDI",
  "GTO",
  "PGK",
  "MLG",
  "HLP",
]);

// ---------- Helpers ----------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trackCredits(n) {
  n = n || 1;
  const t = new Date().toDateString();
  if (creditUsage.lastReset !== t) {
    creditUsage.today = 0;
    creditUsage.lastReset = t;
  }
  creditUsage.today += n;
  creditUsage.total += n;
}

function resolveAirline(code) {
  return code ? AIRLINE_NAMES[code] || code : "";
}

function deriveStatus(f) {
  const isArrival = f.dest_iata === KNO.iata || f.dest_icao === KNO.icao;
  const alt = f.alt || 0;
  const gspeed = f.gspeed || 0;
  if (alt === 0 && gspeed < 30) return "On Ground";
  if (alt === 0 && gspeed >= 30) return "Taxiing";
  if (alt < 5000 && isArrival) return "Landing";
  if (alt < 5000 && !isArrival) return "Departing";
  if (alt < 15000 && isArrival) return "Approach";
  if (alt < 15000 && !isArrival) return "Climbing";
  return isArrival ? "En Route (Arriving)" : "En Route (Departing)";
}

function isInternationalFlight(orig, dest) {
  if (ID_AIRPORTS.has(orig || "") && ID_AIRPORTS.has(dest || "")) return false;
  return true;
}

// ---------- FR24 API caller ----------
async function callFR24(endpoint, params) {
  params = params || {};
  if (!FR24_API_KEY) {
    console.log("[FR24] No API key configured, using mock data");
    return null;
  }
  const url = new URL(FR24_BASE_URL + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const r = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Version": "v1",
        Authorization: "Bearer " + FR24_API_KEY,
      },
      signal: AbortSignal.timeout(15000),
    });
    trackCredits();
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error(
        "[FR24] API error " + r.status + ": " + r.statusText + " - " + t,
      );
      return null;
    }
    return await r.json();
  } catch (err) {
    console.error("[FR24] Request failed:", err.message);
    return null;
  }
}

// ---------- Unified collection ----------
async function collectUnified() {
  console.log("[FR24] Unified poll - collecting all KNO flight data...");

  // Strategy 1: Airport filter (most efficient)
  const data = await callFR24("/live/flight-positions/full", {
    airports: "both:" + KNO.iata,
    categories: "P,C",
    limit: "50",
  });

  if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
    processLiveData(data.data);
    return;
  }

  // Strategy 2: Bounding box fallback (if airport filter returns nothing)
  if (FR24_API_KEY) {
    console.log("[FR24] Airport filter empty, trying bounding box...");
    const bb = await callFR24("/live/flight-positions/full", {
      bounds:
        KNO.lat +
        3 +
        "," +
        (KNO.lat - 3) +
        "," +
        (KNO.lon - 5) +
        "," +
        (KNO.lon + 5),
      categories: "P,C",
      limit: "50",
    });

    if (bb && bb.data && Array.isArray(bb.data) && bb.data.length > 0) {
      // Filter for KNO-related flights if possible
      const knoFlights = bb.data.filter(
        (f) =>
          f.orig_iata === KNO.iata ||
          f.dest_iata === KNO.iata ||
          f.orig_icao === KNO.icao ||
          f.dest_icao === KNO.icao,
      );

      if (knoFlights.length > 0) {
        processLiveData(knoFlights);
        return;
      }

      // Use all bounding box flights as regional data
      processLiveData(bb.data, "fr24_regional");
      return;
    }
  }

  // Strategy 3: Mock data (no API key or all strategies failed)
  console.log("[FR24] Using mock data");
  generateMockData();
}

// ---------- Process live flight data ----------
function processLiveData(items, sourceLabel) {
  sourceLabel = sourceLabel || "fr24_live";
  const now = new Date().toISOString();
  const flights = [];
  const positions = [];

  for (const f of items) {
    const isArr = f.dest_iata === KNO.iata || f.dest_icao === KNO.icao;
    const lat = f.lat || 0;
    const lon = f.lon || 0;
    const dist = haversineKm(KNO.lat, KNO.lon, lat, lon);
    const status = deriveStatus(f);
    const airline = resolveAirline(f.operating_as || f.painted_as);

    flights.push({
      flight_id: f.fr24_id || "",
      callsign: f.callsign || "",
      flight_number: f.flight || f.callsign || "",
      airline: airline,
      origin: f.orig_iata || f.orig_icao || "",
      origin_icao: f.orig_icao || "",
      destination: f.dest_iata || f.dest_icao || "",
      destination_icao: f.dest_icao || "",
      sched_time: null,
      est_time: f.eta || null,
      actual_time: null,
      status: status,
      is_arrival: isArr,
      aircraft: f.type || "",
      registration: f.reg || "",
      source: f.source || "ADSB",
      is_international: isInternationalFlight(f.orig_iata, f.dest_iata),
    });

    positions.push({
      flight_id: f.fr24_id || f.flight || "",
      callsign: f.callsign || f.flight || "",
      flight_number: f.flight || f.callsign || "",
      lat: lat,
      lon: lon,
      alt_ft: f.alt || 0,
      speed_kt: f.gspeed || 0,
      vspeed: f.vspeed || 0,
      heading: f.track || 0,
      distance_km: Math.round(dist),
      timestamp: f.timestamp || now,
      source: f.source || "",
      aircraft: f.type || "",
      registration: f.reg || "",
      origin: f.orig_iata || "",
      destination: f.dest_iata || "",
      is_arrival: isArr,
      squawk: f.squawk || "",
    });
  }

  // --- Landing time tracking ---
  const nowMs = Date.now();
  const activeFnKeys = new Set();
  for (const fl of flights) {
    const fnKey = (fl.flight_number || fl.callsign || "")
      .replace(/\s|-/g, "")
      .toUpperCase();
    if (!fnKey) continue;
    activeFnKeys.add(fnKey);
    const isGroundStatus = ["On Ground", "Taxiing", "Landing"].includes(
      fl.status,
    );
    if (fl.is_arrival && isGroundStatus) {
      // Record landing time if not already tracked
      if (!landedFlights.has(fnKey)) {
        const lt = new Date().toISOString();
        landedFlights.set(fnKey, {
          landing_time: lt,
          flight_data: Object.assign({}, fl, { landing_time: lt }),
        });
        console.log("[FR24] Landing detected: " + fnKey + " at " + lt);
      }
      fl.landing_time = landedFlights.get(fnKey).landing_time;
    } else if (landedFlights.has(fnKey)) {
      // Flight still in air but was previously marked - keep the time
      fl.landing_time = landedFlights.get(fnKey).landing_time;
    } else {
      fl.landing_time = null;
    }
  }

  // Merge recently-landed arrivals no longer in FR24 feed (max 2h)
  for (const [fnKey, entry] of landedFlights) {
    const ageMs = nowMs - new Date(entry.landing_time).getTime();
    if (ageMs > LANDED_KEEP_MS) {
      landedFlights.delete(fnKey); // Expired, remove
      continue;
    }
    if (!activeFnKeys.has(fnKey)) {
      // This flight disappeared from FR24 but landed recently - keep it visible
      const ghost = Object.assign({}, entry.flight_data, {
        status: "On Ground",
        landing_time: entry.landing_time,
        source: "LANDED_CACHE",
      });
      flights.push(ghost);
    }
  }

  // Sort: arrivals first, then by distance
  flights.sort((a, b) => {
    if (a.is_arrival && !b.is_arrival) return -1;
    if (!a.is_arrival && b.is_arrival) return 1;
    return 0;
  });
  positions.sort((a, b) => a.distance_km - b.distance_km);

  cache.set("kno:board", {
    flights: flights,
    updated_at: now,
    source: sourceLabel,
    total: flights.length,
    international: flights.filter((f) => f.is_international).length,
  });

  cache.set("kno:positions", {
    positions: positions,
    updated_at: now,
    source: sourceLabel,
  });

  generateAlerts(positions);

  console.log(
    "[FR24] Unified: " +
      flights.length +
      " flights (" +
      flights.filter((f) => f.is_international).length +
      " intl), " +
      positions.length +
      " positions | Source: " +
      sourceLabel,
  );
}

// ---------- Geofence alerts ----------
function generateAlerts(positions) {
  const alerts = [];
  for (const p of positions) {
    for (const z of GEOFENCE_ZONES) {
      if (p.distance_km <= z.radius_km) {
        alerts.push({
          type: "GEOFENCE_" + z.radius_km + "KM",
          flight_id: p.flight_id,
          callsign: p.callsign,
          flight_number: p.flight_number,
          distance_km: p.distance_km,
          alt_ft: p.alt_ft,
          speed_kt: p.speed_kt,
          zone_name: z.name,
          zone_color: z.color,
          origin: p.origin || "",
          destination: p.destination || "",
          aircraft: p.aircraft || "",
          registration: p.registration || "",
          is_arrival: p.is_arrival,
          time: new Date().toISOString(),
        });
      }
    }
  }

  cache.set("kno:alerts", {
    alerts: alerts.sort((a, b) => a.distance_km - b.distance_km),
    updated_at: new Date().toISOString(),
  });
}

// ---------- Mock data generator ----------
function generateMockData() {
  const now = new Date();
  const iso = now.toISOString();

  const mockFlights = [
    {
      fn: "TR2272",
      cs: "TGW2272",
      al: "Scoot",
      o: "SIN",
      d: "KNO",
      t: "B738",
      r: "9V-TRA",
      a: 28000,
      s: 460,
      la: 2.1,
      lo: 101.5,
      h: 320,
      ar: true,
      eta: new Date(now.getTime() + 45 * 60000).toISOString(),
    },
    {
      fn: "AK392",
      cs: "AXM392",
      al: "AirAsia",
      o: "KUL",
      d: "KNO",
      t: "A320",
      r: "9M-AQD",
      a: 22000,
      s: 420,
      la: 3.0,
      lo: 100.2,
      h: 280,
      ar: true,
      eta: new Date(now.getTime() + 30 * 60000).toISOString(),
    },
    {
      fn: "SV3812",
      cs: "SVA3812",
      al: "Saudia",
      o: "JED",
      d: "KNO",
      t: "B77W",
      r: "HZ-AK42",
      a: 38000,
      s: 520,
      la: 8.5,
      lo: 78.0,
      h: 90,
      ar: true,
      eta: new Date(now.getTime() + 180 * 60000).toISOString(),
    },
    {
      fn: "MH862",
      cs: "MAS862",
      al: "Malaysia Airlines",
      o: "KUL",
      d: "KNO",
      t: "B738",
      r: "9M-MXA",
      a: 0,
      s: 0,
      la: 2.75,
      lo: 101.7,
      h: 0,
      ar: true,
      eta: new Date(now.getTime() + 240 * 60000).toISOString(),
    },
    {
      fn: "TR2273",
      cs: "TGW2273",
      al: "Scoot",
      o: "KNO",
      d: "SIN",
      t: "B738",
      r: "9V-TRB",
      a: 12000,
      s: 350,
      la: 3.4,
      lo: 99.3,
      h: 150,
      ar: false,
      eta: null,
    },
    {
      fn: "AK393",
      cs: "AXM393",
      al: "AirAsia",
      o: "KNO",
      d: "KUL",
      t: "A320",
      r: "9M-AQE",
      a: 0,
      s: 0,
      la: KNO.lat,
      lo: KNO.lon,
      h: 0,
      ar: false,
      eta: null,
    },
    {
      fn: "SV3813",
      cs: "SVA3813",
      al: "Saudia",
      o: "KNO",
      d: "JED",
      t: "B77W",
      r: "HZ-AK43",
      a: 0,
      s: 0,
      la: KNO.lat,
      lo: KNO.lon,
      h: 0,
      ar: false,
      eta: null,
    },
    {
      fn: "QZ108",
      cs: "AWQ108",
      al: "AirAsia Indonesia",
      o: "KNO",
      d: "SIN",
      t: "A320",
      r: "PK-AXY",
      a: 34000,
      s: 480,
      la: 2.5,
      lo: 100.5,
      h: 140,
      ar: false,
      eta: null,
    },
  ];

  const flights = [];
  const positions = [];

  for (const m of mockFlights) {
    const dr = () => (Math.random() - 0.5) * 0.02;
    const la = m.la + dr();
    const lo = m.lo + dr();
    const di = haversineKm(KNO.lat, KNO.lon, la, lo);
    const status =
      m.a > 15000 ? "En Route" : m.a > 0 ? "Climbing" : "On Ground";

    flights.push({
      flight_id: m.fn,
      callsign: m.cs,
      flight_number: m.fn,
      airline: m.al,
      origin: m.o,
      origin_icao: "",
      destination: m.d,
      destination_icao: "",
      sched_time: null,
      est_time: m.eta,
      actual_time: null,
      status: status,
      is_arrival: m.ar,
      aircraft: m.t,
      registration: m.r,
      source: "MOCK",
      is_international: true,
    });

    positions.push({
      flight_id: m.fn,
      callsign: m.cs,
      flight_number: m.fn,
      lat: la,
      lon: lo,
      alt_ft: m.a,
      speed_kt: m.s,
      vspeed: 0,
      heading: m.h,
      distance_km: Math.round(di),
      timestamp: iso,
      source: "MOCK",
      aircraft: m.t,
      registration: m.r,
      origin: m.o,
      destination: m.d,
      is_arrival: m.ar,
      squawk: "",
    });
  }

  positions.sort((a, b) => a.distance_km - b.distance_km);

  cache.set("kno:board", {
    flights: flights,
    updated_at: iso,
    source: "mock",
    total: flights.length,
    international: flights.length,
  });

  cache.set("kno:positions", {
    positions: positions,
    updated_at: iso,
    source: "mock",
  });

  generateAlerts(positions);
}

// ---------- Usage endpoint ----------
async function fetchUsage() {
  const data = await callFR24("/usage", { period: "24h" });
  if (data && data.data) {
    cache.set("kno:usage", {
      endpoints: data.data,
      fetched_at: new Date().toISOString(),
    });
    return data.data;
  }
  return null;
}

// ---------- Polling control ----------
function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  console.log(
    "[FR24] Starting unified polling (every " + POLL_MS / 1000 + "s)",
  );
  console.log(
    "[FR24] API Key: " +
      (FR24_API_KEY
        ? "configured (" + FR24_API_KEY.substring(0, 8) + "...)"
        : "NOT SET (mock mode)"),
  );

  collectUnified().catch((e) => console.error("[FR24] Initial poll error:", e));

  pollTimer = setInterval(() => {
    collectUnified().catch((e) => console.error("[FR24] Poll error:", e));
  }, POLL_MS);
}

function stopPolling() {
  pollingActive = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  console.log("[FR24] Polling stopped");
}

// ---------- Data accessors ----------
function getBoard(filter) {
  filter = filter || "all";
  const data = cache.get("kno:board");
  if (!data) {
    collectUnified().catch(() => {});
    return {
      flights: [],
      updated_at: null,
      source: "loading",
      total: 0,
      international: 0,
    };
  }
  if (filter === "international") {
    return Object.assign({}, data, {
      flights: data.flights.filter((f) => f.is_international),
    });
  }
  return data;
}

function getPositions() {
  const data = cache.get("kno:positions");
  if (!data) {
    collectUnified().catch(() => {});
    return { positions: [], updated_at: null, source: "loading" };
  }
  return data;
}

function getAlerts() {
  const data = cache.get("kno:alerts");
  return data || { alerts: [], updated_at: null };
}

function getStatus() {
  const usage = cache.get("kno:usage");
  return {
    polling_active: pollingActive,
    api_key_configured: !!FR24_API_KEY,
    mode: FR24_API_KEY ? "live" : "mock",
    cache_keys: cache.keys(),
    credits: {
      today: creditUsage.today,
      total: creditUsage.total,
      estimated_monthly: creditUsage.today * 30,
    },
    fr24_usage: usage || null,
    kno: KNO,
    geofence_zones: GEOFENCE_ZONES,
    poll_interval: POLL_MS / 1000 + "s",
    cache_ttl: CACHE_TTL + "s",
  };
}

function setApiKey(key) {
  FR24_API_KEY = key;
  process.env.FR24_API_KEY = key;
  console.log("[FR24] API key updated");
  if (pollingActive) {
    collectUnified().catch(() => {});
  }
}

// ---------- Exports ----------
module.exports = {
  startPolling,
  stopPolling,
  getBoard,
  getPositions,
  getAlerts,
  getStatus,
  setApiKey,
  fetchUsage,
  KNO,
  GEOFENCE_ZONES,
};
