const { escapeRegex } = require('../utils/helpers');
const Passenger = require('../models/Passenger');
const Transaction = require('../models/Transaction');
const Device = require('../models/Device');
const PriceReference = require('../models/PriceReference');

// Lookup passenger by passport
exports.lookup = async (req, res) => {
  try {
    const { passport } = req.params;
    
    const passenger = await Passenger.findOne({ paspor: passport.toUpperCase() });
    if (!passenger) {
      return res.json({ status: 'ok', data: null, message: 'Penumpang tidak ditemukan' });
    }
    
    // Get transaction history
    const transactions = await Transaction.find({ paspor: passport.toUpperCase() })
      .sort({ tanggal_dokumen: -1 })
      .limit(20);
    
    // Determine flags
    const flags = [];
    if (passenger.total_arrivals >= 3) flags.push({ type: 'frequent_traveler', label: 'Frequent Traveler', color: 'blue' });
    if (passenger.total_devices >= 4) flags.push({ type: 'imei_collector', label: 'IMEI Collector', color: 'red' });
    
    res.json({
      status: 'ok',
      data: {
        passenger,
        transactions,
        flags,
        summary: {
          total_arrivals: passenger.total_arrivals,
          total_devices: passenger.total_devices,
          first_arrival: passenger.first_arrival,
          last_arrival: passenger.last_arrival
        }
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get flagged passengers (alerts)
exports.getAlerts = async (req, res) => {
  try {
    const alerts = await Passenger.find({
      $or: [
        { total_arrivals: { $gte: 3 } },
        { total_devices: { $gte: 4 } }
      ]
    }).sort({ total_devices: -1 }).limit(50);
    
    res.json({ status: 'ok', data: alerts, total: alerts.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get statistics
exports.getStats = async (req, res) => {
  try {
    const totalPassengers = await Passenger.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const frequentTravelers = await Passenger.countDocuments({ total_arrivals: { $gte: 3 } });
    const imeiCollectors = await Passenger.countDocuments({ total_devices: { $gte: 4 } });
    
    // Top devices
    const topDevices = await Transaction.aggregate([
      { $match: { hkt1: { $ne: null, $ne: '' } } },
      { $group: { _id: '$hkt1', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    // Top officers
    const topOfficers = await Transaction.aggregate([
      { $group: { _id: { nip: '$nip_petugas', nama: '$nama_petugas' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    res.json({
      status: 'ok',
      data: {
        total_passengers: totalPassengers,
        total_transactions: totalTransactions,
        frequent_travelers: frequentTravelers,
        imei_collectors: imeiCollectors,
        top_devices: topDevices,
        top_officers: topOfficers
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Search transactions
exports.searchTransactions = async (req, res) => {
  try {
    const { q, status, from, to, limit = 50 } = req.query;
    
    let query = {};
    if (q) {
      query.$or = [
        { paspor: new RegExp(escapeRegex(q), 'i') },
        { nomor_dokumen: new RegExp(escapeRegex(q), 'i') },
        { hkt1: new RegExp(escapeRegex(q), 'i') },
        { hkt2: new RegExp(escapeRegex(q), 'i') },
        { nama_petugas: new RegExp(escapeRegex(q), 'i') }
      ];
    }
    if (status) query.status_penelitian = status;
    if (from || to) {
      query.tanggal_dokumen = {};
      if (from) query.tanggal_dokumen.$gte = new Date(from);
      if (to) query.tanggal_dokumen.$lte = new Date(to);
    }
    
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const transactions = await Transaction.find(query)
      .sort({ tanggal_dokumen: -1 })
      .limit(limitNum);
    
    res.json({ status: 'ok', data: transactions, total: transactions.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Match HKT to device database
exports.matchDevice = async (req, res) => {
  try {
    const { hkt } = req.body;
    if (!hkt) return res.status(400).json({ status: 'error', message: 'HKT required' });
    
    // Parse HKT string (e.g., "APPLE IPHONE 13 PRO MAX")
    const parts = hkt.toUpperCase().split(' ');
    let brand = parts[0];
    let model = parts.slice(1).join(' ');
    
    // Map common brand names
    if (brand === 'APPLE') brand = 'Apple';
    if (brand === 'SAMSUNG') brand = 'Samsung';
    
    // Search in device database (escape user input to avoid ReDoS)
    const safeBrand = escapeRegex(brand);
    const safeModel = escapeRegex(model).replace(/\s+/g, ".*");
    const devices = await Device.find({
      brand: new RegExp(safeBrand, "i"),
      model: new RegExp(safeModel, "i"),
    })
      .limit(50)
      .lean();

    if (devices.length === 0) {
      return res.json({ status: "ok", data: null, message: "Device tidak ditemukan di database", suggestion: "Tambahkan device baru" });
    }

    const deviceIds = devices.map((d) => d._id);
    const prices = await PriceReference.find({
      device_id: { $in: deviceIds },
      is_latest: true,
    })
      .lean();
    const priceByDevice = new Map(prices.map((p) => [String(p.device_id), p]));

    const results = devices.map((device) => {
      const price = priceByDevice.get(String(device._id));
      return {
        device,
        price_usd: price?.price_usd || 0,
        tax_idr: price?.tax_idr || 0,
      };
    });

    res.json({ status: "ok", data: results });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
