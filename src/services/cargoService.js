const { escapeRegex } = require('../utils/helpers');
const Cnpibk = require('../models/cnpibk');
const UploadLog = require('../models/UploadLog');
const xlsx = require('xlsx');
const fs = require('fs');

// Parse date dari berbagai format
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const str = String(val).trim();
  // Format: DD-MM-YYYY atau YYYY-MM-DD
  if (str.match(/^\d{2}-\d{2}-\d{4}$/)) {
    const [d, m, y] = str.split('-');
    return new Date(y, m - 1, d);
  }
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(str);
  }
  return null;
}

// Parse number
function parseNum(val) {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

// Import CSV/Excel dengan deduplikasi
async function importCnpibk(filePath, uploadedBy = 'system') {
  const stats = { total: 0, new: 0, duplicate: 0, error: 0 };
  const batch = `CNPIBK_${Date.now()}`;
  
  // Baca file
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  
  stats.total = rows.length;
  
  for (const row of rows) {
    try {
      // Map kolom dari CSV (header dengan semicolon separator sudah di-parse xlsx)
      const nomorAju = String(row['Nomor Aju'] || row.nomor_aju || '').trim();
      if (!nomorAju) { stats.error++; continue; }
      
      const doc = {
        nomor_aju: nomorAju,
        jenis_aju: String(row['Jenis Aju'] || row.jenis_aju || 'CN').trim(),
        nomor_barang: String(row['Nomor Barang'] || row.nomor_barang || '').trim(),
        nomor_pibk: String(row['Nomor PIBK'] || row.nomor_pibk || '').trim(),
        tanggal_pibk: parseDate(row['Tanggal PIBK'] || row.tanggal_pibk),
        nomor_kantong: String(row['Nomor Kantong'] || row.nomor_kantong || '').trim(),
        npwp_pemberitahu: String(row['NPWP Pemberitahu'] || row.npwp_pemberitahu || '').trim(),
        nama_pemberitahu: String(row['Nama Pemberitahu'] || row.nama_pemberitahu || '').trim(),
        nama_gudang: String(row['Nama Gudang'] || row.nama_gudang || '').trim(),
        kode_kantor: String(row['Kode Kantor'] || row.kode_kantor || '010100').trim(),
        nama_penerima: String(row['Nama Penerima'] || row.nama_penerima || '').trim(),
        nomor_identitas_penerima: String(row['Nomor Identitas Penerima'] || row.nomor_identitas_penerima || '').trim(),
        alamat_penerima: String(row['Alamat Penerima'] || row.alamat_penerima || '').trim(),
        nama_pengirim: String(row['Nama Pengirim'] || row.nama_pengirim || '').trim(),
        nomor_identitas_pengirim: String(row['Nomor Identitas Pengirim'] || row.nomor_identitas_pengirim || '').trim(),
        alamat_pengirim: String(row['Alamat Pengirim'] || row.alamat_pengirim || '').trim(),
        tanggal_hawb: parseDate(row['Tanggal HAWB'] || row.tanggal_hawb),
        current_status: String(row['Current Status'] || row.current_status || '').trim(),
        nama_pdtt: String(row['Nama PDTT'] || row.nama_pdtt || '').trim(),
        nip_pdtt: String(row['NIP PDTT'] || row.nip_pdtt || '').trim(),
        cif_awal: parseNum(row['CIF Awal'] || row.cif_awal),
        cif_akhir: parseNum(row['CIF Akhir'] || row.cif_akhir),
        fob_awal: parseNum(row['FOB Awal'] || row.fob_awal),
        fob_akhir: parseNum(row['FOB Akhir'] || row.fob_akhir),
        nomor_sppbmcp: String(row['Nomor SPPBMCP'] || row.nomor_sppbmcp || '').trim(),
        tanggal_sppbmcp: parseDate(row['Tanggal SPPBMCP'] || row.tanggal_sppbmcp),
        nomor_sppb: String(row['Nomor SPPB'] || row.nomor_sppb || '').trim(),
        tanggal_sppb: parseDate(row['Tanggal SPPB'] || row.tanggal_sppb),
        kode_billing: String(row['Kode Billing'] || row.kode_billing || '').trim(),
        kode_billing_sptnp: String(row['Kode Billing SPTNP'] || row.kode_billing_sptnp || '').trim(),
        upload_batch: batch,
        uploaded_by: uploadedBy,
        uploaded_at: new Date()
      };
      
      // Upsert berdasarkan nomor_aju (deduplikasi)
      const result = await Cnpibk.findOneAndUpdate(
        { nomor_aju: doc.nomor_aju },
        { $set: doc },
        { upsert: true, new: true, rawResult: true }
      );
      
      if (result.lastErrorObject?.updatedExisting) {
        stats.duplicate++;
      } else {
        stats.new++;
      }
    } catch (e) {
      console.error('Row error:', e.message);
      stats.error++;
    }
  }
  
  // Log upload
  await UploadLog.create({
    uploaded_by: uploadedBy,
    filename: filePath.split('/').pop(),
    total_records: stats.total,
    new_records: stats.new,
    duplicate_records: stats.duplicate,
    error_records: stats.error,
    module: 'cnpibk',
    notes: `Batch: ${batch}`
  });
  
  return stats;
}

// Get statistics untuk Executive Dashboard
async function getStats() {
  const [
    totalRecords,
    totalCIF,
    statusBreakdown,
    topPemberitahu,
    topPdtt,
    topPenerima,
    monthlyTrend,
    highValueTransactions,
    recentUploads
  ] = await Promise.all([
    // Total records
    Cnpibk.countDocuments(),
    
    // Total CIF value
    Cnpibk.aggregate([
      { $group: { _id: null, total: { $sum: '$cif_akhir' } } }
    ]),
    
    // Status breakdown
    Cnpibk.aggregate([
      { $group: { _id: '$current_status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    
    // Top 10 Pemberitahu (PJT)
    Cnpibk.aggregate([
      { $match: { nama_pemberitahu: { $nin: ['', null] } } },
      { $group: { 
        _id: '$nama_pemberitahu',
        npwp: { $first: '$npwp_pemberitahu' },
        count: { $sum: 1 },
        totalCIF: { $sum: '$cif_akhir' }
      }},
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    
    // Top 10 PDTT (Petugas)
    Cnpibk.aggregate([
      { $match: { nip_pdtt: { $nin: ['', null] } } },
      { $group: { 
        _id: '$nip_pdtt',
        nama: { $first: '$nama_pdtt' },
        count: { $sum: 1 },
        totalCIF: { $sum: '$cif_akhir' }
      }},
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    
    // Top 10 Penerima (frequent importers)
    Cnpibk.aggregate([
      { $match: { nama_penerima: { $nin: ['', null] } } },
      { $group: { 
        _id: '$nama_penerima',
        count: { $sum: 1 },
        totalCIF: { $sum: '$cif_akhir' }
      }},
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    
    // Monthly trend
    Cnpibk.aggregate([
      { $match: { tanggal_hawb: { $ne: null } } },
      { $group: {
        _id: { year: { $year: '$tanggal_hawb' }, month: { $month: '$tanggal_hawb' } },
        count: { $sum: 1 },
        totalCIF: { $sum: '$cif_akhir' }
      }},
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]),
    
    // High value transactions (CIF > $500)
    Cnpibk.aggregate([
      { $match: { cif_akhir: { $gte: 500 } } },
      { $sort: { cif_akhir: -1 } },
      { $limit: 20 },
      { $project: {
        nomor_aju: 1, nama_penerima: 1, nama_pengirim: 1,
        cif_akhir: 1, current_status: 1, tanggal_hawb: 1, nama_pemberitahu: 1
      }}
    ]),
    
    // Recent uploads
    UploadLog.find({ module: 'cnpibk' }).sort({ createdAt: -1 }).limit(5)
  ]);
  
  return {
    totalRecords,
    totalCIF: totalCIF[0]?.total || 0,
    statusBreakdown,
    topPemberitahu,
    topPdtt,
    topPenerima,
    monthlyTrend,
    highValueTransactions,
    recentUploads,
    dataRange: await getDataRange()
  };
}

// Get data range
async function getDataRange() {
  const result = await Cnpibk.aggregate([
    { $group: {
      _id: null,
      minDate: { $min: '$tanggal_hawb' },
      maxDate: { $max: '$tanggal_hawb' }
    }}
  ]);
  return result[0] || { minDate: null, maxDate: null };
}

// Search CN-PIBK
async function search(query) {
  const filter = {};
  
  if (query.nomor_aju) filter.nomor_aju = new RegExp(escapeRegex(query.nomor_aju), 'i');
  if (query.nama_penerima) filter.nama_penerima = new RegExp(escapeRegex(query.nama_penerima), 'i');
  if (query.nama_pengirim) filter.nama_pengirim = new RegExp(escapeRegex(query.nama_pengirim), 'i');
  if (query.nama_pemberitahu) filter.nama_pemberitahu = new RegExp(escapeRegex(query.nama_pemberitahu), 'i');
  if (query.nip_pdtt) filter.nip_pdtt = query.nip_pdtt;
  if (query.status) filter.current_status = new RegExp(escapeRegex(query.status), 'i');
  if (query.cif_min) filter.cif_akhir = { $gte: parseFloat(query.cif_min) };
  if (query.cif_max) filter.cif_akhir = { ...filter.cif_akhir, $lte: parseFloat(query.cif_max) };
  
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 50;
  const skip = (page - 1) * limit;
  
  const [data, total] = await Promise.all([
    Cnpibk.find(filter).sort({ tanggal_hawb: -1 }).skip(skip).limit(limit),
    Cnpibk.countDocuments(filter)
  ]);
  
  return { data, total, page, limit, pages: Math.ceil(total / limit) };
}

// Get single record by nomor_aju
async function getByNomorAju(nomorAju) {
  return Cnpibk.findOne({ nomor_aju: nomorAju });
}

// Get upload logs
async function getUploadLogs() {
  return UploadLog.find({ module: 'cnpibk' }).sort({ createdAt: -1 }).limit(20);
}

module.exports = {
  importCnpibk,
  getStats,
  search,
  getByNomorAju,
  getUploadLogs,
  getDataRange
};
