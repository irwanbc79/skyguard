const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { requireAuth } = require('../middleware/auth');

router.get('/', deviceController.getAll);
router.get('/search', deviceController.search);
router.get('/brands', deviceController.getBrands);
router.get('/latest', deviceController.getLatest);
router.get('/time-range', deviceController.getTimeRange);
router.get('/grouped', deviceController.getGroupedByType);
router.post('/clear-cache', requireAuth, deviceController.clearCache);
router.get('/:id', deviceController.getById);

router.post('/', requireAuth, deviceController.createDevice);
router.post('/price', requireAuth, deviceController.addPrice);

router.put('/device/:device_id', requireAuth, deviceController.editDevice);
router.put('/price/:price_id', requireAuth, deviceController.editPrice);
router.get('/price/:price_id/history', deviceController.getPriceHistory);

module.exports = router;
