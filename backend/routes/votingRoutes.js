// votingRoutes.js
const express = require('express');
const router = express.Router();
const votingController = require('../controllers/votingController');

// User routes
router.post('/apply', votingController.applyVoting);
router.post('/submit', votingController.submitVoting);
router.get('/status/:id', votingController.getVotingStatus);
router.get('/status/voting/:votingNo', votingController.checkStatusByVotingNo);
router.get('/applications/:id', votingController.getVotingApplicationById);
router.get('/download/:id', votingController.downloadPdf);
router.get('/pdf/:applicationId', votingController.downloadPdfWithPayment);
router.get('/download-status/:applicationId', votingController.getDownloadStatus); // This should be here
router.get('/history', votingController.getVotingHistory);
router.get('/stats', votingController.getVotingStats);

module.exports = router;