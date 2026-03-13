const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const upload = require('../middleware/uploadMiddleware');

// Voting admin routes
router.get('/voting/all', adminController.getAllVotingApplications);
router.get('/voting-applications', adminController.getVotingApplicationsPaginated);
router.put('/voting-applications/:id/status', adminController.updateApplicationStatus);
router.post('/voting/upload/:id', upload.single('pdf'), adminController.uploadVotingPdf);
router.post('/voting-applications/:id/upload-pdf', upload.single('pdf'), adminController.uploadVotingPdfAlt);
router.get('/voting/pdf/:id', adminController.getPdfById);

module.exports = router;