/**
 * seed_pbc_officers.js
 * Jalankan SEKALI: node seed_pbc_officers.js
 * Seed data 26 petugas PBC dari SKP KPPBC TMP B Kualanamu 2026
 */

require("dotenv").config();
const mongoose = require("mongoose");
const PbcOfficer = require("./src/models/PbcOfficer");

const OFFICERS = [
  // NIP #1 sebagian tertutup di screenshot — verifikasi nama dengan Kasubbag Umum
  { no: 1,  nip: "198504092010121004", nama: "(VERIFIKASI NAMA — NIP: 198504092010121004)", pangkat: "PENATA TK.I", golongan: "III d", nomor_skp: "SKP-1/BC.15.7/JF/2026" },
  { no: 2,  nip: "198512142010121002", nama: "DETRISNO DASWIR",                             pangkat: "PENATA TK.I",      golongan: "III d", nomor_skp: "SKP-2/BC.15.7/JF/2026" },
  { no: 3,  nip: "197909222001121002", nama: "SEPTIAJI WIBOWO",                             pangkat: "PENATA TK.I",      golongan: "III d", nomor_skp: "SKP-3/BC.15.7/JF/2026" },
  { no: 4,  nip: "197006131992031001", nama: "TOMMY ROBERT HARAPAN SIMATUPANG",             pangkat: "PENATA TK.I",      golongan: "III d", nomor_skp: "SKP-4/BC.15.7/JF/2026" },
  { no: 5,  nip: "198707312010121003", nama: "YULIUS ANDRI SULISTYANTO",                   pangkat: "PENATA TK.I",      golongan: "III d", nomor_skp: "SKP-5/BC.15.7/JF/2026" },
  { no: 6,  nip: "197906201999031001", nama: "ANHAR",                                       pangkat: "PENATA",           golongan: "III c", nomor_skp: "SKP-6/BC.15.7/JF/2026" },
  { no: 7,  nip: "197804032000011002", nama: "APRILIUS DWI KURNIAWAN",                     pangkat: "PENATA",           golongan: "III c", nomor_skp: "SKP-7/BC.15.7/JF/2026" },
  { no: 8,  nip: "198011242003121001", nama: "FERI FERDIANSYAH",                           pangkat: "PENATA",           golongan: "III c", nomor_skp: "SKP-8/BC.15.7/JF/2026" },
  { no: 9,  nip: "197910132003121001", nama: "RICKY WARDANA SAPUTRA",                      pangkat: "PENATA",           golongan: "III c", nomor_skp: "SKP-9/BC.15.7/JF/2026" },
  { no: 10, nip: "198505252007011003", nama: "TONGKU ACHMAD TAUFIQ, S.E.",                 pangkat: "PENATA",           golongan: "III c", nomor_skp: "SKP-10/BC.15.7/JF/2026" },
  { no: 11, nip: "198702252007011003", nama: "AHMAD SULAIMAN SIREGAR",                     pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-11/BC.15.7/JF/2026" },
  { no: 12, nip: "198211062002121002", nama: "DIAN EKA SAPUTRA",                           pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-12/BC.15.7/JF/2026" },
  // NIP #13 — 17 digit di screenshot, tambahkan 0 di posisi ke-14 sesuai format standar NIP
  { no: 13, nip: "197909152000121002", nama: "DIKI, S.E.",                                 pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-13/BC.15.7/JF/2026" },
  { no: 14, nip: "197705122005011001", nama: "IRVAN",                                      pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-14/BC.15.7/JF/2026" },
  { no: 15, nip: "197912302001121003", nama: "IRWAN",                                      pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-15/BC.15.7/JF/2026" },
  { no: 16, nip: "198504182005011001", nama: "RAFIAN DAVID IHUTAN SIREGAR",                pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-16/BC.15.7/JF/2026" },
  { no: 17, nip: "198505072005011001", nama: "RAHMADSYAH BUDI",                            pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-17/BC.15.7/JF/2026" },
  { no: 18, nip: "198705092007011002", nama: "REZA RYAN MEIFANDA",                         pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-18/BC.15.7/JF/2026" },
  { no: 19, nip: "197904012000121002", nama: "SYAMSUL ARIFIN",                             pangkat: "PENATA MUDA TK.I", golongan: "III b", nomor_skp: "SKP-19/BC.15.7/JF/2026" },
  { no: 20, nip: "198909182010011004", nama: "MUHAMMAD SIDDIQ",                            pangkat: "PENATA MUDA",      golongan: "III a", nomor_skp: "SKP-20/BC.15.7/JF/2026" },
  { no: 21, nip: "199212152010121001", nama: "DANIEL ANDREO SIAGIAN, S.M.",               pangkat: "PENATA MUDA",      golongan: "III a", nomor_skp: "SKP-21/BC.15.7/JF/2026" },
  { no: 22, nip: "199602212015021002", nama: "HASIAN AHMADY DAULAY",                       pangkat: "PENGATUR TK. I",   golongan: "II d",  nomor_skp: "SKP-22/BC.15.7/JF/2026" },
  { no: 23, nip: "199502122015021003", nama: "BINCAR RAKUTTA BANGUN",                      pangkat: "PENGATUR TK. I",   golongan: "II d",  nomor_skp: "SKP-23/BC.15.7/JF/2026" },
  { no: 24, nip: "199210172013101002", nama: "HARLEY MAURID SIMANJUNTAK",                  pangkat: "PENGATUR TK. I",   golongan: "II d",  nomor_skp: "SKP-24/BC.15.7/JF/2026" },
  { no: 25, nip: "199509282015021003", nama: "MAS SEPTA ARTA DANIEL MANIK",               pangkat: "PENGATUR TK. I",   golongan: "II d",  nomor_skp: "SKP-25/BC.15.7/JF/2026" },
  { no: 26, nip: "199412152015021002", nama: "MUHAMMAD KURNIATAMA",                        pangkat: "PENGATUR TK. I",   golongan: "II d",  nomor_skp: "SKP-26/BC.15.7/JF/2026" },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("MongoDB connected.");

  let inserted = 0, skipped = 0;
  for (const o of OFFICERS) {
    try {
      await PbcOfficer.updateOne(
        { nip: o.nip },
        { $setOnInsert: { nip: o.nip, nama: o.nama, pangkat: o.pangkat, golongan: o.golongan, nomor_skp: o.nomor_skp, tahun: 2026, is_active: true } },
        { upsert: true }
      );
      inserted++;
      console.log(`  [${o.no}] ${o.nama}`);
    } catch (e) {
      console.warn(`  SKIP [${o.no}] ${o.nama}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`\nSelesai: ${inserted} petugas diproses, ${skipped} dilewati.`);
  console.log("CATATAN: Verifikasi nama No.1 (NIP 198504092010121004) dan NIP No.13 (DIKI, S.E.).");
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
