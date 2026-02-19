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
  const match = trimmed.match(/^(\d+)\s+(.+?)\s+([A-Z0-9]{5,6})\s+([A-Z])\s+(\d+)\s+(\d{2}[A-Za-z]{3}\d{2})\s+([0-9A-Z]+)\s+([0-9A-Z]{3})\s+(\d+)\s*$/);
  if (!match) return { raw_line: trimmed };
  const [, seq, name, pnr, fareClass, seqNo, travelDate, seatNo, destinationCode, flightNo] = match;
  return {
    name: name.trim(),
    pnr: pnr.trim(),
    fare_class: fareClass.trim(),
    seq_no: Number(seqNo),
    travel_date: travelDate.trim(),
    seat_no: seatNo.trim(),
    destination_code: destinationCode.trim(),
    flight_no: flightNo.trim(),
    raw_line: trimmed,
    level: null,
    row_index: Number(seq)
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

// ==================== APIS PARSER ====================
// Format: "Pax Verification Summary Report" dari AirAsia/AirAsia Indonesia
// Tiap penumpang 2 baris:
//   1) seq) PNR  LastName  FirstName  MiddleName
//   2)      G DOB Nat Res WL Ver Sb DocType Number Exp Cy

function parseAPISText(rawText = '') {
  const lines = rawText.split(/\r?\n/);
  const passengers = [];

  // Cari header baris untuk tahu apakah ini APIS format
  const isAPIS = lines.some(l => /Pax Verification Summary Report/i.test(l));
  if (!isAPIS) return null;

  // Ekstrak info penerbangan
  let flightNumber = null;
  let flightDate = null;
  let cityPair = null;

  for (const line of lines) {
    const headerMatch = line.match(/Flight#:\s*([A-Z0-9\s]+?)\s+City Pair:([A-Z]{6})/i);
    if (headerMatch) {
      flightNumber = headerMatch[1].trim();
      cityPair = headerMatch[2].trim();
    }
    const dateMatch = line.match(/Date:\s*(\d{2}[A-Za-z]{3}\d{2})/i);
    if (dateMatch) {
      flightDate = parseFlightDate(dateMatch[1]);
    }
  }

  // Parse blok tiap penumpang (pola: angka diikuti ")")
  const paxBlockRegex = /^\s*(\d+)\)\s+([A-Z0-9]{5,6})\s+(.+?)\s{2,}(.+?)\s{2,}(.*?)\s*$/;
  const docLineRegex = /^\s+([MFmf])\s+(\d{6})\s+([A-Z]{2})\s+([A-Z]{2})\s+\S*\s+([YN])\s+([YN])\s+([A-Z])\s+(\S+)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const paxMatch = line.match(/^\s*(\d+)\)\s+([A-Z0-9]{5,6})\s+(.+)/);
    if (paxMatch) {
      const seqNo = Number(paxMatch[1]);
      const pnr = paxMatch[2].trim();
      // Sisa baris: "LastName  FirstName  MiddleName" (spasi ganda sebagai pemisah)
      const nameParts = paxMatch[3].trim().split(/\s{2,}/);
      const lastName = (nameParts[0] || '').trim();
      const firstName = (nameParts[1] || '').trim();
      const middleName = (nameParts[2] || '').trim();
      const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ');

      let gender = null, dob = null, nationality = null, docType = null;
      let docNumber = null, expiry = null, country = null;

      // Baris kedua penumpang (info dokumen)
      if (i + 1 < lines.length) {
        const docLine = lines[i + 1];
        // Format: "   G DOB    Nat Res WL Ver Sb DocType Number    Exp   Cy"
        const docMatch = docLine.match(/^\s+([MFmf])\s+(\d{6})\s+([A-Z]{2})\s+([A-Z]{2})\s+\S*\s+([YN])\s+([YN])\s+([A-Z])\s+(\S+)\s+(\S+)\s+([A-Z]{2})/);
        if (docMatch) {
          gender = docMatch[1].toUpperCase();
          dob = docMatch[2];
          nationality = docMatch[3];
          docType = docMatch[7];
          docNumber = docMatch[8].trim();
          expiry = docMatch[9];
          country = docMatch[10];
          i += 1; // skip baris kedua
        }
      }

      passengers.push({
        seq_no: seqNo,
        pnr,
        name: fullName,
        gender,
        date_of_birth: dob,
        nationality,
        doc_type: docType,
        passport_number: docNumber,
        passport_expiry: expiry,
        status: 'checked_in',
        raw_line: line.trim()
      });
    }
    i += 1;
  }

  if (!passengers.length) return null;

  const origin = cityPair ? cityPair.slice(0, 3) : null;
  const destination = cityPair ? cityPair.slice(3) : null;

  return {
    format: 'apis',
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    passengers,
    no_shows: []
  };
}

