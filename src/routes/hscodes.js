const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { escapeRegex } = require('../utils/helpers');

function parseSectionNum(val) {
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) && n >= 1 && n <= 21 ? n : null;
}
function parseChapterNum(val) {
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) && n >= 1 && n <= 97 ? n : null;
}

const sectionData = [
    { sectionNumber: 1, titleId: 'Binatang hidup; Produk hewani', titleEn: 'Live animals; Animal products', chapterRange: ['01','02','03','04','05'] },
    { sectionNumber: 2, titleId: 'Produk nabati', titleEn: 'Vegetable products', chapterRange: ['06','07','08','09','10','11','12','13','14'] },
    { sectionNumber: 3, titleId: 'Lemak & minyak hewani/nabati', titleEn: 'Animal or vegetable fats and oils', chapterRange: ['15'] },
    { sectionNumber: 4, titleId: 'Makanan olahan; Minuman; Tembakau', titleEn: 'Prepared foodstuffs; Beverages; Tobacco', chapterRange: ['16','17','18','19','20','21','22','23','24'] },
    { sectionNumber: 5, titleId: 'Produk mineral', titleEn: 'Mineral products', chapterRange: ['25','26','27'] },
    { sectionNumber: 6, titleId: 'Produk industri kimia', titleEn: 'Chemical products', chapterRange: ['28','29','30','31','32','33','34','35','36','37','38'] },
    { sectionNumber: 7, titleId: 'Plastik & karet', titleEn: 'Plastics and rubber', chapterRange: ['39','40'] },
    { sectionNumber: 8, titleId: 'Kulit mentah; Barang kulit', titleEn: 'Raw hides and skins; Leather', chapterRange: ['41','42','43'] },
    { sectionNumber: 9, titleId: 'Kayu; Barang dari kayu', titleEn: 'Wood and articles of wood', chapterRange: ['44','45','46'] },
    { sectionNumber: 10, titleId: 'Pulp kayu; Kertas', titleEn: 'Pulp of wood; Paper', chapterRange: ['47','48','49'] },
    { sectionNumber: 11, titleId: 'Tekstil & produk tekstil', titleEn: 'Textiles and textile articles', chapterRange: ['50','51','52','53','54','55','56','57','58','59','60','61','62','63'] },
    { sectionNumber: 12, titleId: 'Alas kaki; Tutup kepala', titleEn: 'Footwear; Headgear', chapterRange: ['64','65','66','67'] },
    { sectionNumber: 13, titleId: 'Barang dari batu; Keramik; Kaca', titleEn: 'Articles of stone; Ceramic; Glass', chapterRange: ['68','69','70'] },
    { sectionNumber: 14, titleId: 'Mutiara; Logam mulia', titleEn: 'Pearls; Precious metals', chapterRange: ['71'] },
    { sectionNumber: 15, titleId: 'Logam tidak mulia', titleEn: 'Base metals', chapterRange: ['72','73','74','75','76','78','79','80','81','82','83'] },
    { sectionNumber: 16, titleId: 'Mesin & peralatan listrik', titleEn: 'Machinery and electrical equipment', chapterRange: ['84','85'] },
    { sectionNumber: 17, titleId: 'Kendaraan; Pesawat; Kapal', titleEn: 'Vehicles; Aircraft; Vessels', chapterRange: ['86','87','88','89'] },
    { sectionNumber: 18, titleId: 'Instrumen optik; Jam', titleEn: 'Optical instruments; Clocks', chapterRange: ['90','91','92'] },
    { sectionNumber: 19, titleId: 'Senjata & amunisi', titleEn: 'Arms and ammunition', chapterRange: ['93'] },
    { sectionNumber: 20, titleId: 'Barang serbaneka', titleEn: 'Miscellaneous manufactured articles', chapterRange: ['94','95','96'] },
    { sectionNumber: 21, titleId: 'Karya seni; Barang antik', titleEn: 'Works of art; Antiques', chapterRange: ['97'] }
];

