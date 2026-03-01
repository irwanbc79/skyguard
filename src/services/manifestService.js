const path = require("path");

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
  dec: 11,
};

function getFileType(filename = "") {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  return ext || "unknown";
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
    infant_manifested: getNumber(/Inf\.\s*Manifested\s*-\s*(\d+)/i),
  };
}

function parsePassengerLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("TKT:") || trimmed.startsWith("INFT:")) return null;
  if (/^Cnt\s+Name/i.test(trimmed) || /^---/.test(trimmed)) return null;

  // Primary regex - relaxed to handle varying field widths
  const match = trimmed.match(
    /^(\d+)\s+(.+?)\s{2,}([A-Z0-9]{4,8})\s+([A-Z])\s+(\d+)\s+(\d{2}[A-Za-z]{3}\d{2})\s+([0-9A-Z]+)\s+(\d?[A-Z]{3})\s+(\d+)\s*$/,
  );
  if (match) {
    const [
      ,
      seq,
      name,
      pnr,
      fareClass,
      seqNo,
      travelDate,
      seatNo,
      destinationCode,
      flightNo,
    ] = match;
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
      row_index: Number(seq),
    };
  }

  // Fallback: extract at least name from "seq  Name,First  ..."
  const fallback = trimmed.match(
    /^(\d+)\s+([A-Za-z]+[,/][A-Za-z\s]+?)(?:\s{2,}|\s+[A-Z0-9]{4,})/,
  );
  if (fallback) {
    return {
      name: fallback[2].trim(),
      raw_line: trimmed,
      row_index: Number(fallback[1]),
    };
  }

  return { raw_line: trimmed };
}

function parsePassengerSection(lines, startIndex, status) {
  const passengers = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (
      /^No Shows:/i.test(line) ||
      /^Thru /i.test(line) ||
      /^Unconfirmed/i.test(line) ||
      /^Stand-by/i.test(line)
    ) {
      break;
    }
    const parsed = parsePassengerLine(line);
    if (parsed) {
      passengers.push({ ...parsed, status });
    }
  }
  return passengers;
}

function parseManifestText(rawText = "") {
  const lines = rawText.split(/\r?\n/);
  const segments = [];
  let currentSegment = null;
  let buffer = [];

  const flushSegment = () => {
    if (!currentSegment) return;
    currentSegment.raw_text = buffer.join("\n").trim();
    const totals = parseTotals(currentSegment.raw_text);
    currentSegment.totals = totals;
    segments.push(currentSegment);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("Flight:")) {
      flushSegment();
      const headerLine = line;
      const previousLines = lines
        .slice(Math.max(0, i - 5), i)
        .filter((l) => l.trim());
      const airline = previousLines.length
        ? previousLines[previousLines.length - 1].trim()
        : null;
      const headerMatch = headerLine.match(
        /Flight:\s*([A-Z0-9]{2}\s*\d+)\s+([A-Z]{6})\s+Date:\s*([0-9A-Za-z/]+)/,
      );
      const flightNumber = headerMatch
        ? headerMatch[1].replace(/\s+/, " ").trim()
        : null;
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
        no_shows: [],
      };
    }
    if (currentSegment) {
      buffer.push(line);
    }
  }
  flushSegment();

  segments.forEach((segment) => {
    const segmentLines = segment.raw_text.split(/\r?\n/);
    const checkedInIndex = segmentLines.findIndex((line) =>
      /^Checked-in\/Boarded:/i.test(line),
    );
    if (checkedInIndex >= 0) {
      segment.passengers = parsePassengerSection(
        segmentLines,
        checkedInIndex + 1,
        "checked_in",
      );
    }
    const noShowsIndex = segmentLines.findIndex((line) =>
      /^No Shows:/i.test(line),
    );
    if (noShowsIndex >= 0) {
      segment.no_shows = parsePassengerSection(
        segmentLines,
        noShowsIndex + 1,
        "no_show",
      );
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
    carrier: first.airline,
  };
}

// ==================== APIS PARSER ====================
// Format: "Pax Verification Summary Report" dari AirAsia/AirAsia Indonesia
// Tiap penumpang 2 baris:
//   1) seq) PNR  LastName  FirstName  MiddleName
//   2)      G DOB Nat Res WL Ver Sb DocType Number Exp Cy

function parseAPISText(rawText = "") {
  const lines = rawText.split(/\r?\n/);
  const passengers = [];

  // Cari header baris untuk tahu apakah ini APIS format
  const isAPIS = lines.some((l) => /Pax Verification Summary Report/i.test(l));
  if (!isAPIS) return null;

  // Ekstrak info penerbangan
  let flightNumber = null;
  let flightDate = null;
  let cityPair = null;

  for (const line of lines) {
    const headerMatch = line.match(
      /Flight#:\s*([A-Z0-9\s]+?)\s+City Pair:([A-Z]{6})/i,
    );
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
  const paxBlockRegex =
    /^\s*(\d+)\)\s+([A-Z0-9]{5,6})\s+(.+?)\s{2,}(.+?)\s{2,}(.*?)\s*$/;
  const docLineRegex =
    /^\s+([MFmf])\s+(\d{6})\s+([A-Z]{2})\s+([A-Z]{2})\s+\S*\s+([YN])\s+([YN])\s+([A-Z])\s+(\S+)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const paxMatch = line.match(/^\s*(\d+)\)\s+([A-Z0-9]{5,6})\s+(.+)/);
    if (paxMatch) {
      const seqNo = Number(paxMatch[1]);
      const pnr = paxMatch[2].trim();
      // Sisa baris: "LastName  FirstName  MiddleName" (spasi ganda sebagai pemisah)
      const nameParts = paxMatch[3].trim().split(/\s{2,}/);
      const lastName = (nameParts[0] || "").trim();
      const firstName = (nameParts[1] || "").trim();
      const middleName = (nameParts[2] || "").trim();
      const fullName = [lastName, firstName, middleName]
        .filter(Boolean)
        .join(" ");

      let gender = null,
        dob = null,
        nationality = null,
        docType = null;
      let docNumber = null,
        expiry = null,
        country = null;

      // Baris kedua penumpang (info dokumen)
      if (i + 1 < lines.length) {
        const docLine = lines[i + 1];
        // Format: "   G DOB    Nat Res WL Ver Sb DocType Number    Exp   Cy"
        const docMatch = docLine.match(
          /^\s+([MFmf])\s+(\d{6})\s+([A-Z]{2})\s+([A-Z]{2})\s+\S*\s+([YN])\s+([YN])\s+([A-Z])\s+(\S+)\s+(\S+)\s+([A-Z]{2})/,
        );
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
        status: "checked_in",
        raw_line: line.trim(),
      });
    }
    i += 1;
  }

  if (!passengers.length) return null;

  const origin = cityPair ? cityPair.slice(0, 3) : null;
  const destination = cityPair ? cityPair.slice(3) : null;

  return {
    format: "apis",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    passengers,
    no_shows: [],
  };
}

