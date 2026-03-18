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

let AIRLABS_API_KEY = process.env.AIRLABS_API_KEY || "";
const AIRLABS_BASE_URL = "https://airlabs.co/api/v9";
let airLabsLastPoll = 0;
const AIRLABS_CACHE_TTL = 900; // 15 minutes cache for AirLabs data

// OpenSky Network — free ADS-B, no API key required (anonymous: 400 req/day)
const OPENSKY_BASE_URL = "https://opensky-network.org/api";
const OPENSKY_USERNAME = process.env.OPENSKY_USERNAME || "";
const OPENSKY_PASSWORD = process.env.OPENSKY_PASSWORD || "";
let openSkyLastPoll = 0;
const OPENSKY_CACHE_TTL = 600; // 10 min cache
const OPENSKY_MIN_INTERVAL = 10 * 60 * 1000; // poll at most every 10 min

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

// ---------- Airline IATA to name mapping (for AirLabs) ----------
const AIRLINE_IATA_NAMES = {
  QZ: "Indonesia AirAsia",
  AK: "AirAsia",
  SQ: "Singapore Airlines",
  MH: "Malaysia Airlines",
  EY: "Etihad Airways",
  JT: "Lion Air",
  ID: "Batik Air",
  QG: "Citilink",
  GA: "Garuda Indonesia",
  TR: "Scoot",
  OD: "Batik Air Malaysia",
  "3Y": "My Indo Airlines",
  SV: "Saudia",
  TG: "Thai Airways",
  QR: "Qatar Airways",
  EK: "Emirates",
  CX: "Cathay Pacific",
  IW: "Wings Air",
  IN: "NAM Air",
  SJ: "Sriwijaya Air",
  CI: "China Airlines",
  LH: "Lufthansa",
  LX: "Swiss",
  AI: "Air India",
  KL: "KLM",
  WY: "Oman Air",
  BA: "British Airways",
  AA: "American Airlines",
};

// Known operators at KNO (for codeshare deduplication)
const KNO_OPERATORS = new Set([
  "QZ",
  "AK",
  "SQ",
  "MH",
  "OD",
  "JT",
  "GA",
  "TR",
  "ID",
  "EY",
  "3Y",
  "IW",
  "QG",
  "IN",
  "SJ",
]);

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
  "GNS",
  "DTB",
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

// ---------- AirLabs API caller ----------
async function callAirLabs(endpoint, params) {
  if (!AIRLABS_API_KEY) return null;
  const url = new URL(AIRLABS_BASE_URL + endpoint);
  url.searchParams.set("api_key", AIRLABS_API_KEY);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[AirLabs] API error " + r.status + ": " + t);
      return null;
    }
    const json = await r.json();
    if (json.error) {
      console.error("[AirLabs] Error:", json.error.message);
      return null;
    }
    return json;
  } catch (err) {
    console.error("[AirLabs] Request failed:", err.message);
    return null;
  }
}

// ---------- OpenSky Network API caller ----------
async function callOpenSky(endpoint, params) {
  const url = new URL(OPENSKY_BASE_URL + endpoint);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers = {};
  if (OPENSKY_USERNAME && OPENSKY_PASSWORD) {
    headers["Authorization"] =
      "Basic " +
      Buffer.from(OPENSKY_USERNAME + ":" + OPENSKY_PASSWORD).toString("base64");
  }

  try {
    const r = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      console.error("[OpenSky] API error " + r.status + ": " + r.statusText);
      return null;
    }
    return await r.json();
  } catch (err) {
    console.error("[OpenSky] Request failed:", err.message);
    return null;
  }
}

