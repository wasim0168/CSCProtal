const express = require('express');
const router = express.Router();
const panController = require('../controllers/panController');
const panHistoryController = require('../controllers/panHistoryController');

// PAN Applications
router.post('/apply', panController.submitPan);
router.get('/applications', panController.getAllApplications);
router.get('/applications/:id', panController.getApplicationById);
router.put('/applications/:id', panController.updateApplication);
router.delete('/applications/:id', panController.deleteApplication);
router.post('/applications/:id/generate-pan', panController.generatePanNumber);
router.get('/stats', panController.getStats);

// PAN History
router.post('/history/store', panHistoryController.storePanHistory);
router.post('/history/get', panHistoryController.getPanHistory);
router.post('/admin/reveal-pan', panHistoryController.revealPan);

// Placeholder
router.post('/pan/apply', panController.panPlaceholder);

module.exports = router;