// ==================== LION AIR MANIFEST PARSER ====================
// Format: "PASSENGER MANIFEST" dari Lion Air / Batik Air
// Contoh baris: " 26F  F  ABIDIN LINA MRS   ID X1356564"

// ==================== AIRLINE NAME LOOKUP ====================
const DCS_AIRLINE_MAP = {
  "LION AIRLINES": "Lion Air",
  "LION AIR": "Lion Air",
  "BATIK AIR": "Batik Air",
  MALINDO: "Malindo",
  "MALAYSIA AIRLINES": "Malaysia Airlines",
  "MALAYSIAN AIRLINE": "Malaysia Airlines",
  MAS: "Malaysia Airlines",
  "SINGAPORE AIRLINES": "Singapore Airlines",
  SIA: "Singapore Airlines",
  "GARUDA INDONESIA": "Garuda Indonesia",
  GARUDA: "Garuda Indonesia",
  CITILINK: "Citilink",
  "SRIWIJAYA AIR": "Sriwijaya Air",
  SRIWIJAYA: "Sriwijaya Air",
  "NAM AIR": "NAM Air",
  "WINGS AIR": "Wings Air",
  "SUPER AIR JET": "Super Air Jet",
  TRANSNUSA: "TransNusa",
  "PELITA AIR": "Pelita Air",
  "THAI LION AIR": "Thai Lion Air",
  "THAI LION": "Thai Lion Air",
  FIREFLY: "Firefly",
  "SILK AIR": "SilkAir",
  SILKAIR: "SilkAir",
  SCOOT: "Scoot",
  "CATHAY PACIFIC": "Cathay Pacific",
  "THAI AIRWAYS": "Thai Airways",
  "KOREAN AIR": "Korean Air",
  "CHINA AIRLINES": "China Airlines",
  EMIRATES: "Emirates",
  "QATAR AIRWAYS": "Qatar Airways",
  "JETSTAR ASIA": "Jetstar Asia",
  JETSTAR: "Jetstar",
  "CEBU PACIFIC": "Cebu Pacific",
  AIRASIA: "AirAsia",
  "AIR ASIA": "AirAsia",
  "PHILIPPINE AIRLINES": "Philippine Airlines",
  "JAPAN AIRLINES": "Japan Airlines",
  "ALL NIPPON": "ANA",
  "TURKISH AIRLINES": "Turkish Airlines",
  "ETIHAD AIRWAYS": "Etihad Airways",
  "ROYAL BRUNEI": "Royal Brunei",
  SAUDIA: "Saudia",
  "ETHIOPIAN AIRLINES": "Ethiopian Airlines",
  "VIETJET AIR": "VietJet Air",
  VIETJET: "VietJet Air",
};

