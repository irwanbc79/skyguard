const Device = require('../models/Device');
const PriceReference = require('../models/PriceReference');

exports.search = async (req, res) => {
  try {
    const { q, brand } = req.query;
    const filter = {};
    
    if (q) {
      filter.$or = [
        { brand: { $regex: q, $options: 'i' } },
        { model: { $regex: q, $options: 'i' } }
      ];
    }
    if (brand) filter.brand = { $regex: brand, $options: 'i' };

    const devices = await Device.aggregate([
      { $match: filter },
      { $lookup: { from: 'price_references', localField: '_id', foreignField: 'device_id', as: 'price' } },
      { $unwind: '$price' },
      { $match: { 'price.is_latest': true } },
      { $project: { brand: 1, model: 1, capacity: 1, price_usd: '$price.price_usd', tax_idr: '$price.tax_idr', updated_at: '$price.created_at' } },
      { $sort: { brand: 1, model: 1, capacity: 1 } },
      { $limit: 100 }
    ]);

    res.json({ success: true, count: devices.length, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

    const prices = await PriceReference.find({ device_id: device._id }).sort({ created_at: -1 });
    res.json({ success: true, data: { ...device.toObject(), prices } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getBrands = async (req, res) => {
  try {
    const brands = await Device.distinct('brand');
    res.json({ success: true, data: brands });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getLatest = async (req, res) => {
  try {
    const devices = await Device.aggregate([
      { $lookup: { from: 'price_references', localField: '_id', foreignField: 'device_id', as: 'price' } },
      { $unwind: '$price' },
      { $match: { 'price.is_latest': true } },
      { $sort: { 'price.created_at': -1 } },
      { $limit: 10 },
      { $project: { brand: 1, model: 1, capacity: 1, price_usd: '$price.price_usd', tax_idr: '$price.tax_idr' } }
    ]);
    res.json({ success: true, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.addPrice = async (req, res) => {
  try {
    const { device_id, price_usd, tax_idr, source, created_by } = req.body;
    
    // Set is_latest=false untuk harga lama
    await PriceReference.updateMany({ device_id }, { is_latest: false });
    
    const price = await PriceReference.create({
      device_id, price_usd, tax_idr: tax_idr || 0, source, is_latest: true, created_by
    });
    
    res.status(201).json({ success: true, data: price });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
