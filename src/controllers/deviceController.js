const { escapeRegex } = require('../utils/helpers');
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
      updated_by: '$price.created_by',
      price_id: '$price._id'
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
      const escaped = escapeRegex(q);
      match.$or = [
        { brand: { $regex: escaped, $options: 'i' } },
        { model: { $regex: escaped, $options: 'i' } }
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

// Create new device (invalidate cache with duplicate prevention)
exports.createDevice = async (req, res) => {
  try {
    let { brand, model, capacity, price_usd, tax_idr, source } = req.body;
    brand = (brand || '').trim();
    model = (model || '').trim();
    capacity = (capacity || '').trim();

    if (!brand || !model || !capacity) {
      return res.status(400).json({ status: 'error', message: 'Brand, model, dan kapasitas wajib diisi' });
    }

    // Case-insensitive exact match to prevent duplicates
    let device = await Device.findOne({
      brand: { $regex: `^${escapeRegex(brand)}$`, $options: 'i' },
      model: { $regex: `^${escapeRegex(model)}$`, $options: 'i' },
      capacity: { $regex: `^${escapeRegex(capacity)}$`, $options: 'i' }
    });
    
    let isNewDevice = false;
    if (!device) {
      device = await Device.create({ brand, model, capacity });
      isNewDevice = true;
    }

    await PriceReference.updateMany(
      { device_id: device._id, is_latest: true },
      { is_latest: false }
    );

    const price = await PriceReference.create({
      device_id: device._id,
      price_usd: parseFloat(price_usd) || 0,
      tax_idr: parseInt(tax_idr) || 0,
      source: source || 'Manual Input',
      is_latest: true,
      created_by: req.user?.username || 'customs_officer'
    });

    invalidateCache(); // Clear cache on data change

    res.json({
      status: 'ok',
      message: isNewDevice ? 'Device baru berhasil ditambahkan' : 'Device sudah ada, harga terbaru berhasil diperbarui (tidak membuat duplikat)',
      data: { device, price, is_new: isNewDevice }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// ==================== DUPLICATE DETECTION & CLEANUP ====================

function normalizeKey(str) {
  return (str || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeCapacity(str) {
  return (str || '').toString().trim().replace(/\s+/g, '').toLowerCase();
}

function normalizeModel(str) {
  let s = (str || '').toString().trim().toLowerCase();
  s = s.replace(/pro\s*max/gi, 'pro max');
  s = s.replace(/promax/gi, 'pro max');
  s = s.replace(/\s*\+\s*/g, ' plus ');
  return s.replace(/\s+/g, ' ').trim();
}

function canonicalModel(modelStr) {
  let s = (modelStr || '').toString().trim();
  s = s.replace(/\bpro\s*max\b/gi, 'Pro Max');
  s = s.replace(/\bpromax\b/gi, 'Pro Max');
  s = s.replace(/\bpro\b/gi, 'Pro');
  s = s.replace(/\bplus\b/gi, 'Plus');
  s = s.replace(/\bmini\b/gi, 'Mini');
  s = s.replace(/\s*\+\s*/g, ' Plus ');
  s = s.replace(/\biphone\b/gi, 'iPhone');
  return s.replace(/\s+/g, ' ').trim();
}

// Get list of all duplicate devices
exports.getDuplicates = async (req, res) => {
  try {
    const devices = await Device.aggregate([
      {
        $lookup: {
          from: 'price_references',
          let: { deviceId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$device_id', '$$deviceId'] } } },
            { $sort: { created_at: -1 } }
          ],
          as: 'prices'
        }
      }
    ]);

    const groups = {};
    devices.forEach(d => {
      const key = `${normalizeKey(d.brand)}:::${normalizeModel(d.model)}:::${normalizeCapacity(d.capacity)}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          brand: d.brand,
          model: canonicalModel(d.model),
          capacity: d.capacity,
          items: []
        };
      }
      
      const latestPrice = d.prices.find(p => p.is_latest) || d.prices[0] || null;
      groups[key].items.push({
        _id: d._id,
        brand: d.brand,
        model: d.model,
        capacity: d.capacity,
        created_at: d.created_at,
        price_count: d.prices.length,
        latest_price_usd: latestPrice?.price_usd ?? 0,
        latest_tax_idr: latestPrice?.tax_idr ?? 0,
        latest_price_id: latestPrice?._id ?? null,
        latest_source: latestPrice?.source ?? '-',
        latest_updated_at: latestPrice?.created_at ?? d.created_at
      });
    });

    // Filter only groups with > 1 device
    const duplicateGroups = Object.values(groups)
      .filter(g => g.items.length > 1)
      .map(g => ({
        ...g,
        count: g.items.length,
        items: g.items.sort((a, b) => new Date(b.latest_updated_at) - new Date(a.latest_updated_at))
      }));

    const totalDuplicateItems = duplicateGroups.reduce((acc, g) => acc + (g.count - 1), 0);

    res.json({
      status: 'ok',
      total_duplicate_groups: duplicateGroups.length,
      total_excess_items: totalDuplicateItems,
      data: duplicateGroups
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Auto clean and smart merge all duplicates
exports.autoCleanDuplicates = async (req, res) => {
  try {
    const devices = await Device.aggregate([
      {
        $lookup: {
          from: 'price_references',
          let: { deviceId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$device_id', '$$deviceId'] } } },
            { $sort: { created_at: -1 } }
          ],
          as: 'prices'
        }
      }
    ]);

    const groups = {};
    devices.forEach(d => {
      const key = `${normalizeKey(d.brand)}:::${normalizeModel(d.model)}:::${normalizeCapacity(d.capacity)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    let mergedGroups = 0;
    let deletedDevicesCount = 0;
    let reassignedPricesCount = 0;
    const summary = [];

    for (const key of Object.keys(groups)) {
      const list = groups[key];
      if (list.length <= 1) continue;

      // Sort to pick master: device with latest price or most recent update
      list.sort((a, b) => {
        const timeA = a.prices?.[0]?.created_at ? new Date(a.prices[0].created_at).getTime() : new Date(a.created_at).getTime();
        const timeB = b.prices?.[0]?.created_at ? new Date(b.prices[0].created_at).getTime() : new Date(b.created_at).getTime();
        return timeB - timeA;
      });

      const master = list[0];
      const duplicates = list.slice(1);
      const duplicateIds = duplicates.map(d => d._id);

      // Reassign all price references from duplicate devices to master
      const updateResult = await PriceReference.updateMany(
        { device_id: { $in: duplicateIds } },
        { $set: { device_id: master._id } }
      );
      reassignedPricesCount += (updateResult.modifiedCount || 0);

      // Ensure proper is_latest flag for master prices
      const allPrices = await PriceReference.find({ device_id: master._id }).sort({ created_at: -1 });
      if (allPrices.length > 0) {
        // Mark first one as latest, others as false
        await PriceReference.updateMany(
          { device_id: master._id },
          { $set: { is_latest: false } }
        );
        await PriceReference.findByIdAndUpdate(allPrices[0]._id, { $set: { is_latest: true } });
      }

      // Ensure master model has clean canonical formatting (e.g. iPhone 13 Pro Max)
      const cleanModel = canonicalModel(master.model);
      await Device.findByIdAndUpdate(master._id, { $set: { model: cleanModel } });

      // Delete duplicate Device documents
      const deleteResult = await Device.deleteMany({ _id: { $in: duplicateIds } });
      deletedDevicesCount += (deleteResult.deletedCount || 0);

      mergedGroups++;
      summary.push({
        model: `${master.brand} ${cleanModel} (${master.capacity})`,
        master_id: master._id,
        removed_duplicate_count: duplicates.length
      });
    }

    invalidateCache();

    res.json({
      status: 'ok',
      message: `Berhasil membersihkan ${mergedGroups} grup duplikat (${deletedDevicesCount} device ganda dihapus, ${reassignedPricesCount} riwayat harga diamankan).`,
      data: {
        merged_groups: mergedGroups,
        deleted_devices_count: deletedDevicesCount,
        reassigned_prices_count: reassignedPricesCount,
        summary
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Merge specific duplicate devices into a target device
exports.mergeDuplicates = async (req, res) => {
  try {
    const { target_device_id, source_device_ids } = req.body;
    if (!target_device_id || !Array.isArray(source_device_ids) || source_device_ids.length === 0) {
      return res.status(400).json({ status: 'error', message: 'target_device_id dan source_device_ids wajib disertakan' });
    }

    const master = await Device.findById(target_device_id);
    if (!master) {
      return res.status(404).json({ status: 'error', message: 'Target device tidak ditemukan' });
    }

    // Reassign all price references to target
    await PriceReference.updateMany(
      { device_id: { $in: source_device_ids } },
      { $set: { device_id: master._id } }
    );

    // Consolidate latest price
    const allPrices = await PriceReference.find({ device_id: master._id }).sort({ created_at: -1 });
    if (allPrices.length > 0) {
      await PriceReference.updateMany(
        { device_id: master._id },
        { $set: { is_latest: false } }
      );
      await PriceReference.findByIdAndUpdate(allPrices[0]._id, { $set: { is_latest: true } });
    }

    // Delete source devices
    const deleteRes = await Device.deleteMany({ _id: { $in: source_device_ids } });

    invalidateCache();

    res.json({
      status: 'ok',
      message: `Berhasil menggabungkan ${deleteRes.deletedCount} device ke ${master.brand} ${master.model}`,
      data: { master, merged_count: deleteRes.deletedCount }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Delete single device and its price references
exports.deleteDevice = async (req, res) => {
  try {
    const deviceId = req.params.device_id || req.params.id;
    const { delete_reason, deleted_by } = req.body || {};

    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ status: 'error', message: 'Device tidak ditemukan' });
    }

    // Delete all price references
    const priceRes = await PriceReference.deleteMany({ device_id: device._id });
    
    // Delete device document
    await Device.findByIdAndDelete(device._id);

    invalidateCache();

    res.json({
      status: 'ok',
      message: `Device ${device.brand} ${device.model} (${device.capacity}) dan ${priceRes.deletedCount} data harga berhasil dihapus`,
      deleted_device: device,
      deleted_prices_count: priceRes.deletedCount,
      reason: delete_reason || 'Pembersihan data duplikat/invalid'
    });
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
    const match = brand ? { brand: { $regex: `^${escapeRegex(brand)}$`, $options: 'i' } } : {};
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

// Get time range of recorded prices
exports.getTimeRange = async (req, res) => {
  try {
    const PriceReference = require('../models/PriceReference');
    
    const [oldest, newest] = await Promise.all([
      PriceReference.findOne().sort({ created_at: 1 }).select('created_at'),
      PriceReference.findOne().sort({ created_at: -1 }).select('created_at')
    ]);
    
    res.json({
      status: 'ok',
      data: {
        oldest: oldest?.created_at || null,
        newest: newest?.created_at || null
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

