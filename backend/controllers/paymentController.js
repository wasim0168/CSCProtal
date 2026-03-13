const pool = require('../config/db');
const { razorpay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = require('../config/razorpay');
const crypto = require('crypto');

// Get Razorpay key for frontend
const getRazorpayKey = (req, res) => {
    res.json({ key: RAZORPAY_KEY_ID });
};

// Create payment order
const createOrder = async (req, res) => {
    const { applicationId, amount } = req.body;

    try {
        const [appCheck] = await pool.query(
            'SELECT application_id FROM voting_applications WHERE application_id = ?',
            [applicationId]
        );

        if (appCheck.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        const options = {
            amount: amount * 100,
            currency: 'INR',
            receipt: `receipt_${applicationId}_${Date.now()}`,
            payment_capture: 1
        };

        console.log('Creating order with options:', options);
        const order = await razorpay.orders.create(options);
        console.log('Order created:', order);

        await pool.query(
            `INSERT INTO payment_orders (order_id, application_id, amount, status) 
             VALUES (?, ?, ?, 'created')`,
            [order.id, applicationId, amount]
        );

        res.json({
            success: true,
            order: order
        });

    } catch (err) {
        console.error('Order creation error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to create payment order: ' + err.message
        });
    }
};

// Verify payment
const verifyPayment = async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        applicationId
    } = req.body;

    try {
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        console.log('Verifying payment:', {
            order_id: razorpay_order_id,
            payment_id: razorpay_payment_id,
            signature: razorpay_signature,
            expected: expectedSignature
        });

        if (expectedSignature === razorpay_signature) {
            await pool.query(
                `UPDATE payment_orders 
                 SET status = 'success', payment_id = ? 
                 WHERE order_id = ?`,
                [razorpay_payment_id, razorpay_order_id]
            );

            await pool.query(
                `UPDATE voting_applications 
                 SET payment_status = 'completed' 
                 WHERE application_id = ?`,
                [applicationId]
            );

            res.json({
                success: true,
                message: 'Payment verified successfully'
            });
        } else {
            await pool.query(
                `UPDATE payment_orders 
                 SET status = 'failed' 
                 WHERE order_id = ?`,
                [razorpay_order_id]
            );

            res.status(400).json({
                success: false,
                error: 'Payment verification failed'
            });
        }

    } catch (err) {
        console.error('Payment verification error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to verify payment: ' + err.message
        });
    }
};

// Check payment status for an application
const checkPaymentStatus = async (req, res) => {
    const { applicationId } = req.params;

    try {
        const [rows] = await pool.query(
            `SELECT payment_status FROM voting_applications 
             WHERE application_id = ?`,
            [applicationId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        res.json({
            success: true,
            paymentStatus: rows[0].payment_status
        });

    } catch (err) {
        console.error('Check payment error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to check payment status'
        });
    }
};

module.exports = {
    getRazorpayKey,
    createOrder,
    verifyPayment,
    checkPaymentStatus
};