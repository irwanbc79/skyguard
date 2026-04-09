/**
 * Shared constants untuk SkyGuard Intelligence
 * Satu sumber kebenaran untuk data referensi yang digunakan lintas modul.
 */

// ─── KODE KANTOR BEA & CUKAI ─────────────────────────────────────────────────
// Sumber: pakgiman.com/kantor-bea-dan-cukai/
const KANTOR_MAP = {
  // === KPU BC ===
  "040300": "KPU Tanjung Priok",
  "020400": "KPU Batam",
  "050100": "KPU Soekarno-Hatta",
  // === Kanwil ===
  "010000": "Kanwil Sumatera Utara",
  "020000": "Kanwil Kepulauan Riau",
  "030000": "Kanwil Sumatera Bag. Timur",
  "040000": "Kanwil Jakarta",
  "050000": "Kanwil Jawa Barat",
  "060000": "Kanwil Jateng & DIY",
  "070000": "Kanwil Jawa Timur I",
  "080000": "Kanwil Bali, NTB & NTT",
  "090000": "Kanwil Kalimantan Bag. Barat",
  "100000": "Kanwil Kalimantan Bag. Timur",
  "110000": "Kanwil Sulawesi Bag. Selatan",
  "120000": "Kanwil Maluku",
  "130000": "Kanwil Aceh",
  "140000": "Kanwil Riau",
  "150000": "Kanwil Banten",
  "160000": "Kanwil Jawa Timur II",
  "170000": "Kanwil Sumatera Bag. Barat",
  "180000": "Kanwil Kalimantan Bag. Selatan",
  "190000": "Kanwil Sulawesi Bag. Utara",
  "200000": "Kanwil Papua",
  // === KPPBC Sumatera Utara ===
  "010100": "Kuala Namu",
  "010700": "Belawan",
  "010800": "Medan",
  "011000": "Pematangsiantar",
  "011100": "Teluk Nibung",
  "011200": "Kuala Tanjung",
  "011300": "Sibolga",
  "011500": "Teluk Bayur",
  "011600": "Lab BC Medan",
  // === KPPBC Kepulauan Riau & Riau ===
  "020100": "Tanjung Balai Karimun",
  "020500": "Tanjung Pinang",
  "020900": "Dumai",
  "021100": "Bengkalis",
  "021200": "Pekanbaru",
  "021500": "Tembilahan",
  "021800": "PSO Batam",
  "021900": "PSO Tanjung Balai Karimun",
  // === KPPBC Sumatera Bag. Timur ===
  "030100": "Palembang",
  "030200": "Bengkulu",
  "030300": "Pangkal Pinang",
  "030500": "Tanjung Pandan",
  "030600": "Jambi",
  "030700": "Bandar Lampung",
  // === KPPBC Jakarta ===
  "040400": "Jakarta",
  "040500": "Lab BC Jakarta",
  "040600": "Kantor Pos Pasar Baru",
  "040700": "PSO Tanjung Priok",
  // === KPPBC Jawa Barat ===
  "050300": "Bogor",
  "050400": "Merak",
  "050500": "Bandung",
  "050600": "Tasikmalaya",
  "050700": "Cirebon",
  "050800": "Purwakarta",
  "050900": "Bekasi",
  "051000": "Cikarang",
  // === KPPBC Jateng & DIY ===
  "060100": "Tanjung Emas",
  "060300": "Kudus",
  "060400": "Cilacap",
  "060600": "Surakarta",
  "060700": "Yogyakarta",
  "060800": "Semarang",
  "061000": "Tegal",
  "061100": "Magelang",
  "062000": "Purwokerto",
  // === KPPBC Jawa Timur I ===
  "070100": "Tanjung Perak",
  "070200": "Madura",
  "070300": "Gresik",
  "070400": "Bojonegoro",
  "070500": "Juanda",
  "070600": "Malang",
  "070700": "Blitar",
  "070800": "Kediri",
  "071000": "Madiun",
  "071100": "Jember",
  "071200": "Probolinggo",
  "071300": "Pasuruan",
  "071400": "Lab BC Surabaya",
  "071500": "Sidoarjo",
  // === KPPBC Bali, NTB & NTT ===
  "080100": "Ngurah Rai",
  "080200": "Denpasar",
  "080300": "Mataram",
  "080400": "Sumbawa",
  "080500": "Kupang",
  "080700": "Maumere",
  "081400": "Atambua",
  // === KPPBC Kalimantan Bag. Barat ===
  "090100": "Pontianak",
  "090200": "Entikong",
  "090400": "Ketapang",
  "090500": "Sintete",
  "090700": "Sampit",
  "090800": "Pangkalan Bun",
  "090900": "Pulang Pisau",
  "091000": "Nanga Badau",
  "092000": "Jagoi Babang",
  // === KPPBC Kalimantan Bag. Timur & Selatan ===
  "100100": "Banjarmasin",
  "100200": "Kotabaru",
  "100300": "Balikpapan",
  "100500": "Samarinda",
  "100600": "Bontang",
  "100800": "Tarakan",
  "100900": "Nunukan",
  "101000": "Sangata",
  // === KPPBC Sulawesi ===
  "110100": "Makassar",
  "110300": "Parepare",
  "110400": "Malili",
  "110600": "Kendari",
  "110800": "Pantoloan",
  "110900": "Morowali",
  "111000": "Luwuk",
  "111100": "Bitung",
  "111200": "Manado",
  "111300": "Gorontalo",
  "111400": "PSO Pantoloan",
  // === KPPBC Maluku & Papua ===
  "120100": "Ambon",
  "120200": "Ternate",
  "120300": "Sorong",
  "120400": "Manokwari",
  "120600": "Jayapura",
  "120700": "Merauke",
  "120800": "Amamapare",
  "120900": "Biak",
  "121000": "Tual",
  "121100": "PSO Sorong",
  "122300": "Babo",
  // === KPPBC Aceh ===
  "130100": "Banda Aceh",
  "130300": "Sabang",
  "130400": "Meulaboh",
  "130500": "Lhokseumawe",
  "130600": "Kuala Langsa",
  // === KPPBC Banten & Jatim II ===
  "150300": "Tangerang",
  "160200": "Marunda",
  "160700": "Banyuwangi",
};