// ==================== LION AIR MANIFEST PARSER ====================
// Format: "PASSENGER MANIFEST" dari Lion Air / Batik Air
// Contoh baris: " 26F  F  ABIDIN LINA MRS   ID X1356564"

function parseLionAirManifest(rawText = '') {
  const lines = rawText.split(/\r?\n/);
  const isLionManifest = lines.some(l => /PASSENGER MANIFEST/i.test(l)) &&
                         lines.some(l => /LION AIRLINES|BATIK AIR|MALINDO/i.test(l));
  if (!isLionManifest) return null;

  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let carrier = null;

  for (const line of lines) {
    if (/LION AIRLINES/i.test(line)) carrier = 'Lion Air';
    if (/BATIK AIR/i.test(line)) carrier = 'Batik Air';
    if (/MALINDO/i.test(line)) carrier = 'Malindo';

    const fltMatch = line.match(/FLIGHT\/DATE\s*-\s*([A-Z0-9]{2})\s*(\d{3,4})\s+(\d{2}[A-Za-z]{3}\d{2})/i);
    if (fltMatch) {
      flightNumber = `${fltMatch[1]} ${fltMatch[2]}`;
      flightDate = parseFlightDate(fltMatch[3]);
    }
    const fromMatch = line.match(/^FROM\s+(.+?)(?:\s{5,}|$)/i);
    if (fromMatch && !origin) origin = fromMatch[1].trim().slice(0, 3);
    const toMatch = line.match(/^TO\s+(.+?)(?:\s{5,}|$)/i);
    if (toMatch && !destination) destination = toMatch[1].trim().slice(0, 3);
  }

  const passengers = [];
  let inPaxSection = false;

  for (const line of lines) {
    if (/SEAT\s+GEN\s+NAME/i.test(line)) { inPaxSection = true; continue; }
    if (!inPaxSection) continue;
    if (!line.trim()) continue;

    // Format: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
    const paxMatch = line.match(/^\s*(\d+[A-Z])\s+([MFImfi])\s+(.+?)\s{3,}([A-Z]{2})\s*([A-Z0-9]+)\s*[¥*]?\s*$/);
    if (paxMatch) {
      const seat = paxMatch[1].trim();
      const gender = paxMatch[2].toUpperCase() === 'I' ? 'I' : paxMatch[2].toUpperCase();
      const name = paxMatch[3].replace(/\s+(MR|MRS|MISS|MS|MSTR|DR)\.?\s*$/i, '').trim();
      const nationality = paxMatch[4].trim();
      const docNumber = paxMatch[5].trim();
      const status = gender === 'I' ? 'checked_in' : 'checked_in';

      passengers.push({
        seat_no: seat,
        gender,
        name,
        nationality,
        passport_number: docNumber,
        doc_type: 'P',
        status,
        raw_line: line.trim()
      });
    }
  }

  if (!passengers.length) return null;

  return {
    format: 'lion_manifest',
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier,
    passengers,
    no_shows: []
  };
}

// ==================== FORMAT DETECTOR ====================

function detectAndParseText(rawText = '') {
  // Coba APIS dulu (paling informatif)
  const apis = parseAPISText(rawText);
  if (apis) return apis;

  // Coba Lion Air Manifest
  const lion = parseLionAirManifest(rawText);
  if (lion) return lion;

  // Fallback ke AirAsia PAX format (sudah ada)
  const segments = parseManifestText(rawText);
  if (segments.length) {
    const summary = buildManifestSummary(segments);
    return {
      format: 'airasia_pax',
      ...summary,
      segments,
      passengers: segments.flatMap(s => s.passengers || []),
      no_shows: segments.flatMap(s => s.no_shows || [])
    };
  }

  return null;
}

module.exports = {
  getFileType,
  parseManifestText,
  buildManifestSummary,
  parseAPISText,
  parseLionAirManifest,
  detectAndParseText
};