const IATA_CARRIER_MAP = {
  JT: "Lion Air",
  ID: "Batik Air",
  IW: "Wings Air",
  OD: "Malindo",
  MH: "Malaysia Airlines",
  SQ: "Singapore Airlines",
  GA: "Garuda Indonesia",
  QG: "Citilink",
  SJ: "Sriwijaya Air",
  IN: "NAM Air",
  IU: "Super Air Jet",
  "8B": "TransNusa",
  IP: "Pelita Air",
  SL: "Thai Lion Air",
  MI: "SilkAir",
  TR: "Scoot",
  CX: "Cathay Pacific",
  TG: "Thai Airways",
  KE: "Korean Air",
  CI: "China Airlines",
  EK: "Emirates",
  QR: "Qatar Airways",
  "3K": "Jetstar Asia",
  JQ: "Jetstar",
  "5J": "Cebu Pacific",
  QZ: "AirAsia Indonesia",
  AK: "AirAsia",
  PR: "Philippine Airlines",
  JL: "Japan Airlines",
  NH: "ANA",
  TK: "Turkish Airlines",
  EY: "Etihad Airways",
  BI: "Royal Brunei",
  SV: "Saudia",
  ET: "Ethiopian Airlines",
  VJ: "VietJet Air",
};

function detectCarrierFromText(lines) {
  // Search first 15 lines for airline name
  const headerLines = lines.slice(0, 15).map((l) => l.trim().toUpperCase());
  for (const headerLine of headerLines) {
    for (const [keyword, name] of Object.entries(DCS_AIRLINE_MAP)) {
      if (headerLine.includes(keyword.toUpperCase())) return name;
    }
  }
  return null;
}

