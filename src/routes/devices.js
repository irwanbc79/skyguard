const express = require('express');
const router = express.Router();
const controller = require('../controllers/deviceController');

router.get('/all', controller.getAll);
router.get('/search', controller.search);
router.get('/brands', controller.getBrands);
router.get('/latest', controller.getLatest);
router.get('/:id', controller.getById);
router.post('/', controller.createDevice);
router.post('/price', controller.addPrice);

module.exports = router;
