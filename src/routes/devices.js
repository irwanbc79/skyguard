const router = require('express').Router();
const ctrl = require('../controllers/deviceController');

router.get('/search', ctrl.search);
router.get('/brands', ctrl.getBrands);
router.get('/latest', ctrl.getLatest);
router.get('/:id', ctrl.getById);
router.post('/price', ctrl.addPrice);

module.exports = router;