function parseLionAirManifest(rawText = "") {
  const lines = rawText.split(/\r?\n/);

  // Accept ANY airline that uses the standard DCS "PASSENGER MANIFEST" format
  const isManifest = lines.some((l) => /PASSENGER MANIFEST/i.test(l));
  if (!isManifest) return null;

  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let carrier = detectCarrierFromText(lines);

  for (const line of lines) {
    // FLIGHT/DATE - JT  0133 09FEB26   or   FLIGHT/DATE - MH 0872 12FEB26
    const fltMatch = line.match(
      /FLIGHT\/DATE\s*-\s*([A-Z0-9]{2})\s*(\d{3,4})\s+(\d{2}[A-Za-z]{3}\d{2})/i,
    );
    if (fltMatch) {
      flightNumber = `${fltMatch[1]} ${fltMatch[2]}`;
      flightDate = parseFlightDate(fltMatch[3]);
      // Derive carrier from IATA code if not yet found
      if (!carrier) {
        carrier = IATA_CARRIER_MAP[fltMatch[1].toUpperCase()] || fltMatch[1];
      }
    }
    const fromMatch = line.match(/^FROM\s+(.+?)(?:\s{5,}|$)/i);
    if (fromMatch && !origin) origin = fromMatch[1].trim().slice(0, 3);
    const toMatch = line.match(/^TO\s+(.+?)(?:\s{5,}|$)/i);
    if (toMatch && !destination) destination = toMatch[1].trim().slice(0, 3);
  }

  // Also detect destination from city lines below FROM (e.g. "MEDAN KUALA NAMU-INDONESIA")
  // In standard DCS, the line after FROM contains the destination city with IATA code at start or end
  if (!destination) {
    const fromIdx = lines.findIndex((l) => /^FROM\s+/i.test(l));
    if (fromIdx >= 0) {
      // Look up to 3 lines below FROM for destination city or IATA code
      for (let j = fromIdx + 1; j < Math.min(fromIdx + 4, lines.length); j++) {
        const cityLine = lines[j].trim();
        if (!cityLine || /^SEAT\s+GEN/i.test(cityLine)) break;
        // Try to extract 3-letter IATA from line like "MEDAN KUALA NAMU-INDONESIA"
        // or "TO  KUALA LUMPUR" or just look for known patterns
        const iataMatch = cityLine.match(/\b([A-Z]{3})\b/);
        if (iataMatch && cityLine.length > 5) {
          // Use flight number destination code if available from route
          // Otherwise attempt to use first 3 chars
          destination = cityLine.slice(0, 3).toUpperCase();
          // Better: check if there's a .TO SEE BELOW pattern
          if (/TO SEE BELOW/i.test(cityLine)) continue;
          break;
        }
      }
    }
  }

  // Extract destination from TOTAL line: "TOTAL KNO  PASSENGER"
  if (!destination) {
    for (const line of lines) {
      const totalDest = line.match(/^TOTAL\s+([A-Z]{3})\s+PASSENGER/i);
      if (totalDest) {
        destination = totalDest[1];
        break;
      }
    }
  }

  const passengers = [];
  let inPaxSection = false;

  for (const line of lines) {
    if (/SEAT\s+GEN\s+NAME/i.test(line)) {
      inPaxSection = true;
      continue;
    }
    if (!inPaxSection) continue;
    if (!line.trim()) continue;
    // Stop at total line
    if (/^TOTAL\s+[A-Z]{3}\s+PASSENGER/i.test(line.trim())) break;
    if (/^TOTAL\s+PASSENGER/i.test(line.trim())) break;

    // Skip INFT lines (infant linked to previous passenger)
    if (/^\s*INFT:/i.test(line.trim())) continue;

    // Format: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
    // Also handle: "12A  I  HARVEY LOUIS                            IDNX4813727"
    const paxMatch = line.match(
      /^\s*(\d+[A-Z])\s+([MFImfi])\s+(.+?)\s{2,}([A-Z]{2,3})\s*([A-Z0-9]+)\s*[¥*]?\s*$/,
    );
    if (paxMatch) {
      const seat = paxMatch[1].trim();
      const gender =
        paxMatch[2].toUpperCase() === "I" ? "I" : paxMatch[2].toUpperCase();
      const name = paxMatch[3]
        .replace(/\s+(MR|MRS|MISS|MS|MSTR|DR|BINT|MIS)\.?\s*$/i, "")
        .trim();
      const natDoc = paxMatch[4].trim();
      const docNumber = paxMatch[5].trim();

      // natDoc can be 2-char ("ID", "MY", "SG") or 3-char ("IDN")
      const nationality = natDoc.length === 3 ? natDoc.slice(0, 2) : natDoc;

      passengers.push({
        seat_no: seat,
        gender,
        name,
        nationality,
        passport_number: docNumber,
        doc_type: "P",
        status: "checked_in",
        raw_line: line.trim(),
      });
      continue;
    }

    // Fallback: looser pattern for lines with truncated names or unusual spacing
    const fallbackMatch = line.match(
      /^\s*(\d+[A-Z])\s+([MFImfi])\s+(.{5,}?)\s+([A-Z]{2,3})\s*([A-Z0-9]{5,})\s*[¥*]?\s*$/,
    );
    if (fallbackMatch) {
      const seat = fallbackMatch[1].trim();
      const gender =
        fallbackMatch[2].toUpperCase() === "I"
          ? "I"
          : fallbackMatch[2].toUpperCase();
      const name = fallbackMatch[3]
        .replace(/\s+(MR|MRS|MISS|MS|MSTR|DR|BINT|MIS)\.?\s*$/i, "")
        .trim();
      const natDoc = fallbackMatch[4].trim();
      const nationality = natDoc.length === 3 ? natDoc.slice(0, 2) : natDoc;
      const docNumber = fallbackMatch[5].trim();

      passengers.push({
        seat_no: seat,
        gender,
        name,
        nationality,
        passport_number: docNumber,
        doc_type: "P",
        status: "checked_in",
        raw_line: line.trim(),
      });
    }
  }

  if (!passengers.length) return null;

  // Extract totals from footer: "MALE- 50  FEMALE- 80  INFANT-  2    TOTAL PAX-132"
  let totalMale = 0,
    totalFemale = 0,
    totalInfant = 0,
    totalPax = 0;
  for (const line of lines) {
    const totMatch = line.match(
      /MALE-\s*(\d+)\s+FEMALE-\s*(\d+)\s+INFANT-\s*(\d+)\s+TOTAL PAX-\s*(\d+)/i,
    );
    if (totMatch) {
      totalMale = Number(totMatch[1]);
      totalFemale = Number(totMatch[2]);
      totalInfant = Number(totMatch[3]);
      totalPax = Number(totMatch[4]);
    }
  }

  // Determine format name based on carrier
  let formatName = "dcs_manifest";
  if (
    carrier === "Lion Air" ||
    carrier === "Batik Air" ||
    carrier === "Wings Air"
  )
    formatName = "lion_manifest";
  else if (carrier === "Malaysia Airlines") formatName = "mh_manifest";
  else if (
    carrier === "Singapore Airlines" ||
    carrier === "SilkAir" ||
    carrier === "Scoot"
  )
    formatName = "sq_manifest";
  else if (carrier === "Garuda Indonesia" || carrier === "Citilink")
    formatName = "ga_manifest";

  return {
    format: formatName,
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier,
    passengers,
    no_shows: [],
    totals: {
      male: totalMale,
      female: totalFemale,
      infant: totalInfant,
      total_passengers: totalPax || passengers.length,
    },
  };
}

// ==================== ENH (ENHANCED PASSENGER MANIFEST) PARSER ====================
// Format: Lion Air / Wings Air / Batik Air "ENHANCED PASSENGER MANIFEST"
// Baris header: FLIGHT: JT  133   DATE: 09FEB26
// Baris pax: 001 ABIDIN/LINA M/F./26F/..2/....10/223460/9902199495016/......./.../......./.../....
// Field separator: /  Fields: LNAME/FNAME/TYPE/SEAT/BAGS/WEIGHT/BAGTAG/TKT#/IN.FLT/TR.ORG/OT.FLT/F.DST/SPECIAL

