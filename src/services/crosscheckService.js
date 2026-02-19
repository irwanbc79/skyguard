const Manifest = require('../models/Manifest');
const ManifestPassenger = require('../models/ManifestPassenger');
const Passenger = require('../models/Passenger');

/**
 * Crosscheck penumpang manifest dengan data CEISA.
 *
 * Kategori hasil:
 * - matched        : ada di manifest DAN ada di CEISA (sudah didata)
 * - not_in_ceisa   : ada di manifest tapi TIDAK ada di CEISA (perlu tindak lanjut)
 * - no_passport    : ada di manifest tapi tanpa nomor paspor (tidak bisa dicocokan)
 */
async function crosscheckManifest(manifestId) {
  const manifest = await Manifest.findById(manifestId);
  if (!manifest) throw new Error('Manifest tidak ditemukan');

  const passengers = await ManifestPassenger.find({ manifest_id: manifestId }).lean();
  if (!passengers.length) throw new Error('Belum ada data penumpang. Lakukan sync terlebih dahulu.');

  const withPassport = passengers.filter(p => p.passport_number && p.passport_number.trim());
  const withoutPassport = passengers.filter(p => !p.passport_number || !p.passport_number.trim());

  // Ambil unik passport numbers dan query CEISA sekaligus
  const passportNumbers = [...new Set(withPassport.map(p => p.passport_number.toUpperCase().trim()))];
  const ceisaRecords = await Passenger.find({
    paspor: { $in: passportNumbers }
  }).lean();

  // Buat map: passport -> array records CEISA
  const ceisaMap = {};
  for (const rec of ceisaRecords) {
    const key = rec.paspor.toUpperCase();
    if (!ceisaMap[key]) ceisaMap[key] = [];
    ceisaMap[key].push(rec);
  }

  const matched = [];
  const notInCeisa = [];

  for (const pax of withPassport) {
    const key = pax.passport_number.toUpperCase().trim();
    const ceisaData = ceisaMap[key] || [];

    const row = {
      name: pax.name,
      passport_number: pax.passport_number,
      nationality: pax.nationality,
      gender: pax.gender,
      pnr: pax.pnr,
      seat_no: pax.seat_no,
      status: pax.status,
      ceisa_count: ceisaData.length
    };

    if (ceisaData.length > 0) {
      const latest = ceisaData.sort((a, b) => new Date(b.tanggal_dokumen) - new Date(a.tanggal_dokumen))[0];
      matched.push({
        ...row,
        last_ceisa_date: latest.tanggal_dokumen,
        last_status_penelitian: latest.status_penelitian,
        last_device: latest.hkt1,
        nama_ceisa: latest.nama_lengkap
      });
    } else {
      notInCeisa.push(row);
    }
  }

  // Update field ceisa_match di ManifestPassenger
  const matchedPassports = new Set(matched.map(p => p.passport_number.toUpperCase()));
  await ManifestPassenger.bulkWrite(
    withPassport.map(pax => ({
      updateOne: {
        filter: { _id: pax._id },
        update: {
          $set: {
            ceisa_match: matchedPassports.has(pax.passport_number.toUpperCase()),
            ceisa_records_count: (ceisaMap[pax.passport_number.toUpperCase()] || []).length
          }
        }
      }
    }))
  );

  const totalCheckedIn = passengers.filter(p => p.status === 'checked_in').length;
  const totalNoShow = passengers.filter(p => p.status === 'no_show').length;

  return {
    manifest: {
      id: manifest._id,
      flight_number: manifest.flight_number,
      flight_date: manifest.flight_date,
      origin: manifest.origin,
      destination: manifest.destination,
      format: manifest.parsed_fields?.format || 'unknown'
    },
    summary: {
      total_passengers: passengers.length,
      checked_in: totalCheckedIn,
      no_show: totalNoShow,
      with_passport_data: withPassport.length,
      without_passport_data: withoutPassport.length,
      matched_in_ceisa: matched.length,
      not_in_ceisa: notInCeisa.length,
      match_rate: withPassport.length
        ? ((matched.length / withPassport.length) * 100).toFixed(1) + '%'
        : '0%'
    },
    matched,
    not_in_ceisa: notInCeisa,
    no_passport_data: withoutPassport.map(p => ({
      name: p.name,
      pnr: p.pnr,
      seat_no: p.seat_no,
      status: p.status
    }))
  };
}

module.exports = { crosscheckManifest };
