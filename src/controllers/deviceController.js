const Device = require('../models/Device');
const PriceReference = require('../models/PriceReference');

// ==================== CACHE ====================
let deviceCache = { data: null, grouped: null, timestamp: 0 };
const CACHE_TTL = 60000; // 1 menit

function invalidateCache() {
  deviceCache = { data: null, grouped: null, timestamp: 0 };
}

// ==================== AGGREGATION PIPELINE ====================
const getDevicesWithPricesPipeline = (match = {}) => [
  ...(Object.keys(match).length ? [{ $match: match }] : []),
  {
    $lookup: {
      from: 'price_references',
      let: { deviceId: '$_id' },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$device_id', '$$deviceId'] }, { $eq: ['$is_latest', true] }] } } },
        { $limit: 1 }
      ],
      as: 'price'
    }
  },
  { $unwind: { path: '$price', preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 1, brand: 1, model: 1, capacity: 1,
      price_usd: { $ifNull: ['$price.price_usd', 0] },
      tax_idr: { $ifNull: ['$price.tax_idr', 0] },
      updated_at: '$price.created_at',
      updated_by: '$price.created_by'
    }
  },
  { $sort: { price_usd: -1 } }
];

// ==================== CONTROLLERS ====================

// Get all devices grouped by brand (OPTIMIZED)
exports.getAll = async (req, res) => {
  try {
    const now = Date.now();
    
    // Return cache if valid
    if (deviceCache.grouped && (now - deviceCache.timestamp) < CACHE_TTL) {
      return res.json({ status: 'ok', data: deviceCache.grouped, total: deviceCache.data?.length || 0, cached: true });
    }

    // Single aggregation query
    const result = await Device.aggregate(getDevicesWithPricesPipeline());

    // Group by brand
    const grouped = {};
    result.forEach(d => {
      if (!grouped[d.brand]) grouped[d.brand] = [];
      grouped[d.brand].push(d);
    });

    // Update cache
    deviceCache = { data: result, grouped, timestamp: now };

    res.json({ status: 'ok', data: grouped, total: result.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Search devices (OPTIMIZED)
exports.search = async (req, res) => {
  try {
    const { q, brand } = req.query;
    
    // Build match query
    const match = {};
    if (q) {
      match.$or = [
        { brand: { $regex: q, $options: 'i' } },
        { model: { $regex: q, $options: 'i' } }
      ];
    }
    if (brand) {
      match.brand = brand;
    }

    if (!q && !brand) {
      return res.json({ status: 'ok', data: [], count: 0 });
    }

    // Single aggregation query
    const result = await Device.aggregate(getDevicesWithPricesPipeline(match));

    res.json({ status: 'ok', data: result, count: result.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get brands (OPTIMIZED with cache)
exports.getBrands = async (req, res) => {
  try {
    // Use cached data if available
    if (deviceCache.grouped) {
      return res.json({ status: 'ok', data: Object.keys(deviceCache.grouped) });
    }
    
    const brands = await Device.distinct('brand');
    res.json({ status: 'ok', data: brands });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get latest/highest priced devices (OPTIMIZED)
exports.getLatest = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    
    const result = await Device.aggregate([
      ...getDevicesWithPricesPipeline(),
      { $limit: limit }
    ]);

    res.json({ status: 'ok', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get device by ID with price history
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

// Add new price (invalidate cache)
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

    invalidateCache(); // Clear cache on data change

    res.json({ status: 'ok', data: price });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Create new device (invalidate cache)
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

    invalidateCache(); // Clear cache on data change

    res.json({ status: 'ok', data: { device, price } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Manual cache invalidation endpoint
exports.clearCache = (req, res) => {
  invalidateCache();
  res.json({ status: 'ok', message: 'Cache cleared' });
};

// ==================== 3-LEVEL GROUPING ====================
function extractSeriesAndModel(model) {
  const iphoneMatch = model.match(/^iPhone\s*(\d+)\s*(.*)?$/i);
  if (iphoneMatch) {
    const series = iphoneMatch[1];
    const variant = iphoneMatch[2]?.trim() || '';
    const fullModel = variant ? `iPhone ${series} ${variant}` : `iPhone ${series}`;
    return { series, fullModel };
  }
  const galaxySMatch = model.match(/^Galaxy\s*(S\d+)\s*(.*)?$/i);
  if (galaxySMatch) {
    const series = galaxySMatch[1];
    const variant = galaxySMatch[2]?.trim() || '';
    const fullModel = variant ? `Galaxy ${series} ${variant}` : `Galaxy ${series}`;
    return { series, fullModel };
  }
  const galaxyZMatch = model.match(/^Galaxy\s*(Z\s*(?:Fold|Flip)\s*\d*)\s*(.*)?$/i);
  if (galaxyZMatch) {
    const series = galaxyZMatch[1].replace(/\s+/g, ' ').trim();
    const variant = galaxyZMatch[2]?.trim() || '';
    const fullModel = variant ? `Galaxy ${series} ${variant}` : `Galaxy ${series}`;
    return { series, fullModel };
  }
  return { series: 'Other', fullModel: model };
}

function capacityOrder(cap) {
  const match = cap.match(/(\d+)\s*(TB|GB|MB)/i);
  if (!match) return 0;
  const num = parseInt(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'TB') return num * 1024;
  if (unit === 'GB') return num;
  return num / 1024;
}

exports.getGroupedByType = async (req, res) => {
  try {
    const { brand } = req.query;
    const match = brand ? { brand: { $regex: `^${brand}$`, $options: 'i' } } : {};
    const result = await Device.aggregate(getDevicesWithPricesPipeline(match));
    
    const seriesMap = {};
    result.forEach(d => {
      const { series, fullModel } = extractSeriesAndModel(d.model);
      if (!seriesMap[series]) seriesMap[series] = { series, models: {} };
      if (!seriesMap[series].models[fullModel]) {
        seriesMap[series].models[fullModel] = { model: fullModel, brand: d.brand, variants: [] };
      }
      seriesMap[series].models[fullModel].variants.push({
        _id: d._id, capacity: d.capacity, price_id: d.price_id,
        price_usd: d.price_usd, tax_idr: d.tax_idr, source: d.source, updated_at: d.updated_at
      });
    });
    
    const seriesArray = Object.values(seriesMap).map(s => ({
      series: s.series,
      models: Object.values(s.models).map(m => ({
        ...m, variants: m.variants.sort((a, b) => capacityOrder(a.capacity) - capacityOrder(b.capacity))
      })).sort((a, b) => a.model.localeCompare(b.model))
    })).sort((a, b) => {
      const numA = parseInt(a.series.match(/\d+/)?.[0]) || 0;
      const numB = parseInt(b.series.match(/\d+/)?.[0]) || 0;
      return numB - numA;
    });
    
    res.json({ status: 'ok', data: seriesArray });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// ==================== EDIT DEVICE & PRICE ====================
exports.editDevice = async (req, res) => {
  try {
    const { device_id } = req.params;
    const { model, capacity, edited_by, edit_reason } = req.body;
    const existingDevice = await Device.findById(device_id);
    if (!existingDevice) return res.status(404).json({ status: 'error', message: 'Device not found' });
    const updatedDevice = await Device.findByIdAndUpdate(device_id, {
      model: model || existingDevice.model,
      capacity: capacity || existingDevice.capacity,
      edited_at: new Date(), edited_by: edited_by || 'customs_officer',
      edit_reason: edit_reason || 'Koreksi nama device'
    }, { new: true });
    invalidateCache();
    res.json({ status: 'ok', data: updatedDevice, message: 'Device berhasil diupdate' });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
};

exports.editPrice = async (req, res) => {
  try {
    const { price_id } = req.params;
    const { price_usd, tax_idr, edited_by, edit_reason } = req.body;
    const existingPrice = await PriceReference.findById(price_id);
    if (!existingPrice) return res.status(404).json({ status: 'error', message: 'Price not found' });
    const updatedPrice = await PriceReference.findByIdAndUpdate(price_id, {
      price_usd: price_usd || existingPrice.price_usd,
      tax_idr: tax_idr !== undefined ? tax_idr : existingPrice.tax_idr,
      edited_at: new Date(), edited_by: edited_by || 'customs_officer',
      edit_reason: edit_reason || 'Koreksi harga'
    }, { new: true });
    invalidateCache();
    res.json({ status: 'ok', data: updatedPrice, message: 'Harga berhasil diupdate' });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
};

exports.getPriceHistory = async (req, res) => {
  try {
    const { price_id } = req.params;
    const price = await PriceReference.findById(price_id).lean();
    if (!price) return res.status(404).json({ status: 'error', message: 'Price not found' });
    res.json({ status: 'ok', data: { current: { price_usd: price.price_usd, tax_idr: price.tax_idr }, history: price.edit_history || [] }});
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
};