function parseENHManifest(rawText = "") {
  const lines = rawText.split(/\r?\n/);

  // Detect ENH format
  const isENH = lines.some((l) => /ENHANCED PASSENGER MANIFEST/i.test(l));
  if (!isENH) return null;

  // Extract flight info from header
  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let carrier = null;

  for (const line of lines) {
    // FLIGHT: JT  133             DATE: 09FEB26
    const fltMatch = line.match(
      /FLIGHT:\s*([A-Z]{2})\s+(\d{2,4})\s+.*DATE:\s*(\d{2}[A-Za-z]{3}\d{2})/i,
    );
    if (fltMatch) {
      flightNumber = `${fltMatch[1]} ${fltMatch[2]}`;
      flightDate = parseFlightDate(fltMatch[3]);
      // Determine carrier from code
      const code = fltMatch[1].toUpperCase();
      if (code === "JT") carrier = "Lion Air";
      else if (code === "IW") carrier = "Wings Air";
      else if (code === "ID") carrier = "Batik Air";
      else if (code === "OD") carrier = "Malindo";
      else carrier = code;
    }

    // PT.OF EMBARKATION: PEN   PT.OF DEST: KNO
    const embMatch = line.match(/PT\.?\s*OF\s+EMBARKATION:\s*([A-Z]{3})/i);
    if (embMatch) origin = embMatch[1].trim();
    const destMatch = line.match(
      /PT\.?\s*OF\s+DEST(?:INATION)?:\s*([A-Z]{3})/i,
    );
    if (destMatch) destination = destMatch[1].trim();
  }

  // Parse passenger lines
  const passengers = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match passenger lines starting with 3-digit sequence number
    const seqMatch = trimmed.match(/^(\d{3})\s+(.+)/);
    if (!seqMatch) continue;

    const seqNo = Number(seqMatch[1]);
    const rest = seqMatch[2];

    // Split by / to get fields
    const fields = rest.split("/");
    if (fields.length < 3) continue;

    // Determine if field[1] is FNAME or TYPE
    // TYPE is always 1-2 chars: "M.", "F.", ".."
    let lastName, firstName, genderType, seatField, bagsField;
    let idx;

    if (fields.length >= 13 && /^[MF.]{1,2}\.?$/.test(fields[2].trim())) {
      // Standard: LNAME/FNAME/TYPE/SEAT/...
      lastName = fields[0].trim();
      firstName = fields[1].trim();
      genderType = fields[2].trim();
      idx = 3;
    } else if (
      fields.length >= 12 &&
      /^[MF.]{1,2}\.?$/.test(fields[1].trim())
    ) {
      // Short: LNAME/TYPE/SEAT/... (FNAME missing due to long name)
      lastName = fields[0].trim();
      firstName = "";
      genderType = fields[1].trim();
      idx = 2;
    } else {
      // Try best effort: assume standard
      lastName = fields[0].trim();
      firstName = fields.length > 1 ? fields[1].trim() : "";
      genderType = fields.length > 2 ? fields[2].trim() : "";
      idx = 3;
    }

    // Extract remaining fields
    seatField = fields[idx] || "";
    bagsField = fields[idx + 1] || "";
    const weightField = fields[idx + 2] || "";
    const bagtagField = fields[idx + 3] || "";
    const ticketField = fields[idx + 4] || "";
    const specialField = fields[fields.length - 1] || "";

    // Clean values (dots are padding)
    const cleanDots = (s) => s.replace(/\./g, "").trim();
    const seat = cleanDots(seatField);
    const bags = parseInt(cleanDots(bagsField)) || 0;
    const weight = parseInt(cleanDots(weightField)) || 0;
    const bagtag = cleanDots(bagtagField);
    const ticket = cleanDots(ticketField);
    const special = cleanDots(specialField);

    // Determine gender
    let gender = null;
    const gt = genderType.replace(/\./g, "").toUpperCase();
    if (gt === "M") gender = "M";
    else if (gt === "F") gender = "F";
    else gender = null;

    // Name with title hints
    const fullName = [lastName, firstName].filter(Boolean).join("/");
    const cleanName = fullName
      .replace(/\s+(MR|MRS|MISS|MS|MSTR|DR)\.?\s*$/i, "")
      .trim();

    // Determine status from SPECIAL field
    let paxType = "adult";
    if (/CHD/i.test(special)) paxType = "child";
    else if (/INF/i.test(special)) paxType = "infant";

    passengers.push({
      seq_no: seqNo,
      name: cleanName,
      gender,
      seat_no: seat,
      bags,
      bag_weight: weight,
      bag_tag: bagtag,
      ticket_number: ticket,
      pax_type: paxType,
      status: "checked_in",
      raw_line: trimmed,
    });
  }

  if (!passengers.length) return null;

  // Extract totals from footer
  let totalMale = 0,
    totalFemale = 0,
    totalChild = 0,
    totalInfant = 0;
  for (const line of lines) {
    const totMatch = line.match(
      /^\.\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/,
    );
    if (totMatch) {
      totalMale = Number(totMatch[1]);
      totalFemale = Number(totMatch[2]);
      totalChild = Number(totMatch[3]);
      totalInfant = Number(totMatch[4]);
    }
  }

  return {
    format: "enh_manifest",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier,
    passengers,
    no_shows: [],
    totals: {
      male: totalMale,
      female: totalFemale,
      child: totalChild,
      infant: totalInfant,
      total_passengers: passengers.length,
    },
  };
}