// ---------- Process OpenSky data ----------
function processOpenSkyData(arrivals, states) {
  const now = new Date();
  const iso = now.toISOString();

  // Build lookup map from live state vectors (icao24 → position)
  // State vector array: [icao24, callsign, origin_country, time_position, last_contact,
  //   longitude, latitude, baro_altitude(m), on_ground, velocity(m/s), true_track,
  //   vertical_rate(m/s), sensors, geo_altitude(m), squawk, spi, position_source]
  const posMap = {};
  if (states && Array.isArray(states.states)) {
    for (const s of states.states) {
      if (!s[0]) continue;
      const icao24 = s[0].toLowerCase();
      const entry = {
        icao24,
        callsign: (s[1] || "").trim(),
        lon: s[5],
        lat: s[6],
        baro_alt_m: s[7],
        on_ground: s[8],
        velocity_ms: s[9],
        heading: s[10],
        vert_rate_ms: s[11],
        geo_alt_m: s[13],
        squawk: s[14] || "",
      };
      posMap[icao24] = entry;
      if (entry.callsign) posMap[entry.callsign] = entry;
    }
  }

  const flights = [];
  const positions = [];

  for (const f of arrivals) {
    const callsign = (f.callsign || "").trim();
    const depAirport = f.estDepartureAirport || "";

    // OpenSky uses ICAO codes — map common ones to IATA for display
    const ICAO_TO_IATA = {
      WMKK: "KUL", WSSS: "SIN", VTBD: "DMK", VTBS: "BKK",
      OMAA: "AUH", OMDB: "DXB", WBKK: "BKI", WMKP: "PEN",
      RCTP: "TPE", ZGGG: "CAN", ZGSZ: "SZX",
    };
    const depIata = ICAO_TO_IATA[depAirport] || depAirport;
    const isIntl = depAirport.length === 4 &&
      !depAirport.startsWith("WI") &&
      !depAirport.startsWith("WA") &&
      !depAirport.startsWith("WQ") &&
      depAirport !== "WIMM";

    const pos = posMap[f.icao24] || (callsign ? posMap[callsign] : null);
    const nowSec = Math.floor(Date.now() / 1000);
    const lastSeenAgo = f.lastSeen ? nowSec - f.lastSeen : 99999;
    const isOnGround = pos ? pos.on_ground : lastSeenAgo < 3600;

    let altFt = 0;
    let spdKt = 0;
    if (pos) {
      altFt = pos.baro_alt_m ? Math.round(pos.baro_alt_m * 3.281) : 0;
      spdKt = pos.velocity_ms ? Math.round(pos.velocity_ms * 1.944) : 0;
    }

    let status;
    if (pos && !pos.on_ground) {
      status = deriveStatus({ dest_iata: "KNO", dest_icao: "WIMM", alt: altFt, gspeed: spdKt });
    } else if (isOnGround) {
      status = "On Ground";
    } else {
      status = "En Route";
    }

    const arrivalTs = f.lastSeen ? new Date(f.lastSeen * 1000).toISOString() : null;

    flights.push({
      flight_id: f.icao24 || callsign,
      callsign,
      flight_number: callsign,
      airline: "",
      origin: depIata,
      origin_icao: depAirport,
      destination: "KNO",
      destination_icao: "WIMM",
      sched_time: arrivalTs,
      est_time: arrivalTs,
      actual_time: isOnGround ? arrivalTs : null,
      landing_time: isOnGround ? arrivalTs : null,
      status,
      is_arrival: true,
      aircraft: "",
      registration: "",
      source: "opensky",
      is_international: isIntl,
    });

    if (pos && !pos.on_ground && pos.lat && pos.lon) {
      const dist = haversineKm(KNO.lat, KNO.lon, pos.lat, pos.lon);
      positions.push({
        flight_id: f.icao24,
        callsign,
        flight_number: callsign,
        lat: pos.lat,
        lon: pos.lon,
        alt_ft: altFt,
        speed_kt: spdKt,
        vspeed: pos.vert_rate_ms ? Math.round(pos.vert_rate_ms * 197) : 0,
        heading: pos.heading || 0,
        distance_km: Math.round(dist),
        timestamp: iso,
        source: "opensky",
        aircraft: "",
        registration: "",
        origin: depIata,
        destination: "KNO",
        is_arrival: true,
        squawk: pos.squawk,
      });
    }
  }

  flights.sort((a, b) => (a.sched_time || "").localeCompare(b.sched_time || ""));
  positions.sort((a, b) => a.distance_km - b.distance_km);

  cache.set(
    "kno:board",
    { flights, updated_at: iso, source: "opensky", total: flights.length,
      international: flights.filter((f) => f.is_international).length },
    OPENSKY_CACHE_TTL,
  );
  cache.set("kno:positions", { positions, updated_at: iso, source: "opensky" }, OPENSKY_CACHE_TTL);
  generateAlerts(positions);

  console.log(
    "[OpenSky] Processed: " + flights.length + " arrivals (" +
    flights.filter((f) => f.is_international).length + " intl), " +
    positions.length + " live positions",
  );
}

