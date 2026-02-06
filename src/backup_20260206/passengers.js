const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/passengerController');

router.get('/lookup/:passport', ctrl.lookup);
router.get('/alerts', ctrl.getAlerts);
router.get('/stats', ctrl.getStats);
router.get('/transactions', ctrl.searchTransactions);
router.post('/match-device', ctrl.matchDevice);

module.exports = router;
