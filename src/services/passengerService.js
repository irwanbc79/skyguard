const Passenger = require('../models/Passenger');
const UploadLog = require('../models/UploadLog');

function calculateRiskScore(totalVisits, uniqueDevices, billingCount) {
  const score = (totalVisits * 2) + (uniqueDevices * 3) + (billingCount * 5);
  let level = 'GREEN', color = '#22c55e';
  if (score >= 30 || totalVisits >= 10 || uniqueDevices >= 8) { level = 'RED'; color = '#ef4444'; }
  else if (score >= 15 || totalVisits >= 5 || uniqueDevices >= 4) { level = 'YELLOW'; color = '#eab308'; }
  return { score, level, color };
}

async function getByPaspor(paspor) {
  const records = await Passenger.find({ paspor: paspor.toUpperCase() }).sort({ tanggal_dokumen: -1 });
  if (!records.length) return null;
  const devices = [...new Set(records.map(r => r.hkt1).filter(Boolean))];
  const billingCount = records.filter(r => r.status_penelitian === 'BILLING').length;
  return {
    paspor: paspor.toUpperCase(),
    summary: {
      totalVisits: records.length, uniqueDevices: devices.length, devices, billingCount,
      pembebasanCount: records.filter(r => r.status_penelitian === 'PEMBEBASAN').length,
      firstVisit: records[records.length - 1]?.tanggal_dokumen,
      lastVisit: records[0]?.tanggal_dokumen
    },
    risk: calculateRiskScore(records.length, devices.length, billingCount),
    records
  };
}

async function getRepeaters(minVisits = 5) {
  const results = await Passenger.aggregate([
    { $group: { _id: '$paspor', visits: { $sum: 1 }, devices: { $addToSet: '$hkt1' },
        billingCount: { $sum: { $cond: [{ $eq: ['$status_penelitian', 'BILLING'] }, 1, 0] } },
        firstVisit: { $min: '$tanggal_dokumen' }, lastVisit: { $max: '$tanggal_dokumen' } } },
    { $match: { visits: { $gte: minVisits } } }, { $sort: { visits: -1 } }, { $limit: 100 }
  ]);
  return results.map(r => ({
    paspor: r._id, visits: r.visits, unique_devices: r.devices.filter(Boolean).length,
    devices: r.devices.filter(Boolean), billing_count: r.billingCount,
    first_visit: r.firstVisit, last_visit: r.lastVisit,
    risk: calculateRiskScore(r.visits, r.devices.filter(Boolean).length, r.billingCount)
  }));
}

async function getStats() {
  const [totalRecords, totalPassengers, topDevices, lastUpload] = await Promise.all([
    Passenger.countDocuments(),
    Passenger.distinct('paspor').then(arr => arr.length),
    Passenger.aggregate([
      { $match: { hkt1: { $ne: null, $ne: '' } } },
      { $group: { _id: '$hkt1', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 }
    ]),
    UploadLog.findOne().sort({ uploaded_at: -1 })
  ]);
  return { totalRecords, totalPassengers, topDevices: topDevices.map(d => ({ device: d._id, count: d.count })), lastUpload };
}

async function importCSV(lines, uploadedBy, filename) {
  let newRecords = 0, duplicateRecords = 0;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].replace(/^\uFEFF/, '').replace(/\r/g, '').split(';').map(x => x.trim());
    if (f.length < 13) continue;
    try {
      await Passenger.create({
        kode_kantor: f[0], nomor_dokumen: f[1], tanggal_dokumen: f[2], paspor: f[3].toUpperCase(),
        waktu_rekam: f[4], qr_code: f[5], nip_petugas: f[6], nama_petugas: f[7], status: f[8],
        kode_kantor_peneliti: f[9], hkt1: f[10], hkt2: f[11], status_penelitian: f[12]
      });
      newRecords++;
    } catch (err) { if (err.code === 11000) duplicateRecords++; }
  }
  await UploadLog.create({ uploaded_by: uploadedBy, filename, total_records: lines.length - 1, new_records: newRecords, duplicate_records: duplicateRecords });
  return { newRecords, duplicateRecords, total: lines.length - 1 };
}

async function getUploadLogs(limit = 20) { return UploadLog.find().sort({ uploaded_at: -1 }).limit(limit); }

module.exports = { calculateRiskScore, getByPaspor, getRepeaters, getStats, importCSV, getUploadLogs };
