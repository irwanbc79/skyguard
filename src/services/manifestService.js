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

function parseLionAirManifest(rawText = "") {
  const lines = rawText.split(/\r?\n/);
  const isLionManifest =
    lines.some((l) => /PASSENGER MANIFEST/i.test(l)) &&
    lines.some((l) => /LION AIRLINES|BATIK AIR|MALINDO/i.test(l));
  if (!isLionManifest) return null;

  let flightNumber = null;
  let flightDate = null;
  let origin = null;
  let destination = null;
  let carrier = null;

  for (const line of lines) {
    if (/LION AIRLINES/i.test(line)) carrier = "Lion Air";
    if (/BATIK AIR/i.test(line)) carrier = "Batik Air";
    if (/MALINDO/i.test(line)) carrier = "Malindo";

    const fltMatch = line.match(
      /FLIGHT\/DATE\s*-\s*([A-Z0-9]{2})\s*(\d{3,4})\s+(\d{2}[A-Za-z]{3}\d{2})/i,
    );
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
    if (/SEAT\s+GEN\s+NAME/i.test(line)) {
      inPaxSection = true;
      continue;
    }
    if (!inPaxSection) continue;
    if (!line.trim()) continue;

    // Format: " 26F  F  ABIDIN LINA MRS                         ID X1356564"
    const paxMatch = line.match(
      /^\s*(\d+[A-Z])\s+([MFImfi])\s+(.+?)\s{3,}([A-Z]{2})\s*([A-Z0-9]+)\s*[¥*]?\s*$/,
    );
    if (paxMatch) {
      const seat = paxMatch[1].trim();
      const gender =
        paxMatch[2].toUpperCase() === "I" ? "I" : paxMatch[2].toUpperCase();
      const name = paxMatch[3]
        .replace(/\s+(MR|MRS|MISS|MS|MSTR|DR)\.?\s*$/i, "")
        .trim();
      const nationality = paxMatch[4].trim();
      const docNumber = paxMatch[5].trim();
      const status = gender === "I" ? "checked_in" : "checked_in";

      passengers.push({
        seat_no: seat,
        gender,
        name,
        nationality,
        passport_number: docNumber,
        doc_type: "P",
        status,
        raw_line: line.trim(),
      });
    }
  }

  if (!passengers.length) return null;

  return {
    format: "lion_manifest",
    flight_number: flightNumber,
    flight_date: flightDate,
    origin,
    destination,
    carrier,
    passengers,
    no_shows: [],
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

// ==================== FORMAT DETECTOR ====================

function detectAndParseText(rawText = "", filename = "") {
  // Coba APIS dulu (paling informatif)
  const apis = parseAPISText(rawText);
  if (apis) return apis;

  // Coba ENH Enhanced Manifest
  const enh = parseENHManifest(rawText);
  if (enh) return enh;

  // Coba Lion Air Manifest
  const lion = parseLionAirManifest(rawText);
  if (lion) return lion;

  // Coba AirAsia Baggage List
  const bag = parseBaggageList(rawText);
  if (bag) return bag;

  // Fallback ke AirAsia PAX format (sudah ada)
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

  return null;
}

module.exports = {
  getFileType,
  parseManifestText,
  buildManifestSummary,
  parseAPISText,
  parseLionAirManifest,
  parseENHManifest,
  parseBaggageList,
  classifyByFilename,
  detectAndParseText,
};
