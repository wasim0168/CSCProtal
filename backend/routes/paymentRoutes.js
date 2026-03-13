const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.get('/razorpay-key', paymentController.getRazorpayKey);
router.post('/create-order', paymentController.createOrder);
router.post('/verify-payment', paymentController.verifyPayment);
router.get('/check-payment/:applicationId', paymentController.checkPaymentStatus);

module.exports = router;