// ==================== BAG (CHECKED BAGGAGE DETAIL) PARSER ====================
// Format: AirAsia "Checked Baggage (Detail)"
// Baris: "Alridho/Muhammad Virza AITQ2B 128  KNOPEN  106  0807804129 XAG104254     19"
// Fields: Name(22) PNR(6) Seq(4) CityPair(6) Flight(5) BagTag(10) Agent(13) Weight(6)

function parseBaggageList(rawText = "") {
  const lines = rawText.split(/\r?\n/);

  const isBaggage = lines.some((l) => /Checked Baggage \(Detail\)/i.test(l));
  if (!isBaggage) return null;

  // Extract flight info from header
  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let airline = null;

  for (const line of lines) {
    // City Pair: KNOPEN  Flight No:  106
    const routeMatch = line.match(
      /City Pair:\s*([A-Z]{6})\s+Flight No:\s*(\d+)/i,
    );
    if (routeMatch) {
      const pair = routeMatch[1];
      origin = pair.slice(0, 3);
      destination = pair.slice(3);
      flightNumber = routeMatch[2].trim();
    }
    // Airline Code: QZ
    const airlineMatch = line.match(/Airline Code:\s*([A-Z]{2})/i);
    if (airlineMatch) {
      const code = airlineMatch[1];
      if (code === "QZ") airline = "AirAsia Indonesia";
      else if (code === "AK") airline = "AirAsia";
      else airline = code;
      if (flightNumber && !/^[A-Z]/.test(flightNumber)) {
        flightNumber = `${code} ${flightNumber}`;
      }
    }
    // Date from header
    const dateMatch = line.match(
      /from\s+(\d{2}[A-Za-z]{3}\d{2})\s+to\s+\d{2}[A-Za-z]{3}\d{2}/i,
    );
    if (dateMatch) {
      flightDate = parseFlightDate(dateMatch[1]);
    }
  }

  // Parse passenger lines
  const passengers = [];
  const paxMap = new Map(); // Deduplicate by PNR
  let inPaxSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Start after the dashed separator line
    if (/^-{20,}/.test(trimmed)) {
      inPaxSection = true;
      continue;
    }
    if (!inPaxSection) continue;
    if (!trimmed) continue;

    // Skip continuation lines (additional bag tags) - they start with spaces and bag tag number
    if (/^\d{7,}/.test(trimmed)) continue;

    // Parse passenger line: Name PNR Seq CityPair Flt BagTag Agent Weight
    const paxMatch = trimmed.match(
      /^(.{1,22}?)\s+([A-Z0-9]{5,6})\s+(\d+)\s+([A-Z]{6})\s+(\d+)\s+(\d{7,})\s+\S+\s+(\d+)\s*$/,
    );
    if (paxMatch) {
      const name = paxMatch[1].trim();
      const pnr = paxMatch[2].trim();
      const seq = Number(paxMatch[3]);
      const weight = Number(paxMatch[7]);

      // Deduplicate by PNR (multiple bag entries for same passenger)
      if (!paxMap.has(pnr)) {
        paxMap.set(pnr, {
          name,
          pnr,
          seq_no: seq,
          bag_weight: weight,
          status: "checked_in",
          raw_line: trimmed,
        });
      } else {
        // Add bag weight
        paxMap.get(pnr).bag_weight += weight;
      }
    }
  }

  passengers.push(...paxMap.values());

  if (!passengers.length) return null;

  return {
    format: "baggage_list",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier: airline,
    passengers,
    no_shows: [],
  };
}

// ==================== FILENAME-BASED CLASSIFIER ====================
// Classify non-parseable files by filename pattern to reduce needs_review

function classifyByFilename(filename = "") {
  const fn = filename.replace(/^\d+_/, "").toUpperCase();
  const prefix = fn.split(/[_\s.]/)[0];

  // Non-manifest operational documents
  const nonManifest = {
    GD: "general_declaration",
    GENDEC: "general_declaration",
    BAS: "baggage_summary",
    BASS: "baggage_summary",
    PST: "passenger_summary",
    WNB: "weight_balance",
    "W&B": "weight_balance",
    WB: "weight_balance",
    WNA: "weight_balance",
    ACC: "acceptance",
    ACCP: "acceptance",
    CUS: "customs",
    CUST: "customs",
    CST: "customs",
    CUSTOMER: "customs",
    CAS: "acceptance",
  };

  // Check FLT prefix (flt107, flt125, etc.)
  if (/^FLT\d+/.test(prefix)) return "flight_document";

  // Check known prefixes from combined patterns
  if (/^(SQ|MH)?BAS$/i.test(prefix)) return "baggage_summary";
  if (/^(SQ|MH)?WNB$/i.test(prefix)) return "weight_balance";
  if (/^(SQ|MH)?COUS(ACC)?$/i.test(prefix)) return "customs";

  return nonManifest[prefix] || null;
}

