/**
 * Export Laporan Periodik — ringkasan eksekutif (bukan export data mentah).
 * Berbeda dari: /api/passenger/export (data penumpang), cargo/export, manifest export.
 * GET /api/reports/summary?period=week|month&format=excel|pdf
 */
const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const Manifest = require("../models/Manifest");
const Passenger = require("../models/Passenger");
const Cnpibk = require("../models/cnpibk");
const Device = require("../models/Device");

let ImeiDetail, ImeiRegistration;
try {
  ImeiDetail = require("../models/ImeiDetail");
} catch (e) {}
try {
  ImeiRegistration = require("../models/ImeiRegistration");
} catch (e) {}

function getDateRange(period) {
  const now = new Date();
  let start;
  if (period === "week") {
    start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else {
    // month = current month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function getSummaryData(period) {
  const { start, end } = getDateRange(period);
  const periodLabel =
    period === "week"
      ? "7 Hari Terakhir"
      : `Bulan ${start.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;

  const [
    totalManifests,
    totalPassengers,
    totalCargo,
    totalDevices,
    totalImeiDetails,
    totalImeiReg,
    manifestStatus,
    paxStatus,
  ] = await Promise.all([
    Manifest.countDocuments({
      createdAt: { $gte: start, $lte: end },
    }),
    Passenger.countDocuments({
      tanggal_dokumen: { $gte: start, $lte: end },
    }),
    Cnpibk.countDocuments({
      tanggal_hawb: { $gte: start, $lte: end },
    }),
    Device.countDocuments(),
    ImeiDetail
      ? ImeiDetail.countDocuments({
          waktu_kedatangan: { $gte: start, $lte: end },
        })
      : Promise.resolve(0),
    ImeiRegistration
      ? ImeiRegistration.countDocuments({
          tgl_kedatangan: { $gte: start, $lte: end },
        })
      : Promise.resolve(0),
    Manifest.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Passenger.aggregate([
      { $match: { tanggal_dokumen: { $gte: start, $lte: end } } },
      { $group: { _id: "$status_penelitian", count: { $sum: 1 } } },
    ]),
  ]);

  return {
    periodLabel,
    period,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    metrics: {
      totalManifests,
      totalPassengers,
      totalCargo,
      totalDevices,
      totalImeiDetails,
      totalImeiReg,
    },
    manifestStatus: manifestStatus || [],
    paxStatus: paxStatus || [],
  };
}

router.get("/summary", async (req, res) => {
  try {
    const period = (req.query.period || "month").toLowerCase();
    const format = (req.query.format || "excel").toLowerCase();
    if (!["week", "month"].includes(period)) {
      return res
        .status(400)
        .json({ status: "error", message: "period harus week atau month" });
    }
    if (!["excel", "pdf"].includes(format)) {
      return res
        .status(400)
        .json({ status: "error", message: "format harus excel atau pdf" });
    }

    const data = await getSummaryData(period);

    if (format === "pdf") {
      const filename = `laporan_periodik_${period}_${data.start}_${data.end}.pdf`;
      res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
      res.setHeader("Content-Type", "application/pdf");
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);
      doc.fontSize(18).text("Laporan Periodik SkyGuard Intelligence", { align: "center" });
      doc.moveDown();
      doc.fontSize(10).text("KPPBC TMP B Kualanamu — Decision Support System", { align: "center" });
      doc.moveDown(2);
      doc.fontSize(11).text("Periode: " + data.periodLabel, { continued: false });
      doc.text("Tanggal: " + data.start + " s.d. " + data.end, { continued: false });
      doc.text("Dibuat: " + data.generatedAt, { continued: false });
      doc.moveDown(2);
      doc.fontSize(12).text("Ringkasan", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text("Total Manifest (periode): " + data.metrics.totalManifests, { continued: false });
      doc.text("Total Penumpang CEISA (periode): " + data.metrics.totalPassengers, { continued: false });
      doc.text("Total Cargo/PIBK (periode): " + data.metrics.totalCargo, { continued: false });
      doc.text("Total Device Referensi: " + data.metrics.totalDevices, { continued: false });
      doc.text("IMEI Detail (periode): " + data.metrics.totalImeiDetails, { continued: false });
      doc.text("IMEI Registrasi (periode): " + data.metrics.totalImeiReg, { continued: false });
      doc.moveDown(1.5);
      doc.fontSize(11).text("Status Manifest", { underline: true });
      doc.fontSize(10);
      (data.manifestStatus || []).forEach((s) => {
        doc.text((s._id || "-") + ": " + s.count, { continued: false });
      });
      doc.moveDown(1);
      doc.fontSize(11).text("Status Penelitian Penumpang", { underline: true });
      doc.fontSize(10);
      (data.paxStatus || []).forEach((s) => {
        doc.text((s._id || "-") + ": " + s.count, { continued: false });
      });
      doc.end();
      return;
    }

    const rows = [
      ["Laporan Periodik SkyGuard Intelligence", ""],
      ["Periode", data.periodLabel],
      ["Tanggal mulai", data.start],
      ["Tanggal akhir", data.end],
      ["Dibuat", data.generatedAt],
      [],
      ["Ringkasan", ""],
      ["Total Manifest (periode)", data.metrics.totalManifests],
      ["Total Penumpang CEISA (periode)", data.metrics.totalPassengers],
      ["Total Cargo/PIBK (periode)", data.metrics.totalCargo],
      ["Total Device Referensi", data.metrics.totalDevices],
      ["IMEI Detail (periode)", data.metrics.totalImeiDetails],
      ["IMEI Registrasi (periode)", data.metrics.totalImeiReg],
      [],
      ["Status Manifest", "Jumlah"],
      ...(data.manifestStatus.map((s) => [s._id || "-", s.count])),
      [],
      ["Status Penelitian Penumpang", "Jumlah"],
      ...(data.paxStatus.map((s) => [s._id || "-", s.count])),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Ringkasan");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `laporan_periodik_${period}_${data.start}_${data.end}.xlsx`;
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="' + filename + '"',
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buf);
  } catch (err) {
    console.error("[reports/summary]", err);
    res
      .status(500)
      .json({ status: "error", message: err.message || "Gagal generate laporan" });
  }
});

module.exports = router;
