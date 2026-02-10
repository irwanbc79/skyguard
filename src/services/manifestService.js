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
  const match = normalized.match(/^(\d{2})([A-Za-z]{3})(\d{2,4})(?:\/(\d{4}))?$/);
  if (!match) return null;
  const [, day, mon, yearStr, timeToken] = match;
  const monthIndex = MONTHS[mon.toLowerCase()];
  if (monthIndex === undefined) return null;
  const fullYear = yearStr.length === 4 ? Number(yearStr) : 2000 + Number(yearStr);
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

// --- Format detection ---

function detectFormat(rawText) {
  if (/Generic Report/i.test(rawText) && /\bPST\b/.test(rawText)) return 'pst';
  if (/ENHANCED PASSENGER MANIFEST/i.test(rawText)) return 'enh';
  if (/PASSENGER MANIFEST/i.test(rawText) && /SEAT\s+GEN\s+NAME/i.test(rawText)) return 'lion';
  if (/Flight:/.test(rawText) && /Checked-in\/Boarded:/i.test(rawText)) return 'airasia_pax';
  if (/Flight:/.test(rawText)) return 'airasia_pax';
  if (/SEAT\s+GEN\s+NAME/i.test(rawText)) return 'lion';
  return 'unknown';
}

// --- AirAsia PAX format parser (AK/QZ) ---

function parseAirAsiaPassengerLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('TKT:') || trimmed.startsWith('INFT:')) return null;
  if (/^Cnt\s+Name/i.test(trimmed) || /^---/.test(trimmed)) return null;

  const match = trimmed.match(
    /^(\d+)\s{1,3}(.+?)\s{2,}(?:([PB])\s{1,3})?([A-Z0-9]{5,6})\s+([A-Z])\s+(\d+)\s+(\d{2}[A-Za-z]{3}\d{2})\s+([0-9A-Z]+)\s+\d([A-Z]{3})\s+(\d+)\s*$/
  );
  if (!match) return { raw_line: trimmed };
  const [, seq, rawName, levelStr, pnr, fareClass, seqNo, travelDate, seatNo, destinationCode, flightNo] = match;

  return {
    name: rawName.trim(),
    pnr: pnr.trim(),
    fare_class: fareClass.trim(),
    seq_no: Number(seqNo),
    travel_date: travelDate.trim(),
    seat_no: seatNo.trim(),
    destination_code: destinationCode.trim(),
    flight_no: flightNo.trim(),
    raw_line: trimmed,
    level: levelStr || null,
    row_index: Number(seq)
  };
}

function parseAirAsiaPassengerSection(lines, startIndex, status) {
  const passengers = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^No Shows:/i.test(line) || /^Thru /i.test(line) || /^Unconfirmed/i.test(line) || /^Stand-by/i.test(line)) {
      break;
    }
    const parsed = parseAirAsiaPassengerLine(line);
    if (parsed) {
      passengers.push({ ...parsed, status });
    }
  }
  return passengers;
}

function parseAirAsiaPax(rawText) {
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
      segment.passengers = parseAirAsiaPassengerSection(segmentLines, checkedInIndex + 1, 'checked_in');
    }
    const noShowsIndex = segmentLines.findIndex(line => /^No Shows:/i.test(line));
    if (noShowsIndex >= 0) {
      segment.no_shows = parseAirAsiaPassengerSection(segmentLines, noShowsIndex + 1, 'no_show');
    }
  });

  return segments;
}

// --- Lion Air MANIFEST format parser (JT) ---
// Format: "SEAT GEN NAME  NATIONAL/DOC NO"
// Example: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
// Header:  "FLIGHT/DATE - JT  0133 09FEB26 AC REG -"