/**
 * Kembalikan nama kantor dari kode, fallback ke "Kantor <kode>"
 * @param {string|number} code
 * @returns {string}
 */
function getKantorName(code) {
  if (!code) return "-";
  return KANTOR_MAP[String(code)] || `Kantor ${code}`;
}

// ─── KOORDINAT BANDARA (IATA → {lat, lng, name}) ─────────────────────────────
const AIRPORTS = {
  KNO: { lat: 3.6422, lng: 98.8853, name: "Kualanamu, Medan" },
  KUL: { lat: 2.7456, lng: 101.7099, name: "KLIA, Kuala Lumpur" },
  SIN: { lat: 1.3644, lng: 103.9915, name: "Changi, Singapore" },
  CGK: { lat: -6.1256, lng: 106.6558, name: "Soekarno-Hatta, Jakarta" },
  SUB: { lat: -7.3798, lng: 112.7868, name: "Juanda, Surabaya" },
  DPS: { lat: -8.7482, lng: 115.1672, name: "Ngurah Rai, Bali" },
  PEN: { lat: 5.2972, lng: 100.2769, name: "Penang Intl" },
  JHB: { lat: 1.6411, lng: 103.6696, name: "Senai, Johor Bahru" },
  BKK: { lat: 13.6811, lng: 100.7472, name: "Suvarnabhumi, Bangkok" },
  HKG: { lat: 22.308, lng: 113.9185, name: "Hong Kong Intl" },
  ICN: { lat: 37.4602, lng: 126.4407, name: "Incheon, Seoul" },
  NRT: { lat: 35.7647, lng: 140.3864, name: "Narita, Tokyo" },
  HND: { lat: 35.5494, lng: 139.7798, name: "Haneda, Tokyo" },
  PVG: { lat: 31.1434, lng: 121.8052, name: "Pudong, Shanghai" },
  CAN: { lat: 23.3924, lng: 113.2988, name: "Baiyun, Guangzhou" },
  SZX: { lat: 22.6393, lng: 113.8107, name: "Shenzhen Intl" },
  PEK: { lat: 40.0799, lng: 116.6031, name: "Capital, Beijing" },
  SYD: { lat: -33.9461, lng: 151.1772, name: "Sydney Intl" },
  MEL: { lat: -37.6733, lng: 144.8431, name: "Melbourne Intl" },
  JED: { lat: 21.6796, lng: 39.1564, name: "Jeddah Intl" },
  MED: { lat: 24.5534, lng: 39.7051, name: "Madinah Intl" },
  DOH: { lat: 25.2731, lng: 51.6081, name: "Hamad, Doha" },
  DXB: { lat: 25.2528, lng: 55.3644, name: "Dubai Intl" },
  AUH: { lat: 24.433, lng: 54.6511, name: "Abu Dhabi Intl" },
  DEL: { lat: 28.5562, lng: 77.1, name: "Indira Gandhi, Delhi" },
  BOM: { lat: 19.0887, lng: 72.8679, name: "Mumbai Intl" },
  CMB: { lat: 7.1808, lng: 79.8841, name: "Colombo Intl" },
  DAC: { lat: 23.8433, lng: 90.3978, name: "Dhaka Intl" },
  RGN: { lat: 16.9073, lng: 96.1332, name: "Yangon Intl" },
  SGN: { lat: 10.8188, lng: 106.6519, name: "Tan Son Nhat, HCMC" },
  HAN: { lat: 21.2212, lng: 105.807, name: "Noi Bai, Hanoi" },
  MNL: { lat: 14.5086, lng: 121.0198, name: "NAIA, Manila" },
  TPE: { lat: 25.0797, lng: 121.2342, name: "Taoyuan, Taipei" },
  BTJ: { lat: 5.5239, lng: 95.4206, name: "Sultan Iskandar Muda, Aceh" },
  PKU: { lat: 0.4606, lng: 101.4455, name: "Sultan Syarif Kasim, Pekanbaru" },
  PDG: { lat: -0.787, lng: 100.2808, name: "Minangkabau, Padang" },
  PLM: { lat: -2.8978, lng: 104.6997, name: "Sultan M. Badaruddin, Palembang" },
  BTH: { lat: 1.1212, lng: 104.1191, name: "Hang Nadim, Batam" },
  BPN: { lat: -1.2683, lng: 116.8946, name: "Sultan Aji M. Sulaiman, Balikpapan" },
  UPG: { lat: -5.0613, lng: 119.5538, name: "Sultan Hasanuddin, Makassar" },
  MDC: { lat: 1.5493, lng: 124.9262, name: "Sam Ratulangi, Manado" },
  SOC: { lat: -7.516, lng: 110.7565, name: "Adisumarmo, Solo" },
  JOG: { lat: -7.7882, lng: 110.4317, name: "YIA, Yogyakarta" },
  SRG: { lat: -6.9714, lng: 110.3741, name: "Ahmad Yani, Semarang" },
  LOP: { lat: -8.7573, lng: 116.2769, name: "Lombok Intl" },
  TKG: { lat: -5.2405, lng: 105.1759, name: "Radin Inten, Lampung" },
  BDO: { lat: -6.9006, lng: 107.5764, name: "Husein Sastranegara, Bandung" },
  AMQ: { lat: -3.7103, lng: 128.0892, name: "Pattimura, Ambon" },
  DJJ: { lat: -2.5769, lng: 140.5163, name: "Sentani, Jayapura" },
  AMS: { lat: 52.3086, lng: 4.7639, name: "Schiphol, Amsterdam" },
  IST: { lat: 41.2753, lng: 28.7519, name: "Istanbul Intl" },
  LHR: { lat: 51.47, lng: -0.4543, name: "Heathrow, London" },
};

