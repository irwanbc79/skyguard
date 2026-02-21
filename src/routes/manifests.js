const express = require('express');
const multer = require('multer');
const manifestController = require('../controllers/manifestController');
const { requireAuth } = require('../middleware/auth');

const ALLOWED_EXTENSIONS = ['.txt', '.csv', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = (file.originalname || '').toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.some(ext => extension.endsWith(ext));
    if (!isAllowed) {
      return cb(new Error('Format file manifest tidak didukung.'));
    }
    return cb(null, true);
  }
});

const router = express.Router();

router.get('/', manifestController.listManifests);
router.get('/:id', manifestController.getManifestDetail);
router.post('/upload', requireAuth, upload.single('file'), manifestController.uploadManifest);
router.put('/:id/review', requireAuth, manifestController.updateManifestStatus);
router.post('/:id/sync', requireAuth, manifestController.syncManifestPassengers);
router.get('/:id/passengers', manifestController.listManifestPassengers);
router.get('/:id/passengers/export', manifestController.exportManifestPassengers);

module.exports = router;