function parseLionManifest(rawText) {
  const lines = rawText.split(/\r?\n/);

  // Extract flight info from header
  const flightMatch = rawText.match(/FLIGHT\/DATE\s*-\s*([A-Z]{2})\s+0?(\d+)\s+(\d{2}[A-Z]{3}\d{2})/i);
  const airlineCode = flightMatch ? flightMatch[1] : null;
  const flightNum = flightMatch ? flightMatch[2] : null;
  const flightNumber = airlineCode && flightNum ? `${airlineCode} ${flightNum}` : null;
  const flightDate = flightMatch ? parseFlightDate(flightMatch[3]) : null;

  // Extract route
  const fromMatch = rawText.match(/FROM\s+(.+?)(?:\s*\.TO|\s*$)/im);
  const toLines = [];
  let destCode = null;
  const totalMatch = rawText.match(/TOTAL\s+([A-Z]{3})\s+PASSENGER/i);
  if (totalMatch) destCode = totalMatch[1];

  let originCode = null;
  // Try to get origin from GSPM header line: "GSPM133/09FEBPEN" -> PEN
  const gspmMatch = rawText.match(/^GSPM\d+\/\d{2}[A-Z]{3}([A-Z]{3})/m);
  if (gspmMatch) originCode = gspmMatch[1];

  const passengers = [];
  // Passenger line: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
  // Pattern: seat(3-4 chars) gender(M/F/I) name(padded) nationality docNumber
  // Allow trailing ¥ chars; nationality may be concatenated with doc (e.g. "IDNX4813727")
  const paxRegex = /^\s*(\d{1,2}[A-F])\s+([MFI])\s{1,3}(.+?)\s{2,}(\w{2,3})\s*([A-Z0-9*]+)[\s\u00A5]*$/;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimEnd();
    if (!trimmed.trim()) continue;

    // Skip header/footer lines
    if (/^GSPM|^LION|PASSENGER MANIFEST|FLIGHT\/DATE|^-{3,}|^FROM\s|^SEAT\s+GEN|^TOTAL|^MALE|^FEMALE/i.test(trimmed.trim())) continue;
    if (/KUALA NAMU|PENANG|\.TO SEE/i.test(trimmed)) continue;

    const match = trimmed.match(paxRegex);
    if (!match) continue;

    const [, seatNo, gender, rawName, nationality, docNumber] = match;
    // Clean trailing special chars like ¥
    const cleanName = rawName.trim().replace(/[^A-Za-z\s,.'()-]/g, '').trim();

    passengers.push({
      name: cleanName,
      seat_no: seatNo.trim(),
      gender,
      nationality: nationality.trim(),
      doc_number: docNumber.replace(/[^A-Z0-9*]/g, '').trim(),
      raw_line: trimmed.trim(),
      status: 'checked_in',
      row_index: passengers.length + 1,
      seq_no: passengers.length + 1
    });
  }

  // Extract totals from "MALE- 50  FEMALE- 80  INFANT-  2    TOTAL PAX-132"
  const totalsMatch = rawText.match(/MALE-\s*(\d+)\s+FEMALE-\s*(\d+)\s+INFANT-\s*(\d+)\s+TOTAL PAX-\s*(\d+)/i);

  const segment = {
    airline: airlineCode === 'JT' ? 'Lion Air' : airlineCode,
    flight_number: flightNumber,
    origin: originCode,
    destination: destCode,
    flight_date: flightDate,
    passengers,
    no_shows: [],
    totals: totalsMatch ? {
      male_manifested: Number(totalsMatch[1]),
      female_manifested: Number(totalsMatch[2]),
      infant_manifested: Number(totalsMatch[3]),
      total_manifested: Number(totalsMatch[4])
    } : {}
  };

  return [segment];
}

// --- Lion Air ENH (Enhanced Manifest) format parser ---
// Format: "001 ABIDIN/LINA M/F./26F/..2/....10/223460/9902199495016/......./.../......./.../....""
// Header: "FLIGHT: JT  133             DATE: 09FEB26"

function parseLionEnh(rawText) {
  const lines = rawText.split(/\r?\n/);

  const flightMatch = rawText.match(/FLIGHT:\s*([A-Z]{2})\s+(\d+)\s+DATE:\s*(\d{2}[A-Z]{3}\d{2})/i);
  const airlineCode = flightMatch ? flightMatch[1] : null;
  const flightNum = flightMatch ? flightMatch[2] : null;
  const flightNumber = airlineCode && flightNum ? `${airlineCode} ${flightNum}` : null;
  const flightDate = flightMatch ? parseFlightDate(flightMatch[3]) : null;

  const embMatch = rawText.match(/PT\.OF EMBARKATION:\s*([A-Z]{3})/i);
  const destMatch = rawText.match(/PT\.OF DEST:\s*([A-Z]{3})/i);
  const originCode = embMatch ? embMatch[1] : null;
  const destCode = destMatch ? destMatch[1] : null;

  const passengers = [];
  // Fields are slash-delimited:
  // SEQ LASTNAME/FIRSTNAME/GENDER/SEAT/BAGS/WEIGHT/BAGTAG/TICKET/...
  // Gender: "F.", "M.", ".." (child), "." ; Seat may have leading dot: ".3F"
  // When name is too long, firstname may be cut: "AMURTHALINGAM/M./10D/..."
  const seqRegex = /^(\d{3})\s+/;
  const seatPattern = /^\.?(\d{1,2}[A-F])$/;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('.') || trimmed.startsWith('-') || /^[A-Z] CLASS/i.test(trimmed)) continue;
    if (/^ENHANCED|^FLIGHT:|^A\/C REG|^LNAME|^TOTALS|^IN\.FLT/i.test(trimmed)) continue;

    const seqMatch = trimmed.match(seqRegex);
    if (!seqMatch) continue;

    const seqStr = seqMatch[1];
    const rest = trimmed.slice(seqMatch[0].length);
    const fields = rest.split('/');
    if (fields.length < 5) continue;

    // Find the seat field (digit(s) + letter A-F, optionally prefixed with dot)
    let seatIdx = -1;
    for (let f = 2; f < Math.min(fields.length, 5); f++) {
      if (seatPattern.test(fields[f])) {
        seatIdx = f;
        break;
      }
    }
    if (seatIdx < 0) continue;

    // Gender is field before seat, name fields are everything before gender
    const genderRaw = fields[seatIdx - 1];
    const nameFields = fields.slice(0, seatIdx - 1);
    const lastName = nameFields[0].trim();
    const firstName = nameFields.slice(1).join('/').trim();
    const name = firstName ? `${lastName}, ${firstName}` : lastName;
    const gender = genderRaw.replace(/\./g, '').trim() || null;
    const seatNo = fields[seatIdx].replace(/^\./, '').trim();

    // Check if CHD or INF from end of line
    const specialMatch = trimmed.match(/\/(CHD|INF)\.\s*$/);
    const paxType = specialMatch ? specialMatch[1] : 'ADT';

    passengers.push({
      name,
      seat_no: seatNo,
      gender,
      pax_type: paxType,
      raw_line: trimmed,
      status: 'checked_in',
      row_index: Number(seqStr),
      seq_no: Number(seqStr)
    });
  }

  const segment = {
    airline: airlineCode === 'JT' ? 'Lion Air' : airlineCode,
    flight_number: flightNumber,
    origin: originCode,
    destination: destCode,
    flight_date: flightDate,
    passengers,
    no_shows: [],
    totals: {}
  };

  // Extract totals
  const totalsMatch = rawText.match(/\.\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);
  if (totalsMatch) {
    segment.totals = {
      male_manifested: Number(totalsMatch[1]),
      female_manifested: Number(totalsMatch[2]),
      child_manifested: Number(totalsMatch[3]),
      infant_manifested: Number(totalsMatch[4])
    };
  }

  return [segment];
}

