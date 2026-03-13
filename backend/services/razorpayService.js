// services/razorpayService.js
const Razorpay = require('razorpay');
const logger = require('../utils/logger');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Verify if Razorpay is configured
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    logger.warn('Razorpay keys not configured properly');
}

module.exports = razorpay;