// GET /stats
router.get('/stats', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const totalHS = await db.collection('hs_codes').countDocuments();
        const chapters = await db.collection('hs_codes').distinct('chapter');
        res.json({ 
            success: true,
            stats: { totalHS, totalChapters: chapters.length }
        });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /sections
router.get('/sections', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const sections = await Promise.all(sectionData.map(async (s) => {
            const hsCount = await db.collection('hs_codes').countDocuments({ chapter: { $in: s.chapterRange } });
            return {
                sectionNumber: s.sectionNumber,
                titleId: s.titleId,
                titleEn: s.titleEn,
                chapters: s.chapterRange,
                hsCount
            };
        }));
        res.json({ success: true, data: sections });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /sections/:num/chapters
router.get('/sections/:num/chapters', async (req, res) => {
    try {
        const num = parseSectionNum(req.params.num);
        if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid section number' });
        const section = sectionData.find(s => s.sectionNumber === num);
        if (!section) return res.status(404).json({ status: 'error', message: 'Section not found' });
        
        const db = mongoose.connection.db;
        const chapters = await db.collection('hs_codes').aggregate([
            { $match: { chapter: { $in: section.chapterRange }, hs_level: 4 } },
            { $group: { _id: '$chapter', titleId: { $first: '$description_id' }, titleEn: { $first: '$description_en' } }},
            { $sort: { _id: 1 } }
        ]).toArray();
        
        const data = await Promise.all(chapters.map(async (c) => {
            const hsCount = await db.collection('hs_codes').countDocuments({ chapter: c._id });
            return { chapterNumber: c._id, titleId: c.titleId, titleEn: c.titleEn, hsCount };
        }));
        
        res.json({ success: true, section: { sectionNumber: num, titleId: section.titleId, titleEn: section.titleEn }, data });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /chapters/:num/hs
router.get('/chapters/:num/hs', async (req, res) => {
    try {
        const num = parseChapterNum(req.params.num);
        if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid chapter number' });
        const chapter = String(num).padStart(2, '0');
        const db = mongoose.connection.db;
        const codes = await db.collection('hs_codes').find({ chapter }).sort({ hs_code: 1 }).toArray();
        const data = codes.map(c => ({
            hsCode: c.hs_code,
            descriptionId: c.description_id,
            descriptionEn: c.description_en,
            importDuty: c.import_duty || '-',
            ppn: c.ppn || '-',
            ppnbm: c.ppnbm || '-',
            level: c.hs_level
        }));
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /chapters
router.get('/chapters', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const chapters = await db.collection('hs_codes').aggregate([
            { $match: { hs_level: 4 } },
            { $group: { _id: '$chapter', titleId: { $first: '$description_id' } }},
            { $sort: { _id: 1 } }
        ]).toArray();
        res.json({ success: true, data: chapters.map(c => ({ chapterNumber: c._id, titleId: c.titleId })) });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /search
router.get('/search', async (req, res) => {
    try {
        let q = req.query.q || '';
        const limit = parseInt(req.query.limit) || 100;
        if (q.length < 2) return res.json({ success: true, data: [] });
        
        // Convert HS code tanpa titik ke format dengan titik (misal: 12071030 -> 12.07.10.30)
        const formatHsCode = (input) => {
            const digits = input.replace(/[^0-9]/g, '');
            if (digits.length >= 4) {
                let formatted = digits.slice(0, 2) + '.' + digits.slice(2, 4);
                if (digits.length >= 6) formatted += '.' + digits.slice(4, 6);
                if (digits.length >= 8) formatted += '.' + digits.slice(6, 8);
                return formatted;
            }
            return input;
        };
        
        const db = mongoose.connection.db;
        let searchQuery;
        
        // Jika input adalah angka (dengan atau tanpa titik), cari by hs_code
        if (/^[0-9.]+$/.test(q)) {
            const formatted = formatHsCode(q);
            const regex = new RegExp('^' + formatted.replace(/\./g, '\\.'), 'i');
            searchQuery = { hs_code: regex };
        } else {
            // Jika input text, cari di description
            const regex = new RegExp(escapeRegex(q), 'i');
            searchQuery = { $or: [{ description_id: regex }, { description_en: regex }] };
        }
        
        const codes = await db.collection('hs_codes').find(searchQuery).sort({ hs_code: 1 }).limit(limit).toArray();
        const data = codes.map(c => ({
            hsCode: c.hs_code,
            descriptionId: c.description_id,
            descriptionEn: c.description_en,
            importDuty: c.import_duty || '-',
            ppn: c.ppn || '-',
            ppnbm: c.ppnbm || '-',
            chapter: c.chapter,
            level: c.hs_level
        }));
        res.json({ success: true, data, query: q });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /detail/:code
router.get('/detail/:code', async (req, res) => {
    try {
        const code = decodeURIComponent(req.params.code);
        const db = mongoose.connection.db;
        const hs = await db.collection('hs_codes').findOne({ hs_code: code });
        if (!hs) return res.status(404).json({ status: 'error', message: 'Not found' });
        
        // Get parent codes
        const parts = code.split('.');
        const parents = [];
        for (let i = 1; i < parts.length; i++) {
            const parentCode = parts.slice(0, i).join('.');
            const parent = await db.collection('hs_codes').findOne({ hs_code: parentCode });
            if (parent) parents.push({ hsCode: parent.hs_code, descriptionId: parent.description_id });
        }
        
        res.json({ 
            success: true, 
            data: {
                hsCode: hs.hs_code,
                descriptionId: hs.description_id,
                descriptionEn: hs.description_en,
                importDuty: hs.import_duty || '-',
                ppn: hs.ppn || '-',
                ppnbm: hs.ppnbm || '-',
                exportDuty: hs.export_duty || '-',
                chapter: hs.chapter,
                level: hs.hs_level,
                parents
            }
        });
    } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// GET /enote/section/:num - Get ENote page for section
router.get('/enote/section/:num', (req, res) => {
    const pages = {
        1: 5, 2: 39, 3: 98, 4: 120, 5: 180, 6: 220, 7: 642, 8: 728, 9: 747, 10: 783,
        11: 845, 12: 993, 13: 1014, 14: 1066, 15: 1090, 16: 1243, 17: 1527, 18: 1571,
        19: 1681, 20: 1687, 21: 1726
    };
    const num = parseSectionNum(req.params.num);
    if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid section number' });
    const page = pages[num] || 1;
    res.json({ success: true, section: num, page, url: `/docs/enote-btki-2022.pdf#page=${page}` });
});

// GET /enote/chapter/:num - Get ENote page for chapter
router.get('/enote/chapter/:num', (req, res) => {
    const pages = {
        1: 5, 2: 9, 3: 15, 4: 25, 5: 31, 6: 39, 7: 43, 8: 51, 9: 58, 10: 64,
        11: 68, 12: 76, 13: 86, 14: 92, 15: 98, 16: 120, 17: 126, 18: 132, 19: 135, 20: 144,
        21: 152, 22: 160, 23: 168, 24: 177, 25: 180, 26: 200, 27: 209, 28: 222, 29: 432, 30: 508,
        31: 519, 32: 525, 33: 548, 34: 557, 35: 568, 36: 578, 37: 584, 38: 591, 39: 643, 40: 703,
        41: 728, 42: 737, 43: 743, 44: 747, 45: 776, 46: 779, 47: 783, 48: 788, 49: 835, 50: 845,
        51: 849, 52: 857, 53: 868, 54: 876, 55: 885, 56: 896, 57: 908, 58: 915, 59: 936, 60: 948,
        61: 952, 62: 970, 63: 982, 64: 993, 65: 1001, 66: 1007, 67: 1010, 68: 1014, 69: 1029, 70: 1043,
        71: 1066, 72: 1094, 73: 1131, 74: 1159, 75: 1173, 76: 1180, 77: 1185, 78: 1190, 79: 1195, 80: 1200,
        81: 1205, 82: 1216, 83: 1232, 84: 1250, 85: 1447, 86: 1531, 87: 1540, 88: 1560, 89: 1565, 90: 1571,
        91: 1654, 92: 1670, 93: 1681, 94: 1687, 95: 1698, 96: 1708, 97: 1726
    };
    const num = parseChapterNum(req.params.num);
    if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid chapter number' });
    const page = pages[num] || 1;
    res.json({ success: true, chapter: num, page, url: `/docs/enote-btki-2022.pdf#page=${page}` });
});

// GET /notes/section/:num - Get section notes
router.get('/notes/section/:num', async (req, res) => {
    try {
        const num = parseSectionNum(req.params.num);
        if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid section number' });
        const notes = {
            1: {
                title: "BAGIAN I - HEWAN (BINATANG) HIDUP; PRODUK HEWANI",
                note: "1. Setiap referensi dalam bagian ini yang berkaitan dengan genus atau spesies hewan (binatang) tertentu, kecuali bila konteksnya menentukan lain, mencakup referensi terhadap hewan muda (anak hewan) dari genus atau spesies tersebut.\n\n2. Kecuali bila konteksnya menentukan lain, setiap referensi terhadap produk \"kering\" di seluruh Nomenklatur ini meliputi juga produk yang telah didehidrasi (dihilangkan airnya), dievaporasi (diuapkan), atau dikeringkan dengan cara pembekuan."
            },
            2: {
                title: "BAGIAN II - PRODUK NABATI",
                note: "1. Dalam Bagian ini, istilah \"pelet\" berarti produk yang telah diaglomerasi baik secara langsung dengan cara dikempa maupun dengan penambahan bahan pengikat dengan proporsi tidak lebih dari 3% dari beratnya."
            }
        };
        
        if (!notes[num]) {
            return res.json({ success: true, section: num, title: null, note: "Catatan bagian ini belum tersedia." });
        }
        
        res.json({ success: true, section: num, ...notes[num] });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// GET /notes/chapter/:num - Get chapter notes
router.get('/notes/chapter/:num', async (req, res) => {
    try {
        const num = parseChapterNum(req.params.num);
        if (num === null) return res.status(400).json({ status: 'error', message: 'Invalid chapter number' });
        const notes = {
            1: {
                title: "BAB 1 - HEWAN (BINATANG) HIDUP",
                note: "1. Bab ini meliputi semua hewan (binatang) hidup, kecuali:\n(a) Ikan dan krustase (udang-udangan), moluska (hewan lunak), dan invertebrata air (hewan air yang tidak bertulang belakang) lainnya dari pos No. 03.01, 03.06 atau 03.07;\n(b) Budidaya jasad renik dan produk lainnya dari pos No. 30.02; dan\n(c) Hewan (binatang) dari pos No. 95.08."
            },
            2: {
                title: "BAB 2 - DAGING DAN SISANYA YANG DAPAT DIMAKAN",
                note: "1. Bab ini tidak meliputi:\n(a) Produk dari jenis yang diterangkan dalam pos 02.01 sampai dengan 02.08 atau 02.10, yang tidak layak atau tidak cocok untuk dikonsumsi manusia;\n(b) Usus, kandung kemih, atau lambung hewan (pos 05.04) atau darah hewan (pos 05.11 atau 30.02); atau\n(c) Lemak hewan, selain produk dari pos 02.09 (Bab 15)."
            }
        };
        
        if (!notes[num]) {
            return res.json({ success: true, chapter: num, title: null, note: "Catatan bab ini belum tersedia." });
        }
        
        res.json({ success: true, chapter: num, ...notes[num] });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// GET /ai-search - Pencarian Semantik berbasis AI menggunakan Gemini API
router.get('/ai-search', async (req, res) => {
    try {
        const q = req.query.q || '';
        if (q.length < 2) return res.json({ success: true, data: [] });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(400).json({ 
                success: false, 
                message: 'Fitur Cari dengan AI dinonaktifkan. Silakan isi GEMINI_API_KEY di file .env server.' 
            });
        }

        const prompt = `Anda adalah Asisten Bea Cukai dan Ahli Klasifikasi HS Code (BTKI 2022).
Petugas bea cukai sedang mencari HS Code yang tepat untuk barang dengan deskripsi berikut: "${q}".

Tugas Anda:
1. Temukan 3 hingga 5 HS Code (format 8 digit seperti "6210.10.00" atau "8517.13.00") atau minimal Bab (2 digit seperti "62" atau "85") yang paling cocok dengan deskripsi barang tersebut.
2. Untuk setiap kode, berikan skor keyakinan (confidence score) antara 0 hingga 100 berdasarkan tingkat kecocokan.
3. Berikan alasan singkat dalam Bahasa Indonesia (maksimal 2 kalimat) mengapa kode tersebut dipilih (misal: "Baju pemadam kebakaran terbuat dari serat sintetis pelindung luar dan masuk ke bab pakaian pelindung").

Kembalikan respons HANYA dalam format JSON array yang valid, tanpa markdown wrapper (seperti \`\`\`json) dan tanpa penjelasan lain.
Format JSON wajib seperti ini:
[
  { "hsCode": "6210.10.00", "confidence": 95, "reasoning": "Pakaian pelindung pemadam kebakaran masuk pos pakaian khusus" },
  { "hsCode": "6203.43.00", "confidence": 75, "reasoning": "Baju celana pemadam dari serat sintetik" }
]`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error (HTTP ${response.status}): ${errText}`);
        }

        const resData = await response.json();
        let suggestions = [];
        try {
            const textResult = resData.candidates[0].content.parts[0].text;
            suggestions = JSON.parse(textResult.trim());
        } catch (parseErr) {
            console.error('Gagal parse JSON dari Gemini:', parseErr, resData);
            throw new Error('Gagal memproses respons dari AI.');
        }

        if (!Array.isArray(suggestions)) {
            suggestions = [];
        }

        const db = mongoose.connection.db;
        const finalData = [];

        for (const item of suggestions) {
            let cleanedCode = item.hsCode.replace(/[^0-9]/g, '');
            if (cleanedCode.length === 8) {
                cleanedCode = cleanedCode.slice(0, 2) + '.' + cleanedCode.slice(2, 4) + '.' + cleanedCode.slice(4, 6) + '.' + cleanedCode.slice(6, 8);
            }

            let queryObj = { hs_code: cleanedCode };
            if (cleanedCode.length === 2) {
                queryObj = { chapter: cleanedCode, hs_level: 4 };
            }

            const dbItems = await db.collection('hs_codes').find(queryObj).limit(2).toArray();
            
            for (const dbItem of dbItems) {
                // Cegah duplikasi hasil
                if (finalData.some(d => d.hsCode === dbItem.hs_code)) continue;

                finalData.push({
                    hsCode: dbItem.hs_code,
                    descriptionId: dbItem.description_id,
                    descriptionEn: dbItem.description_en,
                    importDuty: dbItem.import_duty || '-',
                    ppn: dbItem.ppn || '-',
                    ppnbm: dbItem.ppnbm || '-',
                    chapter: dbItem.chapter,
                    level: dbItem.hs_level,
                    isAiResult: true,
                    aiConfidence: item.confidence,
                    aiReasoning: item.reasoning
                });
            }
        }

        res.json({ success: true, data: finalData, query: q });
    } catch (err) {
        console.error('AI Search Error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

module.exports = router;