// ---------- Process AirLabs schedule data ----------
// regMap: optional { flight_iata: reg_number } from AirLabs real-time /flights API
function processAirLabsData(items, regMap) {
  regMap = regMap || {};
  const now = new Date();
  const iso = now.toISOString();

  // Deduplicate codeshares: group by (dep_iata + arr_time)
  const groups = {};
  for (const f of items) {
    if (f.arr_iata !== "KNO") continue;
    if (f.cs_flight_iata) continue; // skip codeshared flights
    const key = (f.dep_iata || "") + "_" + (f.arr_time || "");
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const deduplicated = [];
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.length === 1) {
      deduplicated.push(g[0]);
    } else {
      const op = g.find((x) => KNO_OPERATORS.has(x.airline_iata));
      deduplicated.push(op || g[0]);
    }
  }

  function parseWIB(s) {
    if (!s) return null;
    const parts = s.split(" ");
    if (parts.length < 2) return null;
    return new Date(parts[0] + "T" + parts[1] + ":00+07:00");
  }

  const flights = [];
  for (const f of deduplicated) {
    const depIata = f.dep_iata || "";
    const airlineIata = f.airline_iata || "";
    const airlineName =
      AIRLINE_IATA_NAMES[airlineIata] || f.airline_icao || airlineIata;
    const isIntl = !ID_AIRPORTS.has(depIata);

    const schedTime = parseWIB(f.arr_time);
    const estTime = parseWIB(f.arr_estimated);
    const actTime = parseWIB(f.arr_actual);

    let status = "Scheduled";
    switch ((f.status || "").toLowerCase()) {
      case "landed":
        status = "On Ground";
        break;
      case "active":
        status = "En Route";
        break;
      case "scheduled":
        status = "Scheduled";
        break;
      case "cancelled":
        status = "Cancelled";
        break;
    }

    flights.push({
      flight_id: f.flight_iata || "",
      callsign: f.flight_icao || "",
      flight_number: f.flight_iata || "",
      airline: airlineName,
      origin: depIata,
      origin_icao: f.dep_icao || "",
      destination: "KNO",
      destination_icao: "WIMM",
      sched_time: schedTime ? schedTime.toISOString() : null,
      est_time: estTime ? estTime.toISOString() : null,
      actual_time: actTime ? actTime.toISOString() : null,
      landing_time:
        status === "On Ground" && actTime ? actTime.toISOString() : null,
      status: status,
      is_arrival: true,
      aircraft: f.aircraft_icao || "",
      registration: regMap[(f.flight_iata || "").replace(/\s/g, "").toUpperCase()] || f.reg_number || f.registration || "",
      source: "airlabs",
      is_international: isIntl,
      delayed: f.arr_delayed || null,
    });
  }

  flights.sort((a, b) => {
    const tA = a.sched_time || "";
    const tB = b.sched_time || "";
    return tA.localeCompare(tB);
  });

  cache.set(
    "kno:board",
    {
      flights: flights,
      updated_at: iso,
      source: "airlabs",
      total: flights.length,
      international: flights.filter((f) => f.is_international).length,
    },
    AIRLABS_CACHE_TTL,
  );

  cache.set(
    "kno:positions",
    { positions: [], updated_at: iso, source: "airlabs" },
    AIRLABS_CACHE_TTL,
  );

  console.log(
    "[AirLabs] Processed: " +
      flights.length +
      " flights (" +
      flights.filter((f) => f.is_international).length +
      " intl) | Source: airlabs",
  );
}

