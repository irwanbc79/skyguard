const path = require('path');

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

function getFileType(filename = '') {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return ext || 'unknown';
}

function parseFlightDate(dateToken) {
  if (!dateToken) return null;
  const normalized = String(dateToken).trim();
  const match = normalized.match(/^(\d{2})([A-Za-z]{3})(\d{2})(?:\/(\d{4}))?$/);
  if (!match) return null;
  const [, day, mon, year, timeToken] = match;
  const monthIndex = MONTHS[mon.toLowerCase()];
  const fullYear = 2000 + Number(year);
  if (monthIndex === undefined) return null;
  if (!timeToken) {
    return new Date(fullYear, monthIndex, Number(day));
  }
  const hours = Number(timeToken.slice(0, 2));
  const minutes = Number(timeToken.slice(2, 4));
  return new Date(fullYear, monthIndex, Number(day), hours, minutes);
}

function parseTotals(blockText) {
  const getNumber = (regex) => {
    const match = blockText.match(regex);
    return match ? Number(match[1]) : null;
  };
  return {
    total_manifested: getNumber(/Total Manifested\s*-\s*(\d+)/i),
    total_checked_in: getNumber(/Total Checked-in\s*-\s*(\d+)/i),
    no_shows: getNumber(/No Shows\s*-\s*(\d+)/i),
    total_bag_checked: getNumber(/Total Bag Checked\s*-\s*(\d+)/i),
    total_bag_weight: getNumber(/Total Bag Weight\s*-\s*(\d+)/i),
    male_manifested: getNumber(/Male Manifested\s*-\s*(\d+)/i),
    female_manifested: getNumber(/Female Manifested\s*-\s*(\d+)/i),
    child_manifested: getNumber(/Child Manifested\s*-\s*(\d+)/i),
    infant_manifested: getNumber(/Inf\.\s*Manifested\s*-\s*(\d+)/i)
  };
}

function parsePassengerLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('TKT:') || trimmed.startsWith('INFT:')) return null;
  if (/^Cnt\s+Name/i.test(trimmed) || /^---/.test(trimmed)) return null;

  // AirAsia/Malindo format:
  // <cnt>  <Name,[Name]>   [LVL]  <PNR(6)>  <FareClass>  <SeqNo>  <Date>  <Seat>  <0CDst(4)>  <FltNo>
  // Example: "1   Ab Samah,Norazam           P   ACW44T I         27 07Feb26     3C 0KNO  397 "
  // Example: "2   Alicia,Felice                  A7WSXV E         58 07Dec25     9A 0KNO  397 "
  const match = trimmed.match(
    /^(\d+)\s+(.+?)\s{2,}(?:([A-Z])\s+)?([A-Z0-9]{6})\s+([A-Z])\s+(\d+)\s+(\d{2}[A-Za-z]{3}\d{2})\s+(\d{1,3}[A-Z])\s+([0-9][A-Z]{3})\s+(\d+)\s*$/
  );
  if (!match) return { raw_line: trimmed };
  const [, cnt, name, level, pnr, fareClass, seqNo, travelDate, seatNo, destinationCode, flightNo] = match;
  return {
    name: name.trim(),
    pnr: pnr.trim(),
    fare_class: fareClass.trim(),
    level: level ? level.trim() : null,
    seq_no: Number(seqNo),
    travel_date: travelDate.trim(),
    seat_no: seatNo.trim(),
    destination_code: destinationCode.trim(),
    flight_no: flightNo.trim(),
    raw_line: trimmed,
    row_index: Number(cnt)
  };
}

function parsePassengerSection(lines, startIndex, status) {
  const passengers = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^No Shows:/i.test(line) || /^Thru /i.test(line) || /^Unconfirmed/i.test(line) || /^Stand-by/i.test(line)) {
      break;
    }
    const parsed = parsePassengerLine(line);
    if (parsed) {
      passengers.push({ ...parsed, status });
    }
  }
  return passengers;
}