// ==================== CSV MANIFEST PARSER ====================
// Handles CSV/TSV manifests from any airline (column-based with headers)

function parseCSVManifest(rawText = "", filename = "") {
  if (!/\.csv$/i.test(filename)) return null;

  const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  // Detect delimiter (comma, semicolon, tab)
  const firstLine = lines[0];
  let delimiter = ",";
  if (firstLine.split("\t").length > firstLine.split(",").length)
    delimiter = "\t";
  else if (firstLine.split(";").length > firstLine.split(",").length)
    delimiter = ";";

  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  if (headers.length < 3) return null;

  // Map common column names to our fields
  const FIELD_MAP = {
    name: [
      "name",
      "nama",
      "passenger_name",
      "passenger",
      "pax_name",
      "full_name",
      "fullname",
    ],
    pnr: ["pnr", "booking_ref", "booking", "reservation", "booking_code"],
    seat: ["seat", "seat_no", "seat_number", "kursi"],
    gender: ["gender", "sex", "jenis_kelamin", "gen", "g"],
    nationality: [
      "nationality",
      "nat",
      "kebangsaan",
      "kewarganegaraan",
      "ctry",
      "country",
    ],
    passport: [
      "passport",
      "passport_number",
      "doc_number",
      "document_number",
      "doc_no",
      "paspor",
    ],
    flight: ["flight", "flight_number", "flight_no", "flt", "penerbangan"],
    date: ["date", "flight_date", "tanggal", "tgl", "departure_date"],
    origin: ["origin", "from", "departure", "dep", "asal"],
    destination: ["destination", "dest", "to", "arrival", "arr", "tujuan"],
    dob: ["dob", "date_of_birth", "birth_date", "tgl_lahir"],
    ticket: ["ticket", "ticket_number", "tkt"],
    status: ["status", "boarding_status"],
  };

  function findColumn(fieldNames) {
    for (const fn of fieldNames) {
      const idx = headers.indexOf(fn);
      if (idx >= 0) return idx;
      // Partial match
      const partial = headers.findIndex(
        (h) => h.includes(fn) || fn.includes(h),
      );
      if (partial >= 0) return partial;
    }
    return -1;
  }

  const colMap = {};
  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    colMap[field] = findColumn(aliases);
  }

  // Must have at least a name column
  if (colMap.name < 0) return null;

  const passengers = [];
  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]
      .split(delimiter)
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cols[colMap.name] || "";
    if (!name || name.length < 2) continue;

    const pax = {
      name,
      status: "checked_in",
      raw_line: lines[i],
      row_index: i,
    };

    if (colMap.pnr >= 0) pax.pnr = cols[colMap.pnr] || null;
    if (colMap.seat >= 0) pax.seat_no = cols[colMap.seat] || null;
    if (colMap.gender >= 0)
      pax.gender = (cols[colMap.gender] || "").toUpperCase().charAt(0) || null;
    if (colMap.nationality >= 0)
      pax.nationality = cols[colMap.nationality] || null;
    if (colMap.passport >= 0)
      pax.passport_number = cols[colMap.passport] || null;
    if (colMap.dob >= 0) pax.date_of_birth = cols[colMap.dob] || null;
    if (colMap.ticket >= 0) pax.ticket_number = cols[colMap.ticket] || null;
    if (colMap.status >= 0)
      pax.status = (cols[colMap.status] || "checked_in").toLowerCase();

    // Extract flight info from first valid row
    if (!flightNumber && colMap.flight >= 0)
      flightNumber = cols[colMap.flight] || null;
    if (!flightDate && colMap.date >= 0) {
      const dt = cols[colMap.date];
      if (dt) flightDate = parseFlightDate(dt) || new Date(dt) || null;
    }
    if (!origin && colMap.origin >= 0) origin = cols[colMap.origin] || null;
    if (!destination && colMap.destination >= 0)
      destination = cols[colMap.destination] || null;

    passengers.push(pax);
  }

  if (!passengers.length) return null;

  return {
    format: "csv_manifest",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier: null,
    passengers,
    no_shows: [],
  };
}

// ==================== XLS/XLSX MANIFEST PARSER ====================
// Parse Excel files using the xlsx package