// ---------- Unified collection ----------
async function collectUnified() {
  // Strategy 0: AirLabs (free schedule API)
  if (AIRLABS_API_KEY) {
    const nowMs = Date.now();
    const cachedBoard = cache.get("kno:board");
    if (nowMs - airLabsLastPoll > 10 * 60 * 1000 || !cachedBoard) {
      console.log("[AirLabs] Fetching KNO arrival schedules...");
      const data = await callAirLabs("/schedules", { arr_iata: "KNO" });
      if (
        data &&
        data.response &&
        Array.isArray(data.response) &&
        data.response.length > 0
      ) {
        airLabsLastPoll = nowMs;
        // Real-time flights have reg_number; merge into schedule list for REG column
        const regMap = {};
        try {
          let live = await callAirLabs("/flights", { arr_iata: "KNO" });
          const list = live && live.response && Array.isArray(live.response) ? live.response : [];
          if (list.length === 0) {
            // Fallback: bbox around KNO (lat 3.64, lng 98.88) - flights in region
            live = await callAirLabs("/flights", {
              bbox: "2.5,97.8,4.8,100.0",
            });
            if (live && live.response && Array.isArray(live.response)) {
              for (const x of live.response) {
                if ((x.arr_iata === "KNO" || x.dep_iata === "KNO") && x.flight_iata && x.reg_number) {
                  const key = (x.flight_iata || "").replace(/\s/g, "").toUpperCase();
                  regMap[key] = x.reg_number;
                }
              }
            }
          } else {
            for (const x of list) {
              if (x.flight_iata && x.reg_number) {
                const key = (x.flight_iata || "").replace(/\s/g, "").toUpperCase();
                regMap[key] = x.reg_number;
              }
            }
          }
          const regCount = Object.keys(regMap).length;
          if (regCount > 0) console.log("[AirLabs] REG mapped for", regCount, "flights:", Object.keys(regMap).join(", "));
          else console.log("[AirLabs] Real-time /flights returned no reg_number (plan may exclude this endpoint)");
        } catch (e) {
          console.warn("[AirLabs] Real-time flights fetch failed:", e.message);
        }
        processAirLabsData(data.response, regMap);
        return;
      }
      console.log("[AirLabs] No data, trying next strategy...");
    } else {
      return; // cached AirLabs data still fresh
    }
  }

  // Strategy 1: OpenSky Network (free ADS-B, no key required)
  const openSkyNow = Date.now();
  if (openSkyNow - openSkyLastPoll > OPENSKY_MIN_INTERVAL || !cache.get("kno:board")) {
    console.log("[OpenSky] Fetching WIMM arrivals & live positions...");
    const endTs = Math.floor(openSkyNow / 1000);
    const beginTs = endTs - 86400; // last 24h of arrivals
    // Bounding box around KNO: ±3° lat, ±5° lon
    const [arrivals, states] = await Promise.all([
      callOpenSky("/flights/arrival", { airport: "WIMM", begin: beginTs, end: endTs }),
      callOpenSky("/states/all", {
        lamin: KNO.lat - 3, lamax: KNO.lat + 3,
        lomin: KNO.lon - 5, lomax: KNO.lon + 5,
      }),
    ]);
    if (arrivals && Array.isArray(arrivals) && arrivals.length > 0) {
      openSkyLastPoll = openSkyNow;
      processOpenSkyData(arrivals, states);
      return;
    }
    console.log("[OpenSky] No arrivals data, trying FR24...");
  } else {
    return; // OpenSky cache still fresh
  }

  console.log("[FR24] Unified poll - collecting all KNO flight data...");

  // Strategy 2: FR24 airport filter (most efficient)
  const data = await callFR24("/live/flight-positions/full", {
    airports: "both:" + KNO.iata,
    categories: "P,C",
    limit: "50",
  });

  if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
    processLiveData(data.data);
    return;
  }

  // Strategy 3: FR24 bounding box fallback
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

  // Strategy 4: Mock data (all strategies failed)
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
// Uses FIXED daily schedule times (WIB / UTC+7) matching real
// FlightRadar24 international arrivals at KNO (Kualanamu).
// Position, altitude, speed and status are derived dynamically
// based on how far the current time is from each scheduled arrival.
function generateMockData() {
  const now = new Date();
  const iso = now.toISOString();

  // Helper: create a Date for today at a specific WIB hour:minute
  function todayWIB(h, m) {
    const d = new Date(now);
    d.setUTCHours(h - 7, m, 0, 0);
    return d;
  }

  // Origin airport coordinates
  const ORIGINS = {
    KUL: { lat: 2.75, lon: 101.7 },
    SIN: { lat: 1.35, lon: 103.99 },
    AUH: { lat: 24.44, lon: 54.65 },
    PEN: { lat: 5.3, lon: 100.27 },
    DMK: { lat: 13.91, lon: 100.61 },
  };

  // ========== REAL KNO INTERNATIONAL ARRIVAL SCHEDULE ==========
  // Flight numbers & times from FlightRadar24.com — Friday 6 March 2026
  const arrivalSchedule = [
    // -- Morning --
    {
      fn: "EY480",
      cs: "ETD480",
      al: "Etihad Airways",
      o: "AUH",
      t: "A21N",
      r: "A6-AEB",
      sched: todayWIB(6, 40),
    },
    {
      fn: "SQ990",
      cs: "SIA990",
      al: "Singapore Airlines",
      o: "SIN",
      t: "B38M",
      r: "9V-MBA",
      sched: todayWIB(8, 0),
    },
    {
      fn: "3Y224",
      cs: "MYI224",
      al: "My Indo Airlines",
      o: "PEN",
      t: "B734",
      r: "PK-MYV",
      sched: todayWIB(8, 0),
    },
    {
      fn: "QZ107",
      cs: "AWQ107",
      al: "Indonesia AirAsia",
      o: "PEN",
      t: "A320",
      r: "PK-AXU",
      sched: todayWIB(8, 20),
    },
    {
      fn: "QZ125",
      cs: "AWQ125",
      al: "Indonesia AirAsia",
      o: "KUL",
      t: "A320",
      r: "PK-AZN",
      sched: todayWIB(8, 40),
    },
    {
      fn: "OD322",
      cs: "ODM322",
      al: "Batik Air Malaysia",
      o: "KUL",
      t: "B38M",
      r: "9M-LRV",
      sched: todayWIB(9, 30),
    },
    {
      fn: "QZ129",
      cs: "AWQ129",
      al: "Indonesia AirAsia",
      o: "KUL",
      t: "A320",
      r: "PK-AZQ",
      sched: todayWIB(9, 45),
    },
    {
      fn: "AK391",
      cs: "AXM391",
      al: "AirAsia",
      o: "KUL",
      t: "A320",
      r: "9M-AGM",
      sched: todayWIB(10, 35),
    },
    // -- Midday --
    {
      fn: "QZ121",
      cs: "AWQ121",
      al: "Indonesia AirAsia",
      o: "KUL",
      t: "A320",
      r: "PK-AZN",
      sched: todayWIB(12, 0),
    },
    {
      fn: "QZ109",
      cs: "AWQ109",
      al: "Indonesia AirAsia",
      o: "PEN",
      t: "A320",
      r: "PK-AZQ",
      sched: todayWIB(12, 35),
    },
    {
      fn: "QZ155",
      cs: "AWQ155",
      al: "Indonesia AirAsia",
      o: "DMK",
      t: "A320",
      r: "PK-AXU",
      sched: todayWIB(13, 25),
    },
    {
      fn: "AK397",
      cs: "AXM397",
      al: "AirAsia",
      o: "KUL",
      t: "A320",
      r: "9M-AQP",
      sched: todayWIB(14, 15),
    },
    {
      fn: "ID7146",
      cs: "BTK7146",
      al: "Batik Air",
      o: "SIN",
      t: "A320",
      r: "PK-LUV",
      sched: todayWIB(14, 35),
    },
    // -- Afternoon --
    {
      fn: "TR244",
      cs: "TGW244",
      al: "Scoot",
      o: "SIN",
      t: "A320",
      r: "9V-TRV",
      sched: todayWIB(15, 50),
    },
    {
      fn: "MH864",
      cs: "MAS864",
      al: "Malaysia Airlines",
      o: "KUL",
      t: "B738",
      r: "9M-MSE",
      sched: todayWIB(16, 0),
    },
    {
      fn: "QZ103",
      cs: "AWQ103",
      al: "Indonesia AirAsia",
      o: "PEN",
      t: "A320",
      r: "PK-AXU",
      sched: todayWIB(16, 15),
    },
    {
      fn: "JT133",
      cs: "LNI133",
      al: "Lion Air",
      o: "PEN",
      t: "B739",
      r: "PK-LQT",
      sched: todayWIB(16, 35),
    },
    {
      fn: "OD324",
      cs: "ODM324",
      al: "Batik Air Malaysia",
      o: "KUL",
      t: "B738",
      r: "9M-LDK",
      sched: todayWIB(17, 0),
    },
    // -- Evening --
    {
      fn: "AK393",
      cs: "AXM393",
      al: "AirAsia",
      o: "KUL",
      t: "A20N",
      r: "9M-AGO",
      sched: todayWIB(17, 20),
    },
    {
      fn: "OD312",
      cs: "ODM312",
      al: "Batik Air Malaysia",
      o: "PEN",
      t: "B738",
      r: "9M-LDH",
      sched: todayWIB(17, 45),
    },
    {
      fn: "QZ157",
      cs: "AWQ157",
      al: "Indonesia AirAsia",
      o: "DMK",
      t: "A320",
      r: "PK-AZQ",
      sched: todayWIB(18, 20),
    },
    {
      fn: "QZ131",
      cs: "AWQ131",
      al: "Indonesia AirAsia",
      o: "KUL",
      t: "A320",
      r: "PK-AXU",
      sched: todayWIB(19, 15),
    },
    {
      fn: "SQ994",
      cs: "SIA994",
      al: "Singapore Airlines",
      o: "SIN",
      t: "B38M",
      r: "9V-MBF",
      sched: todayWIB(19, 40),
    },
    // -- Night --
    {
      fn: "QZ105",
      cs: "AWQ105",
      al: "Indonesia AirAsia",
      o: "PEN",
      t: "A320",
      r: "PK-AZQ",
      sched: todayWIB(22, 0),
    },
    {
      fn: "QZ123",
      cs: "AWQ123",
      al: "Indonesia AirAsia",
      o: "KUL",
      t: "A320",
      r: "PK-AZN",
      sched: todayWIB(22, 20),
    },
  ];

  const flights = [];
  const positions = [];

  for (const s of arrivalSchedule) {
    const diffMin = (s.sched.getTime() - now.getTime()) / 60000;
    const orig = ORIGINS[s.o] || { lat: 3.0, lon: 100.0 };

    // Dynamically compute altitude, speed, position based on time-to-arrival
    let alt, spd, lat, lon, hdg;

    if (diffMin > 120) {
      // Far out — high cruise near origin
      const frac = Math.max(0, Math.min(1, 1 - diffMin / 420));
      alt = 35000 + Math.floor(Math.random() * 5000);
      spd = 470 + Math.floor(Math.random() * 60);
      lat = orig.lat + (KNO.lat - orig.lat) * frac;
      lon = orig.lon + (KNO.lon - orig.lon) * frac;
    } else if (diffMin > 30) {
      // Cruise, approaching
      const frac = 1 - (diffMin - 30) / 90;
      alt = 20000 + Math.floor(Math.random() * 15000);
      spd = 380 + Math.floor(Math.random() * 80);
      lat = orig.lat + (KNO.lat - orig.lat) * (0.3 + frac * 0.5);
      lon = orig.lon + (KNO.lon - orig.lon) * (0.3 + frac * 0.5);
    } else if (diffMin > 10) {
      // Descent / approach
      const frac = 1 - (diffMin - 10) / 20;
      alt = 3000 + Math.floor((1 - frac) * 12000);
      spd = 200 + Math.floor(Math.random() * 100);
      lat = KNO.lat + (orig.lat - KNO.lat) * (0.05 + (1 - frac) * 0.15);
      lon = KNO.lon + (orig.lon - KNO.lon) * (0.05 + (1 - frac) * 0.15);
    } else if (diffMin > 0) {
      // Final approach
      alt = 500 + Math.floor(Math.random() * 2500);
      spd = 150 + Math.floor(Math.random() * 60);
      lat = KNO.lat + (Math.random() - 0.5) * 0.08;
      lon = KNO.lon + (Math.random() - 0.5) * 0.08;
    } else {
      // Landed (or past scheduled time)
      alt = 0;
      spd = 0;
      lat = KNO.lat;
      lon = KNO.lon;
    }

    hdg = Math.floor(
      (Math.atan2(KNO.lon - lon, KNO.lat - lat) * 180) / Math.PI,
    );
    if (hdg < 0) hdg += 360;

    // Small jitter
    const dr = () => (Math.random() - 0.5) * 0.01;
    lat += dr();
    lon += dr();

    const di = haversineKm(KNO.lat, KNO.lon, lat, lon);
    const status =
      alt > 15000
        ? "En Route"
        : alt >= 3000
          ? "Approach"
          : alt > 0
            ? "Landing"
            : "On Ground";

    flights.push({
      flight_id: s.fn,
      callsign: s.cs,
      flight_number: s.fn,
      airline: s.al,
      origin: s.o,
      origin_icao: "",
      destination: "KNO",
      destination_icao: "",
      sched_time: s.sched.toISOString(),
      est_time: s.sched.toISOString(),
      actual_time: null,
      landing_time: diffMin <= 0 ? s.sched.toISOString() : null,
      status: status,
      is_arrival: true,
      aircraft: s.t,
      registration: s.r,
      source: "MOCK",
      is_international: true,
    });

    if (alt > 0) {
      positions.push({
        flight_id: s.fn,
        callsign: s.cs,
        flight_number: s.fn,
        lat: lat,
        lon: lon,
        alt_ft: alt,
        speed_kt: spd,
        vspeed: 0,
        heading: hdg,
        distance_km: Math.round(di),
        timestamp: iso,
        source: "MOCK",
        aircraft: s.t,
        registration: s.r,
        origin: s.o,
        destination: "KNO",
        is_arrival: true,
        squawk: "",
      });
    }
  }

  // --- Departures (for radar display, not shown on FIDS) ---
  const departures = [
    {
      fn: "TR2273",
      cs: "TGW2273",
      al: "Scoot",
      dst: "SIN",
      t: "B738",
      r: "9V-TRB",
    },
    {
      fn: "AK393",
      cs: "AXM393",
      al: "AirAsia",
      dst: "KUL",
      t: "A320",
      r: "9M-AQE",
    },
  ];
  for (const dep of departures) {
    const depAlt = 12000 + Math.floor(Math.random() * 20000);
    const depSpd = 350 + Math.floor(Math.random() * 100);
    const depHdg = dep.dst === "SIN" ? 150 : 90;
    const depLat = KNO.lat + (Math.random() * 2 - 1);
    const depLon = KNO.lon + Math.random() * 2;

    flights.push({
      flight_id: dep.fn,
      callsign: dep.cs,
      flight_number: dep.fn,
      airline: dep.al,
      origin: "KNO",
      origin_icao: "",
      destination: dep.dst,
      destination_icao: "",
      sched_time: null,
      est_time: null,
      actual_time: null,
      landing_time: null,
      status: "En Route",
      is_arrival: false,
      aircraft: dep.t,
      registration: dep.r,
      source: "MOCK",
      is_international: true,
    });

    positions.push({
      flight_id: dep.fn,
      callsign: dep.cs,
      flight_number: dep.fn,
      lat: depLat,
      lon: depLon,
      alt_ft: depAlt,
      speed_kt: depSpd,
      vspeed: 0,
      heading: depHdg,
      distance_km: Math.round(haversineKm(KNO.lat, KNO.lon, depLat, depLon)),
      timestamp: iso,
      source: "MOCK",
      aircraft: dep.t,
      registration: dep.r,
      origin: "KNO",
      destination: dep.dst,
      is_arrival: false,
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
  console.log(
    "[AirLabs] API Key: " +
      (AIRLABS_API_KEY
        ? "configured (" + AIRLABS_API_KEY.substring(0, 8) + "...)"
        : "NOT SET"),
  );
  console.log(
    "[OpenSky] Mode: " +
      (OPENSKY_USERNAME ? "authenticated (" + OPENSKY_USERNAME + ")" : "anonymous (400 req/day)"),
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
    airlabs_configured: !!AIRLABS_API_KEY,
    opensky_configured: true,
    opensky_authenticated: !!(OPENSKY_USERNAME && OPENSKY_PASSWORD),
    mode: AIRLABS_API_KEY ? "airlabs" : "opensky+fr24",
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

function setAirLabsApiKey(key) {
  AIRLABS_API_KEY = key;
  process.env.AIRLABS_API_KEY = key;
  airLabsLastPoll = 0;
  console.log("[AirLabs] API key updated");
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
  setAirLabsApiKey,
  fetchUsage,
  KNO,
  GEOFENCE_ZONES,
};
