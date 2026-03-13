// routes/llRoutes.js
const express = require('express');
const router = express.Router();
const llController = require('../controllers/llController');

// This should be the correct endpoint for LL submissions
router.post('/submit-ll', llController.submitLl);  // This makes it /api/submit-ll

// Alternative if you want /api/ll/apply
// router.post('/apply', llController.submitLl);  // This would be /api/ll/apply

router.get('/applications', llController.getLlApplications);
router.put('/applications/:id/test-result', llController.updateTestResult);
router.get('/stats', llController.getLlStats);
router.put('/ll-applications/:id/test-result', llController.updateTestResult);
module.exports = router;