// ─── RISK LEVELS ──────────────────────────────────────────────────────────────
const RISK_LEVELS = ["HIGH", "MEDIUM", "LOW"];

// ─── SUSPECT STATUS ───────────────────────────────────────────────────────────
const SUSPECT_STATUS = ["ACTIVE", "MONITORING", "CLEARED", "ARRESTED"];

// ─── SUSPECT CATEGORIES ───────────────────────────────────────────────────────
const SUSPECT_CATEGORIES = [
  "NARKOTIKA",
  "BEA_CUKAI",
  "PENYELUNDUPAN",
  "CONTRABAND",
  "LAINNYA",
];

// ─── PMI HUBS (Pekerja Migran Indonesia — koridor indikasi) ───────────────────
// Satu sumber kebenaran; digunakan di passengers.js, dashboard.js, dsb.
const PMI_HUBS = [
  // ASEAN
  "KUL",
  "SIN",
  // Timur Tengah
  "JED",
  "RUH",
  "DMM",
  "DOH",
  "DXB",
  "AUH",
  "KWI",
  "MCT",
  "BAH",
  // Asia Timur
  "HKG",
  "TPE",
  "ICN",
  "PUS",
];

// ─── NOTIFICATION TYPES ───────────────────────────────────────────────────────
const NOTIFICATION_TYPES = [
  "SUSPECT_DETECTED",
  "SUSPECT_CREATED",
  "MANIFEST_RECEIVED",
  "CARGO_SUSPECT_LINK",
  "HIGH_RISK_PASSENGER",
  "SYSTEM",
];

const NOTIFICATION_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

module.exports = {
  KANTOR_MAP,
  getKantorName,
  AIRPORTS,
  RISK_LEVELS,
  SUSPECT_STATUS,
  SUSPECT_CATEGORIES,
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  PMI_HUBS,
};