function parseManifestText(rawText = '') {
  const lines = rawText.split(/\r?\n/);
  const segments = [];
  let currentSegment = null;
  let buffer = [];

  const flushSegment = () => {
    if (!currentSegment) return;
    currentSegment.raw_text = buffer.join('\n').trim();
    const totals = parseTotals(currentSegment.raw_text);
    currentSegment.totals = totals;
    segments.push(currentSegment);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('Flight:')) {
      flushSegment();
      const headerLine = line;
      const previousLines = lines.slice(Math.max(0, i - 5), i).filter(l => l.trim());
      const airline = previousLines.length ? previousLines[previousLines.length - 1].trim() : null;
      const headerMatch = headerLine.match(/Flight:\s*([A-Z0-9]{2}\s*\d+)\s+([A-Z]{6})\s+Date:\s*([0-9A-Za-z/]+)/);
      const flightNumber = headerMatch ? headerMatch[1].replace(/\s+/, ' ').trim() : null;
      const route = headerMatch ? headerMatch[2] : null;
      const dateToken = headerMatch ? headerMatch[3] : null;
      const flightDate = parseFlightDate(dateToken);
      currentSegment = {
        airline,
        flight_number: flightNumber,
        origin: route ? route.slice(0, 3) : null,
        destination: route ? route.slice(3) : null,
        flight_date: flightDate,
        passengers: [],
        no_shows: []
      };
    }
    if (currentSegment) {
      buffer.push(line);
    }
  }
  flushSegment();

  segments.forEach((segment) => {
    const segmentLines = segment.raw_text.split(/\r?\n/);
    const checkedInIndex = segmentLines.findIndex(line => /^Checked-in\/Boarded:/i.test(line));
    if (checkedInIndex >= 0) {
      segment.passengers = parsePassengerSection(segmentLines, checkedInIndex + 1, 'checked_in');
    }
    const noShowsIndex = segmentLines.findIndex(line => /^No Shows:/i.test(line));
    if (noShowsIndex >= 0) {
      segment.no_shows = parsePassengerSection(segmentLines, noShowsIndex + 1, 'no_show');
    }
  });

  return segments;
}

function buildManifestSummary(segments = []) {
  if (!segments.length) return {};
  const [first] = segments;
  return {
    flight_number: first.flight_number,
    flight_date: first.flight_date,
    origin: first.origin,
    destination: first.destination,
    carrier: first.airline
  };
}

// ─── GSPM Lion Air / JT Format Parser ────────────────────────────────────────

const MONTHS_STR = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function parseGspmDate(token) {
  // Format: 09FEB26
  const m = String(token).match(/^(\d{2})([A-Za-z]{3})(\d{2})$/);
  if (!m) return null;
  const [, dd, mon, yy] = m;
  const idx = MONTHS_STR[mon.toLowerCase()];
  if (idx === undefined) return null;
  return new Date(2000 + Number(yy), idx, Number(dd));
}

/**
 * Parse manifest format Lion Air GSPM
 * Header: "GSPM133/09FEBPEN" atau "FLIGHT/DATE - JT  0133 09FEB26"
 * Baris penumpang: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
 *
 * Returns array of segments (format sama dengan parseManifestText)
 */