function parseXLSXManifest(buffer, filename = "") {
  if (!/\.(xls|xlsx)$/i.test(filename)) return null;

  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    console.warn("[Manifest] xlsx package not available for Excel parsing");
    return null;
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    console.warn("[Manifest] Failed to read Excel file:", err.message);
    return null;
  }

  // Try each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    if (!csvText || csvText.trim().length < 20) continue;

    // First try CSV parser
    const csvResult = parseCSVManifest(csvText, "manifest.csv");
    if (csvResult && csvResult.passengers.length > 0) {
      csvResult.format = "xlsx_manifest";
      return csvResult;
    }

    // Then try all text-based parsers on the converted text
    const textResult = detectAndParseTextOnly(csvText, filename);
    if (textResult) {
      textResult.format = "xlsx_" + textResult.format;
      return textResult;
    }
  }

  return null;
}

// ==================== GENERIC FALLBACK TEXT PARSER ====================
// Best-effort parser for unrecognized manifest formats
// Tries to find passenger-like lines with names + document numbers

function parseGenericManifest(rawText = "") {
  const lines = rawText.split(/\r?\n/);
  const passengers = [];

  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let carrier = null;

  // Try to extract flight info from common patterns
  for (const line of lines) {
    if (!flightNumber) {
      // Pattern: "Flight: XX 1234" or "Flight No: XX1234" or "FLT: XX 1234"
      const fltMatch = line.match(
        /(?:Flight|FLT|Penerbangan)[:\s#]*\s*([A-Z]{2})\s*(\d{2,4})/i,
      );
      if (fltMatch) {
        flightNumber = `${fltMatch[1]} ${fltMatch[2]}`;
        carrier = IATA_CARRIER_MAP[fltMatch[1].toUpperCase()] || null;
      }
    }
    if (!flightDate) {
      const dateMatch = line.match(/(\d{2}[A-Za-z]{3}\d{2})/);
      if (dateMatch) flightDate = parseFlightDate(dateMatch[1]);
    }
    if (!origin) {
      const routeMatch = line.match(/([A-Z]{3})\s*[-–>]+\s*([A-Z]{3})/);
      if (routeMatch) {
        origin = routeMatch[1];
        destination = routeMatch[2];
      }
    }
  }

  // Try to find passenger data lines
  // Pattern 1: "NUM  NAME  <spaces>  PASSPORT/DOC"
  // Pattern 2: Lines with passport-like numbers (letter + 6-9 digits)
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    // Skip obvious header/footer lines
    if (/^(#|No|Cnt|Seat|---)/i.test(trimmed)) continue;
    if (/^(Total|MALE|FEMALE|Page|Printed)/i.test(trimmed)) continue;

    // Pattern: sequence + name + passport number
    const seqNameDoc = trimmed.match(
      /^\s*(\d{1,4})[.)\s]+([A-Za-z][A-Za-z\s,/.-]{3,40})\s{2,}.*?([A-Z]\d{6,9}|\d{9,})\s*$/,
    );
    if (seqNameDoc) {
      const name = seqNameDoc[2]
        .replace(/\s+(MR|MRS|MISS|MS|MSTR|DR)\.?\s*$/i, "")
        .trim();
      passengers.push({
        seq_no: Number(seqNameDoc[1]),
        name,
        passport_number: seqNameDoc[3],
        status: "checked_in",
        raw_line: trimmed,
      });
    }
  }

  if (passengers.length < 3) return null; // Need at least 3 passengers to consider valid

  return {
    format: "generic_manifest",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier,
    passengers,
    no_shows: [],
  };
}

// ==================== FORMAT DETECTOR (text-only, no XLS) ====================

function detectAndParseTextOnly(rawText = "", filename = "") {
  const apis = parseAPISText(rawText);
  if (apis) return apis;

  const enh = parseENHManifest(rawText);
  if (enh) return enh;

  const dcs = parseLionAirManifest(rawText);
  if (dcs) return dcs;

  const bag = parseBaggageList(rawText);
  if (bag) return bag;

  const segments = parseManifestText(rawText);
  if (segments.length) {
    const summary = buildManifestSummary(segments);
    return {
      format: "airasia_pax",
      ...summary,
      segments,
      passengers: segments.flatMap((s) => s.passengers || []),
      no_shows: segments.flatMap((s) => s.no_shows || []),
    };
  }

  const csv = parseCSVManifest(rawText, filename);
  if (csv) return csv;

  const generic = parseGenericManifest(rawText);
  if (generic) return generic;

  return null;
}

// ==================== FORMAT DETECTOR (main) ====================

function detectAndParseText(rawText = "", filename = "") {
  return detectAndParseTextOnly(rawText, filename);
}

module.exports = {
  getFileType,
  parseManifestText,
  buildManifestSummary,
  parseAPISText,
  parseLionAirManifest,
  parseENHManifest,
  parseBaggageList,
  parseCSVManifest,
  parseXLSXManifest,
  parseGenericManifest,
  classifyByFilename,
  detectAndParseText,
  detectAndParseTextOnly,
  IATA_CARRIER_MAP,
  DCS_AIRLINE_MAP,
};
