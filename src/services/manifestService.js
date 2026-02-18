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

module.exports = {
  getFileType,
  parseManifestText,
  buildManifestSummary,
  parsePassengerLine
};
