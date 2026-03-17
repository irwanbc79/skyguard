const express = require("express");
const router = express.Router();
const ManifestPassenger = require("../models/ManifestPassenger");
const Manifest = require("../models/Manifest");
const Passenger = require("../models/Passenger");
const ImeiRegistration = require("../models/ImeiRegistration");
const ImeiDetail = require("../models/ImeiDetail");
const { getKantorName } = require("../utils/constants");

// ============================================================
// PENCARIAN TERPADU — Unified Passport-Centric Search
// Single endpoint, semua data dari semua koleksi
// ============================================================
router.get("/search/:passport", async (req, res) => {
  try {
    const passport = req.params.passport.toUpperCase().trim();
    if (!passport || passport.length < 3) {
      return res
        .status(400)
        .json({ status: "error", message: "Nomor paspor minimal 3 karakter" });
    }

    const escapedPassport = passport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const passportRegex = new RegExp("^" + escapedPassport + "$", "i");

    // ─── PARALLEL: Query ALL collections by passport ───
    const [manifestPax, imeiDetails, imeiRegs, ceisaPax, suspectDoc] =
      await Promise.all([
        ManifestPassenger.find({ passport_number: passportRegex })
          .sort({ flight_date: -1 })
          .limit(200)
          .lean(),
        ImeiDetail.find({ no_identitas: passportRegex })
          .sort({ waktu_kedatangan: -1 })
          .limit(200)
          .lean(),
        ImeiRegistration.find({ no_identitas: passportRegex })
          .sort({ tgl_kedatangan: -1 })
          .limit(200)
          .lean(),
        Passenger.find({ paspor: passportRegex })
          .sort({ tanggal_dokumen: -1 })
          .limit(200)
          .lean(),
        require("mongoose")
          .model("Suspect")
          .findOne({ passport_number: passportRegex })
          .lean()
          .catch(() => null),
      ]);

    const totalFound =
      manifestPax.length +
      imeiDetails.length +
      imeiRegs.length +
      ceisaPax.length;

    if (!totalFound && !suspectDoc) {
      return res.json({
        status: "ok",
        data: { passport, found: false, profile: null },
      });
    }

    // ─── BUILD UNIFIED IDENTITY PROFILE ───
    // Priority: ManifestPassenger > ImeiDetail > ImeiRegistration > CEISA > Suspect
    const identity = {
      passport_number: passport,
      name: null,
      nationality: null,
      gender: null,
      date_of_birth: null,
      aliases: new Set(),
      sources: [],
    };

    // Collect all names for alias detection
    const allNames = [];

    // From ManifestPassenger (richest data)
    for (const p of manifestPax) {
      if (p.name) allNames.push(p.name);
      if (!identity.name && p.name) identity.name = p.name;
      if (!identity.nationality && p.nationality)
        identity.nationality = p.nationality;
      if (!identity.gender && p.gender) identity.gender = p.gender;
      if (!identity.date_of_birth && p.date_of_birth)
        identity.date_of_birth = p.date_of_birth;
    }

    // From ImeiDetail
    for (const d of imeiDetails) {
      if (d.nama) allNames.push(d.nama);
      if (!identity.name && d.nama) identity.name = d.nama;
      if (!identity.nationality && d.kebangsaan)
        identity.nationality = d.kebangsaan;
    }

    // From ImeiRegistration
    for (const r of imeiRegs) {
      if (r.nama) allNames.push(r.nama);
      if (!identity.name && r.nama) identity.name = r.nama;
      if (!identity.nationality && r.kebangsaan)
        identity.nationality = r.kebangsaan;
    }

    // From CEISA Passenger
    for (const c of ceisaPax) {
      if (c.nama_lengkap) allNames.push(c.nama_lengkap);
      if (!identity.name && c.nama_lengkap) identity.name = c.nama_lengkap;
    }

    // From Suspect
    if (suspectDoc) {
      if (!identity.name && suspectDoc.full_name)
        identity.name = suspectDoc.full_name;
      if (!identity.nationality && suspectDoc.nationality)
        identity.nationality = suspectDoc.nationality;
      if (!identity.gender && suspectDoc.gender)
        identity.gender = suspectDoc.gender;
      if (!identity.date_of_birth && suspectDoc.date_of_birth)
        identity.date_of_birth = suspectDoc.date_of_birth;
    }

    // Deduplicate aliases (names different from primary)
    const primaryNameLower = (identity.name || "").toLowerCase().trim();
    allNames.forEach((n) => {
      const lower = n.toLowerCase().trim();
      if (lower && lower !== primaryNameLower) {
        identity.aliases.add(n);
      }
    });
    identity.aliases = [...identity.aliases];

    // Source counts
    identity.sources = [
      {
        source: "manifest",
        count: manifestPax.length,
        label: "Manifest Penerbangan",
      },
      {
        source: "imei_detail",
        count: imeiDetails.length,
        label: "IMEI Detail (cdIMEI)",
      },
      {
        source: "imei_registration",
        count: imeiRegs.length,
        label: "IMEI Registration",
      },
      { source: "ceisa", count: ceisaPax.length, label: "CEISA (HKT)" },
    ].filter((s) => s.count > 0);

    // ─── FLIGHT HISTORY (from ManifestPassenger + ImeiDetail) ───
    const manifestIds = [
      ...new Set(
        manifestPax.map((p) => p.manifest_id?.toString()).filter(Boolean),
      ),
    ];
    const manifests =
      manifestIds.length > 0
        ? await Manifest.find({ _id: { $in: manifestIds } })
            .select(
              "flight_number flight_date origin destination carrier direction",
            )
            .lean()
        : [];
    const manifestMap = {};
    manifests.forEach((m) => (manifestMap[m._id.toString()] = m));

    // Build unified flight timeline
    const flightTimeline = [];

    // From manifest passengers
    manifestPax.forEach((p) => {
      const mf = manifestMap[p.manifest_id?.toString()] || {};
      flightTimeline.push({
        source: "manifest",
        flight_number: p.flight_number || mf.flight_number || null,
        flight_date: p.flight_date || mf.flight_date || null,
        origin: mf.origin || null,
        destination: mf.destination || null,
        carrier: mf.carrier || null,
        direction: mf.direction || null,
        pnr: p.pnr || null,
        seat_no: p.seat_no || null,
        status: p.status || null,
        nationality: p.nationality || null,
        gender: p.gender || null,
        bag_weight: p.bag_weight || null,
        ticket_number: p.ticket_number || null,
        pax_type: p.pax_type || null,
        // No device/payment data from manifests
        device: null,
        payment: null,
      });
    });

    // From IMEI Detail (has device + payment + flight)
    imeiDetails.forEach((d) => {
      flightTimeline.push({
        source: "imei_detail",
        flight_number: d.flight_voyage || d.flight_normalized || null,
        flight_date: d.waktu_kedatangan || null,
        origin: null,
        destination: null,
        carrier: null,
        direction: null,
        pnr: null,
        seat_no: null,
        status: d.cara_pembayaran || null,
        nationality: d.kebangsaan || null,
        gender: null,
        bag_weight: null,
        ticket_number: null,
        pax_type: null,
        device: {
          merk: d.merk,
          tipe: d.tipe,
          storage: d.storage,
          warna: d.warna,
          imei1: d.imei1,
          imei2: d.imei2,
          harga_fob_usd: d.harga_fob_usd,
          bekas: d.bekas,
        },
        payment: {
          no_dokumen: d.no_dokumen,
          tgl_dokumen: d.tgl_dokumen,
          cara_pembayaran: d.cara_pembayaran,
          kode_billing: d.kode_billing,
          total_pungutan: d.total_pungutan,
          kode_kantor: d.kode_kantor,
          kantor_nama: getKantorName(d.kode_kantor),
        },
      });
    });

    // From IMEI Registration (only if not already in ImeiDetail by no_dok)
    const detailDokSet = new Set(
      imeiDetails.map((d) => d.no_dokumen).filter(Boolean),
    );
    imeiRegs.forEach((r) => {
      if (r.no_dok && detailDokSet.has(r.no_dok)) return;
      flightTimeline.push({
        source: "imei_registration",
        flight_number: r.vessel || r.vessel_normalized || null,
        flight_date: r.tgl_kedatangan || null,
        origin: null,
        destination: null,
        carrier: null,
        direction: null,
        pnr: null,
        seat_no: null,
        status: r.status_pembayaran || null,
        nationality: r.kebangsaan || null,
        gender: null,
        bag_weight: null,
        ticket_number: null,
        pax_type: null,
        device: null,
        payment: {
          no_dokumen: r.no_dok,
          tgl_dokumen: r.tgl_dok,
          cara_pembayaran: r.status_pembayaran,
          total_pungutan: r.total_pungutan,
          kode_kantor: r.kode_kantor,
          kantor_nama: getKantorName(r.kode_kantor),
        },
      });
    });

    // Sort by date descending
    flightTimeline.sort((a, b) => {
      const da = a.flight_date ? new Date(a.flight_date).getTime() : 0;
      const db = b.flight_date ? new Date(b.flight_date).getTime() : 0;
      return db - da;
    });

    // ─── CEISA RECORDS (HKT) ───
    const ceisaRecords = ceisaPax.map((c) => ({
      nomor_dokumen: c.nomor_dokumen,
      tanggal_dokumen: c.tanggal_dokumen,
      nama_lengkap: c.nama_lengkap,
      status: c.status,
      status_penelitian: c.status_penelitian,
      hkt1: c.hkt1,
      hkt2: c.hkt2,
      nama_petugas: c.nama_petugas,
      kode_kantor: c.kode_kantor,
    }));

    // ─── DEVICE PORTFOLIO (dari ImeiDetail) ───
    const devices = imeiDetails.map((d) => ({
      merk: d.merk,
      tipe: d.tipe,
      storage: d.storage,
      warna: d.warna,
      imei1: d.imei1,
      imei2: d.imei2,
      harga_fob_usd: d.harga_fob_usd,
      total_pungutan: d.total_pungutan,
      cara_pembayaran: d.cara_pembayaran,
      bekas: d.bekas,
      flight_voyage: d.flight_voyage,
      waktu_kedatangan: d.waktu_kedatangan,
      kode_kantor: d.kode_kantor,
      kantor_nama: getKantorName(d.kode_kantor),
    }));

    // ─── STATISTICS ───
    const uniquePnrs = [
      ...new Set(flightTimeline.map((r) => r.pnr).filter(Boolean)),
    ];
    const uniqueFlights = [
      ...new Set(flightTimeline.map((r) => r.flight_number).filter(Boolean)),
    ];
    const uniqueAirlines = [
      ...new Set(
        flightTimeline
          .map(
            (r) =>
              r.carrier ||
              (r.flight_number || "").replace(/\s?\d+/g, "").trim(),
          )
          .filter(Boolean),
      ),
    ];

    // Brand breakdown
    const brandMap = {};
    let totalFobUsd = 0;
    let totalPungutan = 0;
    devices.forEach((d) => {
      if (d.merk) brandMap[d.merk] = (brandMap[d.merk] || 0) + 1;
      totalFobUsd += d.harga_fob_usd || 0;
      totalPungutan += d.total_pungutan || 0;
    });

    // CEISA stats
    const billingCount =
      ceisaPax.filter((c) => c.status_penelitian === "BILLING").length +
      imeiDetails.filter((d) => d.cara_pembayaran === "BILLING").length;
    const pembebasanCount =
      ceisaPax.filter((c) => c.status_penelitian === "PEMBEBASAN").length +
      imeiDetails.filter((d) => d.cara_pembayaran === "PEMBEBASAN").length;

    // All CEISA devices
    const ceisaDevices = new Set();
    ceisaPax.forEach((c) => {
      if (c.hkt1) ceisaDevices.add(c.hkt1);
      if (c.hkt2) ceisaDevices.add(c.hkt2);
    });

    // ─── WATCHLIST ───
    const watchlist = suspectDoc
      ? {
          is_suspect: true,
          suspect_id: suspectDoc._id,
          status: suspectDoc.status,
          risk_level: suspectDoc.risk_level,
          categories: suspectDoc.categories,
          description: suspectDoc.description,
        }
      : { is_suspect: false };

    // ─── RISK / THREAT ASSESSMENT ───
    let intelScore = 0;
    intelScore += uniqueFlights.length * 2;
    intelScore += ceisaPax.length * 5;
    intelScore += billingCount * 10;
    intelScore += ceisaDevices.size * 4;
    intelScore += watchlist.is_suspect ? 30 : 0;
    intelScore += imeiRegs.length * 3;
    intelScore += devices.length >= 5 ? 20 : devices.length * 3;
    intelScore += totalFobUsd > 5000 ? 15 : 0;

    let riskLevel = "LOW";
    let riskColor = "#22c55e";
    if (intelScore >= 60 || watchlist.is_suspect || billingCount >= 3) {
      riskLevel = "HIGH";
      riskColor = "#ef4444";
    } else if (
      intelScore >= 25 ||
      ceisaPax.length >= 3 ||
      uniqueFlights.length >= 10
    ) {
      riskLevel = "MEDIUM";
      riskColor = "#eab308";
    }

    // Anomalies
    const anomalies = [];
    if (billingCount >= 2)
      anomalies.push({
        type: "BILLING",
        severity: "HIGH",
        msg: `${billingCount}x billing kepabeanan`,
      });
    if (devices.length >= 5)
      anomalies.push({
        type: "BULK_DEVICES",
        severity: "HIGH",
        msg: `${devices.length} perangkat terdaftar`,
      });
    if (uniqueFlights.length >= 10)
      anomalies.push({
        type: "FREQUENT_TRAVELER",
        severity: "MEDIUM",
        msg: `${uniqueFlights.length} penerbangan tercatat`,
      });
    if (watchlist.is_suspect)
      anomalies.push({
        type: "WATCHLIST",
        severity: "CRITICAL",
        msg: "Terdaftar di Daftar Atensi",
      });
    if (totalFobUsd > 5000)
      anomalies.push({
        type: "HIGH_VALUE",
        severity: "MEDIUM",
        msg: `Total nilai perangkat: $${totalFobUsd.toFixed(0)}`,
      });

    // ─── FINAL RESPONSE ───
    res.json({
      status: "ok",
      data: {
        found: true,
        identity,
        risk: {
          score: intelScore,
          level: riskLevel,
          color: riskColor,
          anomalies,
        },
        summary: {
          total_records: totalFound,
          total_flights: uniqueFlights.length,
          total_bookings: uniquePnrs.length,
          total_devices: devices.length,
          total_ceisa: ceisaPax.length,
          total_imei_reg: imeiRegs.length,
          billing_count: billingCount,
          pembebasan_count: pembebasanCount,
          total_fob_usd: totalFobUsd,
          total_pungutan: totalPungutan,
          unique_airlines: uniqueAirlines,
          booking_codes: uniquePnrs,
          flights: uniqueFlights,
          brands: Object.entries(brandMap)
            .sort((a, b) => b[1] - a[1])
            .map(([brand, count]) => ({ brand, count })),
        },
        timeline: flightTimeline,
        ceisa: ceisaRecords,
        devices,
        watchlist,
      },
    });
  } catch (err) {
    console.error("[UNIFIED SEARCH]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// MULTI-SEARCH — Cari dari semua koleksi berdasarkan tipe input
// Mendukung: paspor, nama, imei, flight, dokumen
// ============================================================
router.get("/multi-search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    let type = (req.query.type || "auto").toLowerCase();

    if (!q || q.length < 2) {
      return res
        .status(400)
        .json({ status: "error", message: "Masukkan minimal 2 karakter" });
    }

    // Auto-detect type
    if (type === "auto") {
      if (/^\d{15}$/.test(q)) type = "imei";
      else if (/^\d{6}-\d{6}$/.test(q) || /^\d{12}$/.test(q)) type = "dokumen";
      else if (
        /^[A-Z]{2}\s?\d{2,4}$/i.test(q) ||
        /^(GA|JT|QG|QZ|ID|SJ|IN|IW|KD|IP|SQ|CX|MH|TG|AK|TR|3K|MI|CZ|MU|CA)\s?\d{2,4}$/i.test(
          q,
        )
      )
        type = "flight";
      else if (/^[A-Z]{1,2}\d{5,9}$/i.test(q) || /^\d{7,9}$/.test(q))
        type = "paspor";
      else if (/\s/.test(q) || q.length >= 4) type = "nama";
      else type = "paspor";
    }

    const results = { type, query: q, sources: [] };
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const qUpper = q.toUpperCase();

    if (type === "paspor") {
      const regex = new RegExp("^" + escaped + "$", "i");
      const [mPax, iDet, iReg, ceisa, suspect] = await Promise.all([
        ManifestPassenger.find({ passport_number: regex })
          .sort({ flight_date: -1 })
          .limit(100)
          .lean(),
        ImeiDetail.find({ no_identitas: regex })
          .sort({ waktu_kedatangan: -1 })
          .limit(100)
          .lean(),
        ImeiRegistration.find({ no_identitas: regex })
          .sort({ tgl_kedatangan: -1 })
          .limit(100)
          .lean(),
        Passenger.find({ paspor: regex })
          .sort({ tanggal_dokumen: -1 })
          .limit(100)
          .lean(),
        require("mongoose")
          .model("Suspect")
          .findOne({ passport_number: regex })
          .lean()
          .catch(() => null),
      ]);

      // Build grouped results
      const names = new Set();
      mPax.forEach((p) => {
        if (p.name) names.add(p.name);
      });
      iDet.forEach((d) => {
        if (d.nama) names.add(d.nama);
      });
      iReg.forEach((r) => {
        if (r.nama) names.add(r.nama);
      });
      ceisa.forEach((c) => {
        if (c.nama_lengkap) names.add(c.nama_lengkap);
      });
      const primaryName = names.values().next().value || qUpper;

      results.identity = {
        passport: qUpper,
        name: primaryName,
        aliases: [...names].slice(1, 5),
      };
      results.is_suspect = !!suspect;
      results.suspect_id = suspect ? String(suspect._id) : null;
      results.suspect = suspect
        ? { status: suspect.status, risk_level: suspect.risk_level }
        : null;

      if (mPax.length)
        results.sources.push({
          source: "manifest",
          label: "Manifest Penerbangan",
          icon: "fa-plane",
          color: "#f97316",
          count: mPax.length,
          items: mPax
            .slice(0, 20)
            .map((p) => ({
              _id: p._id ? String(p._id) : null,
              passport: p.passport_number,
              name: p.name,
              flight: p.flight_number,
              date: p.flight_date,
              pnr: p.pnr,
              seat: p.seat_no,
              nationality: p.nationality,
            })),
        });
      if (ceisa.length)
        results.sources.push({
          source: "ceisa",
          label: "CEISA (HKT)",
          icon: "fa-stamp",
          color: "#f59e0b",
          count: ceisa.length,
          items: ceisa
            .slice(0, 20)
            .map((c) => ({
              _id: c._id ? String(c._id) : null,
              passport: c.paspor,
              name: c.nama_lengkap,
              doc: c.nomor_dokumen,
              date: c.tanggal_dokumen,
              status: c.status_penelitian,
              hkt1: c.hkt1,
              hkt2: c.hkt2,
            })),
        });
      if (iDet.length)
        results.sources.push({
          source: "imei_detail",
          label: "IMEI Detail (Scraper)",
          icon: "fa-microchip",
          color: "#3b82f6",
          count: iDet.length,
          items: iDet
            .slice(0, 20)
            .map((d) => ({
              _id: d._id ? String(d._id) : null,
              passport: d.no_identitas,
              name: d.nama,
              merk: d.merk,
              tipe: d.tipe,
              imei: d.imei1,
              imei1: d.imei1,
              fob: d.harga_fob_usd,
              payment: d.cara_pembayaran,
              dok: d.no_dokumen,
              flight: d.flight_voyage,
            })),
        });
      if (iReg.length)
        results.sources.push({
          source: "imei_reg",
          label: "IMEI Registrasi (CSV)",
          icon: "fa-file-csv",
          color: "#22c55e",
          count: iReg.length,
          items: iReg
            .slice(0, 20)
            .map((r) => ({
              _id: r._id ? String(r._id) : null,
              passport: r.no_identitas,
              name: r.nama,
              dok: r.no_dok,
              date: r.tgl_kedatangan,
              vessel: r.vessel,
              payment: r.status_pembayaran,
              pungutan: r.total_pungutan,
            })),
        });

      results.totalRecords =
        mPax.length + ceisa.length + iDet.length + iReg.length;
      results.hasFullProfile = true; // Can use /search/:passport for full dossier
    } else if (type === "nama") {
      const regex = new RegExp(escaped, "i");
      const [mPax, iDet, iReg, ceisa] = await Promise.all([
        ManifestPassenger.find({ name: regex })
          .sort({ flight_date: -1 })
          .limit(100)
          .lean(),
        ImeiDetail.find({ nama: regex })
          .sort({ waktu_kedatangan: -1 })
          .limit(100)
          .lean(),
        ImeiRegistration.find({ nama: regex })
          .sort({ tgl_kedatangan: -1 })
          .limit(100)
          .lean(),
        Passenger.find({ nama_lengkap: regex })
          .sort({ tanggal_dokumen: -1 })
          .limit(100)
          .lean(),
      ]);

      // Group by passport to deduplicate across sources
      const passportMap = {};
      const addToMap = (passport, name, source) => {
        if (!passport) return;
        const key = passport.toUpperCase();
        if (!passportMap[key])
          passportMap[key] = {
            passport: key,
            names: new Set(),
            sources: new Set(),
            count: 0,
          };
        if (name) passportMap[key].names.add(name);
        passportMap[key].sources.add(source);
        passportMap[key].count++;
      };

      mPax.forEach((p) => addToMap(p.passport_number, p.name, "manifest"));
      iDet.forEach((d) => addToMap(d.no_identitas, d.nama, "imei_detail"));
      iReg.forEach((r) => addToMap(r.no_identitas, r.nama, "imei_reg"));
      ceisa.forEach((c) => addToMap(c.paspor, c.nama_lengkap, "ceisa"));

      const grouped = Object.values(passportMap)
        .map((g) => ({
          passport: g.passport,
          name: [...g.names][0] || qUpper,
          aliases: [...g.names].slice(1, 3),
          sources: [...g.sources],
          recordCount: g.count,
        }))
        .sort((a, b) => b.recordCount - a.recordCount)
        .slice(0, 50);

      // Also include records without passport
      const noPassport = [];
      mPax
        .filter((p) => !p.passport_number)
        .forEach((p) =>
          noPassport.push({
            name: p.name,
            source: "manifest",
            flight: p.flight_number,
            date: p.flight_date,
          }),
        );

      if (mPax.length)
        results.sources.push({
          source: "manifest",
          label: "Manifest Penerbangan",
          icon: "fa-plane",
          color: "#f97316",
          count: mPax.length,
        });
      if (ceisa.length)
        results.sources.push({
          source: "ceisa",
          label: "CEISA (HKT)",
          icon: "fa-stamp",
          color: "#f59e0b",
          count: ceisa.length,
        });
      if (iDet.length)
        results.sources.push({
          source: "imei_detail",
          label: "IMEI Detail",
          icon: "fa-microchip",
          color: "#3b82f6",
          count: iDet.length,
        });
      if (iReg.length)
        results.sources.push({
          source: "imei_reg",
          label: "IMEI Registrasi",
          icon: "fa-file-csv",
          color: "#22c55e",
          count: iReg.length,
        });

      results.grouped = grouped;
      results.noPassport = noPassport.slice(0, 10);
      results.totalRecords =
        mPax.length + ceisa.length + iDet.length + iReg.length;
    } else if (type === "imei") {
      const regex = new RegExp("^" + escaped, "i");
      const iDet = await ImeiDetail.find({
        $or: [{ imei1: regex }, { imei2: regex }],
      })
        .limit(50)
        .lean();

      if (iDet.length)
        results.sources.push({
          source: "imei_detail",
          label: "IMEI Detail",
          icon: "fa-microchip",
          color: "#3b82f6",
          count: iDet.length,
          items: iDet.map((d) => ({
            _id: d._id ? String(d._id) : null,
            nama: d.nama,
            passport: d.no_identitas,
            merk: d.merk,
            tipe: d.tipe,
            imei1: d.imei1,
            imei2: d.imei2,
            imei: d.imei1,
            fob: d.harga_fob_usd,
            payment: d.cara_pembayaran,
            dok: d.no_dokumen,
            flight: d.flight_voyage,
            date: d.waktu_kedatangan,
          })),
        });

      results.totalRecords = iDet.length;
    } else if (type === "flight") {
      const flightNorm = qUpper.replace(/\s+/g, "");
      const flightRegex = new RegExp(escaped.replace(/\s+/g, "\\s*"), "i");

      const [mPax, iDet, iReg] = await Promise.all([
        ManifestPassenger.find({ flight_number: flightRegex })
          .sort({ flight_date: -1 })
          .limit(200)
          .lean(),
        ImeiDetail.find({
          $or: [
            { flight_voyage: flightRegex },
            { flight_normalized: flightNorm },
          ],
        })
          .sort({ waktu_kedatangan: -1 })
          .limit(100)
          .lean(),
        ImeiRegistration.find({
          $or: [{ vessel: flightRegex }, { vessel_normalized: flightNorm }],
        })
          .sort({ tgl_kedatangan: -1 })
          .limit(100)
          .lean(),
      ]);

      // Group manifest passengers by date
      const dateGroups = {};
      mPax.forEach((p) => {
        const d = p.flight_date
          ? new Date(p.flight_date).toISOString().slice(0, 10)
          : "unknown";
        if (!dateGroups[d])
          dateGroups[d] = { date: d, passengers: [], count: 0 };
        dateGroups[d].passengers.push({
          name: p.name,
          passport: p.passport_number,
          nationality: p.nationality,
          pnr: p.pnr,
          seat: p.seat_no,
        });
        dateGroups[d].count++;
      });

      if (mPax.length)
        results.sources.push({
          source: "manifest",
          label: "Manifest Penerbangan",
          icon: "fa-plane",
          color: "#f97316",
          count: mPax.length,
        });
      if (iDet.length)
        results.sources.push({
          source: "imei_detail",
          label: "IMEI Detail",
          icon: "fa-microchip",
          color: "#3b82f6",
          count: iDet.length,
          items: iDet
            .slice(0, 20)
            .map((d) => ({
              _id: d._id ? String(d._id) : null,
              nama: d.nama,
              passport: d.no_identitas,
              merk: d.merk,
              tipe: d.tipe,
              imei: d.imei1,
              payment: d.cara_pembayaran,
              dok: d.no_dokumen,
            })),
        });
      if (iReg.length)
        results.sources.push({
          source: "imei_reg",
          label: "IMEI Registrasi",
          icon: "fa-file-csv",
          color: "#22c55e",
          count: iReg.length,
          items: iReg
            .slice(0, 20)
            .map((r) => ({
              _id: r._id ? String(r._id) : null,
              nama: r.nama,
              passport: r.no_identitas,
              dok: r.no_dok,
              payment: r.status_pembayaran,
            })),
        });

      results.flightGroups = Object.values(dateGroups).sort((a, b) =>
        b.date.localeCompare(a.date),
      );
      results.totalRecords = mPax.length + iDet.length + iReg.length;
    } else if (type === "dokumen") {
      const regex = new RegExp("^" + escaped + "$", "i");
      const [iDet, iReg] = await Promise.all([
        ImeiDetail.find({ no_dokumen: regex }).limit(50).lean(),
        ImeiRegistration.find({ no_dok: regex }).limit(50).lean(),
      ]);

      if (iDet.length)
        results.sources.push({
          source: "imei_detail",
          label: "IMEI Detail",
          icon: "fa-microchip",
          color: "#3b82f6",
          count: iDet.length,
          items: iDet.map((d) => ({
            _id: d._id ? String(d._id) : null,
            nama: d.nama,
            passport: d.no_identitas,
            merk: d.merk,
            tipe: d.tipe,
            imei: d.imei1,
            imei1: d.imei1,
            fob: d.harga_fob_usd,
            payment: d.cara_pembayaran,
          })),
        });
      if (iReg.length)
        results.sources.push({
          source: "imei_reg",
          label: "IMEI Registrasi",
          icon: "fa-file-csv",
          color: "#22c55e",
          count: iReg.length,
          items: iReg.map((r) => ({
            _id: r._id ? String(r._id) : null,
            nama: r.nama,
            passport: r.no_identitas,
            dok: r.no_dok,
            vessel: r.vessel,
            payment: r.status_pembayaran,
            pungutan: r.total_pungutan,
          })),
        });

      results.totalRecords = iDet.length + iReg.length;
    }

    res.json({ status: "ok", results });
  } catch (err) {
    console.error("[MULTI SEARCH]", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
