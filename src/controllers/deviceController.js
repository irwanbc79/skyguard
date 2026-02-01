const Device = require('../models/Device');
const PriceReference = require('../models/PriceReference');

// Get all devices grouped by brand
exports.getAll = async (req, res) => {
  try {
    const devices = await Device.find().lean();
    
    const result = await Promise.all(devices.map(async (device) => {
      const price = await PriceReference.findOne({ 
        device_id: device._id, 
        is_latest: true 
      }).lean();
      return {
        ...device,
        price_usd: price?.price_usd || 0,
        updated_at: price?.created_at || null,
        updated_by: price?.created_by || null,
        tax_idr: price?.tax_idr || 0
      };
    }));

    // Sort by price descending
    result.sort((a, b) => b.price_usd - a.price_usd);

    // Group by brand
    const grouped = {};
    result.forEach(d => {
      if (!grouped[d.brand]) grouped[d.brand] = [];
      grouped[d.brand].push(d);
    });

    res.json({ status: 'ok', data: grouped, total: result.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Search devices
exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ status: 'ok', data: [] });

    const devices = await Device.find({
      $or: [
        { brand: { $regex: q, $options: 'i' } },
        { model: { $regex: q, $options: 'i' } }
      ]
    }).lean();

    const result = await Promise.all(devices.map(async (device) => {
      const price = await PriceReference.findOne({ 
        device_id: device._id, 
        is_latest: true 
      }).lean();
      return {
        ...device,
        price_usd: price?.price_usd || 0,
        updated_at: price?.created_at || null,
        updated_by: price?.created_by || null,
        tax_idr: price?.tax_idr || 0
      };
    }));

    result.sort((a, b) => b.price_usd - a.price_usd);
    res.json({ status: 'ok', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get brands
exports.getBrands = async (req, res) => {
  try {
    const brands = await Device.distinct('brand');
    res.json({ status: 'ok', data: brands });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get latest/highest priced devices
exports.getLatest = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const prices = await PriceReference.find({ is_latest: true })
      .sort({ price_usd: -1 })
      .limit(limit)
      .lean();

    const result = await Promise.all(prices.map(async (price) => {
      const device = await Device.findById(price.device_id).lean();
      return {
        _id: device?._id,
        brand: device?.brand || 'Unknown',
        model: device?.model || 'Unknown',
        capacity: device?.capacity || '-',
        price_usd: price.price_usd,
        tax_idr: price.tax_idr
      };
    }));

    res.json({ status: 'ok', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get device by ID
exports.getById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id).lean();
    if (!device) return res.status(404).json({ status: 'error', message: 'Not found' });

    const prices = await PriceReference.find({ device_id: device._id })
      .sort({ created_at: -1 })
      .lean();

    res.json({ status: 'ok', data: { ...device, prices } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Add new price
exports.addPrice = async (req, res) => {
  try {
    const { device_id, price_usd, tax_idr, source, created_by } = req.body;

    await PriceReference.updateMany(
      { device_id, is_latest: true },
      { is_latest: false }
    );

    const price = await PriceReference.create({
      device_id,
      price_usd,
      tax_idr: tax_idr || 0,
      source: source || 'Manual Input',
      is_latest: true,
      created_by: created_by || 'customs_officer'
    });

    res.json({ status: 'ok', data: price });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Create new device
exports.createDevice = async (req, res) => {
  try {
    const { brand, model, capacity, price_usd, tax_idr, source } = req.body;

    let device = await Device.findOne({ brand, model, capacity });
    
    if (!device) {
      device = await Device.create({ brand, model, capacity });
    }

    await PriceReference.updateMany(
      { device_id: device._id, is_latest: true },
      { is_latest: false }
    );

    const price = await PriceReference.create({
      device_id: device._id,
      price_usd,
      tax_idr: tax_idr || 0,
      source: source || 'Manual Input',
      is_latest: true,
      created_by: 'customs_officer'
    });

    res.json({ status: 'ok', data: { device, price } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
