const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

router.get('/', deviceController.getAll);
router.get('/search', deviceController.search);
router.get('/brands', deviceController.getBrands);
router.get('/latest', deviceController.getLatest);
router.get('/time-range', deviceController.getTimeRange);
router.get('/grouped', deviceController.getGroupedByType);
router.get('/clear-cache', deviceController.clearCache);
router.get('/:id', deviceController.getById);

router.post('/', deviceController.createDevice);
router.post('/price', deviceController.addPrice);

router.put('/device/:device_id', deviceController.editDevice);
router.put('/price/:price_id', deviceController.editPrice);
router.get('/price/:price_id/history', deviceController.getPriceHistory);

module.exports = router;