// --- SQ/MH PST (Generic Report) format parser ---
// Format: 2 lines per passenger
// Line 1: "1.AMAN/AMAN MR M SIN KNO YH B 044C"
// Line 2: " IDN X1738178"
// Header: "SQ994 09FEB SIN STD1910 BOARD 1840 GATE F35 GD"

function parsePst(rawText) {
  const lines = rawText.split(/\r?\n/);

  // Header: "SQ994 09FEB SIN STD1910 ..." or "MH860 09FEB KUL STD0830 ..."
  const headerMatch = rawText.match(/^\s*([A-Z]{2})(\d{3,4})\s+(\d{2})([A-Z]{3})\s+([A-Z]{3})\s+STD(\d{4})/m);
  let airlineCode = null, flightNum = null, flightNumber = null;
  let flightDate = null, originCode = null;

  if (headerMatch) {
    airlineCode = headerMatch[1];
    flightNum = headerMatch[2];
    flightNumber = `${airlineCode}${flightNum}`;
    const day = headerMatch[3];
    const mon = headerMatch[4];
    originCode = headerMatch[5];
    // Determine year - use current year context
    const currentYear = new Date().getFullYear();
    const yearShort = String(currentYear).slice(-2);
    flightDate = parseFlightDate(`${day}${mon}${yearShort}`);
  }

  const passengers = [];
  // Passenger line 1: "1.AMAN/AMAN MR M SIN KNO YH B 044C"
  // Variations: some have no title (e.g. "12.CONELLY/BIANCA C SIN KNO ...")
  // Pattern: seq.NAME/FIRSTNAME [TITLE] GENDER ORIGIN DEST CLASS B SEAT
  const paxLine1Regex = /^\s*(\d{1,3})\.(.+?)\s+(M|F|I|C)\s+([A-Z]{3})\s+([A-Z]{3})\s+([A-Z]{2})\s+B\s+(\d{3}[A-Z]?|\d+)\s*$/;
  // Doc line: " IDN X1738178" or " MYS *********6675"
  const docLineRegex = /^\s+([A-Z]{3})\s+([A-Z0-9*]+)\s*$/;

  let destCode = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(paxLine1Regex);
    if (!match) {
      i += 1;
      continue;
    }

    const [, seqStr, nameBlock, gender, origin, dest, fareClass, seatNo] = match;
    if (!destCode) destCode = dest;

    // Parse name: "AMAN/AMAN MR" or "CONELLY/BIANCA" or "LESSARD/ERLIATY CH MRS"
    // The name block contains: LASTNAME/FIRSTNAME [MIDDLE...] [TITLE]
    const slashIdx = nameBlock.indexOf('/');
    let name = nameBlock.trim();
    if (slashIdx >= 0) {
      const lastName = nameBlock.slice(0, slashIdx).trim();
      let rest = nameBlock.slice(slashIdx + 1).trim();
      // Remove trailing title (MR, MRS, MS, MISS, MSTR, DR, etc.)
      rest = rest.replace(/\s+(MR|MRS|MS|MISS|MSTR|DR|PROF|SIR|LADY)S?\s*$/i, '').trim();
      name = `${lastName}, ${rest}`;
    }

    // Check next line for doc info
    let nationality = null;
    let docNumber = null;
    if (i + 1 < lines.length) {
      const docMatch = lines[i + 1].match(docLineRegex);
      if (docMatch) {
        nationality = docMatch[1];
        docNumber = docMatch[2];
        i += 1; // skip doc line
      }
    }

    passengers.push({
      name,
      seat_no: seatNo.trim(),
      gender,
      fare_class: fareClass.trim(),
      destination_code: dest,
      nationality,
      doc_number: docNumber,
      raw_line: line.trim(),
      status: 'checked_in',
      row_index: Number(seqStr),
      seq_no: Number(seqStr)
    });

    i += 1;
  }

  const airlineName = airlineCode === 'SQ' ? 'Singapore Airlines'
    : airlineCode === 'MH' ? 'Malaysia Airlines'
    : airlineCode;

  const segment = {
    airline: airlineName,
    flight_number: flightNumber,
    origin: originCode,
    destination: destCode,
    flight_date: flightDate,
    passengers,
    no_shows: [],
    totals: {}
  };

  // Extract totals from header: "PST J4 Y139 TOTAL 143"
  const totalMatch = rawText.match(/TOTAL\s+(\d+)/i);
  if (totalMatch) {
    segment.totals.total_manifested = Number(totalMatch[1]);
  }

  return [segment];
}

// --- Main parse function with auto-detection ---

function parseManifestText(rawText = '') {
  if (!rawText.trim()) return [];

  const format = detectFormat(rawText);

  switch (format) {
    case 'airasia_pax':
      return parseAirAsiaPax(rawText);
    case 'lion':
      return parseLionManifest(rawText);
    case 'enh':
      return parseLionEnh(rawText);
    case 'pst':
      return parsePst(rawText);
    default:
      // Fallback: try AirAsia format
      return parseAirAsiaPax(rawText);
  }
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

module.exports = {
  getFileType,
  parseManifestText,
  buildManifestSummary,
  detectFormat
};
