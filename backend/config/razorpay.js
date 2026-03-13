const Razorpay = require('razorpay');

const RAZORPAY_KEY_ID = 'rzp_test_SMngUYBcHEMnGI';
const RAZORPAY_KEY_SECRET = 'TlLWitR5GKvf2pSulULc9Vkg';

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

module.exports = {
    razorpay,
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET
};