function parseGspmText(rawText = '') {
  const lines = rawText.split(/\r?\n/);
  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let airline = 'Lion Air';
  const passengers = [];
  let inPassengerSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Header: "FLIGHT/DATE - JT  0133 09FEB26"
    const fltMatch = line.match(/FLIGHT\/DATE\s*-\s*([A-Z]{2})\s*(\d+)\s+(\d{2}[A-Za-z]{3}\d{2})/);
    if (fltMatch) {
      const carrier = fltMatch[1];
      const num = fltMatch[2].replace(/^0+/, '');
      flightNumber = `${carrier} ${num}`;
      flightDate = parseGspmDate(fltMatch[3]);
    }

    // Rute origin: "FROM  PENANG-MALAYSIA" → cari kode IATA dari database sederhana
    if (/^FROM\s+/i.test(line)) {
      const cityMatch = line.match(/FROM\s+(.+)/i);
      if (cityMatch) origin = resolveIata(cityMatch[1].trim());
    }

    // Rute destination setelah FROM (baris berikutnya biasanya kota tujuan)
    if (/^TO\s+/i.test(line)) {
      const cityMatch = line.match(/^TO\s+(.+)/i);
      if (cityMatch) destination = resolveIata(cityMatch[1].trim());
    }

    // Deteksi awal section penumpang
    if (/^SEAT\s+GEN\s+NAME/i.test(line)) {
      inPassengerSection = true;
      continue;
    }

    // Setelah header SEAT GEN NAME, parse baris penumpang
    if (!inPassengerSection) continue;
    if (!line.trim()) continue;

    // Baris penumpang: " 26F  F  ABIDIN LINA MRS      ID X1356564"
    // Infant bisa: " 12A  I  HARVEY LOUIS            IDNX4813727"
    const paxMatch = line.match(
      /^\s{0,3}(\d{1,3}[A-Z])\s+(M|F|I)\s{2}(.+?)\s{3,}([A-Z]{2,3})\s*([A-Z0-9]+)\s*[¥*#]?\s*$/
    );
    if (!paxMatch) continue;

    const [, seat, gender, nameFull, natCode, docNumber] = paxMatch;
    const cleanName = nameFull
      .replace(/\b(MR|MRS|MS|MISS|MSTR|DR|PROF)\b\.?/gi, '')
      .replace(/[¥*#]/g, '')
      .trim()
      .toUpperCase();

    const nationality = natCode.length === 3 ? natCode.slice(0, 2) : natCode;

    passengers.push({
      name: cleanName,
      pnr: null,
      fare_class: null,
      level: null,
      seq_no: passengers.length + 1,
      travel_date: null,
      seat_no: seat,
      destination_code: null,
      flight_no: flightNumber,
      raw_line: line.trim(),
      row_index: passengers.length + 1,
      status: 'checked_in',
      // APIS fields dari manifest GSPM
      gender,
      nationality,
      doc_number: docNumber.trim(),
      doc_type: 'P',
      apis_synced: true
    });
  }

  if (!passengers.length) return [];

  return [{
    airline,
    flight_number: flightNumber,
    origin,
    destination,
    flight_date: flightDate,
    passengers,
    no_shows: [],
    raw_text: rawText
  }];
}

/**
 * Peta sederhana nama kota → kode IATA (untuk GSPM yang tidak mencantumkan IATA)
 */
function resolveIata(cityText) {
  const map = {
    'PENANG': 'PEN', 'MEDAN': 'KNO', 'KUALA NAMU': 'KNO', 'JAKARTA': 'CGK',
    'SURABAYA': 'SUB', 'BALI': 'DPS', 'SINGAPORE': 'SIN', 'KUALA LUMPUR': 'KUL',
    'BANGKOK': 'BKK', 'HONG KONG': 'HKG', 'TOKYO': 'NRT', 'SYDNEY': 'SYD',
    'TAIPEI': 'TPE', 'GUANGZHOU': 'CAN', 'DUBAI': 'DXB', 'DOHA': 'DOH'
  };
  const upper = cityText.toUpperCase();
  for (const [key, code] of Object.entries(map)) {
    if (upper.includes(key)) return code;
  }
  return null;
}

/**
 * Auto-detect format dan parse teks manifest
 * Mendukung: AirAsia/QZ format dan Lion Air GSPM format
 */
function parseManifestAuto(rawText = '') {
  const firstLines = rawText.slice(0, 500);
  if (/^GSPM\d+/m.test(firstLines) || (/LION\s+AIR/i.test(firstLines) && /SEAT\s+GEN\s+NAME/i.test(rawText))) {
    return parseGspmText(rawText);
  }
  return parseManifestText(rawText);
}

module.exports = {
  getFileType,
  parseManifestText,
  parseGspmText,
  parseManifestAuto,
  buildManifestSummary,
  parsePassengerLine
};
