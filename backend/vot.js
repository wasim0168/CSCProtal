const express = require('express');
const mysql = require('mysql2');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Database connection
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '02769500',
    database: 'pan_card_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

// ============ RAZORPAY CONFIGURATION ============
// REPLACE THESE WITH YOUR ACTUAL TEST KEYS
const RAZORPAY_KEY_ID = 'rzp_test_SMngUYBcHEMnGI';      // Get from Razorpay Dashboard
const RAZORPAY_KEY_SECRET = 'TlLWitR5GKvf2pSulULc9Vkg';       // Get from Razorpay Dashboard

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// Test route
app.get('/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is working!',
        razorpay_configured: !!RAZORPAY_KEY_ID && RAZORPAY_KEY_ID !== 'rzp_test_SMngUYBcHEMnGI'
    });
});

// Get Razorpay key for frontend
app.get('/api/razorpay-key', (req, res) => {
    res.json({ key: RAZORPAY_KEY_ID });
});

// Create payment order
app.post('/api/create-order', async (req, res) => {
    const { applicationId, amount } = req.body;

    try {
        // Check if application exists
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
            amount: amount * 100, // Razorpay expects amount in paise
            currency: 'INR',
            receipt: `receipt_${applicationId}_${Date.now()}`,
            payment_capture: 1
        };

        console.log('Creating order with options:', options);
        const order = await razorpay.orders.create(options);
        console.log('Order created:', order);

        // Store order in database
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
});

// Verify payment
app.post('/api/verify-payment', async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        applicationId
    } = req.body;

    try {
        // Generate signature for verification
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

        // Verify signature
        if (expectedSignature === razorpay_signature) {
            // Payment verified successfully
            await pool.query(
                `UPDATE payment_orders 
                 SET status = 'success', payment_id = ? 
                 WHERE order_id = ?`,
                [razorpay_payment_id, razorpay_order_id]
            );

            // Mark payment as completed in voting_applications
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
            // Payment verification failed
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
});

// Check if payment is completed for an application
app.get('/api/check-payment/:applicationId', async (req, res) => {
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
});

// Download PDF (with payment check)
app.get('/api/voting/pdf/:applicationId', async (req, res) => {
    const { applicationId } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    try {
        // Check application details
        const [rows] = await pool.query(
            `SELECT pdf_path, payment_status, download_count 
             FROM voting_applications 
             WHERE application_id = ?`,
            [applicationId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        const application = rows[0];

        // Check if payment is completed
        if (application.payment_status !== 'completed') {
            return res.status(403).json({
                success: false,
                error: 'Payment required to download PDF',
                paymentRequired: true
            });
        }

        // CHECK DOWNLOAD LIMIT - Only one download allowed
        if (application.download_count >= 1) {
            return res.status(403).json({
                success: false,
                error: 'Download limit exceeded. PDF can only be downloaded once.',
                downloadCount: application.download_count
            });
        }

        // Check if PDF exists
        if (!application.pdf_path) {
            return res.status(404).json({
                success: false,
                error: 'PDF not found'
            });
        }

        // Send the PDF file
        const pdfPath = path.join(__dirname, application.pdf_path);
        if (fs.existsSync(pdfPath)) {
            // Track the download in database
            await pool.query(
                `UPDATE voting_applications 
                 SET download_count = download_count + 1,
                     last_downloaded_at = NOW()
                 WHERE application_id = ?`,
                [applicationId]
            );

            // Also log in downloads table
            await pool.query(
                `INSERT INTO pdf_downloads (application_id, ip_address, user_agent)
                 VALUES (?, ?, ?)`,
                [applicationId, ipAddress, userAgent]
            );

            // Send file
            res.download(pdfPath);
        } else {
            res.status(404).json({
                success: false,
                error: 'PDF file not found on server'
            });
        }

    } catch (err) {
        console.error('PDF download error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to download PDF'
        });
    }
});

app.get('/api/download-status/:applicationId', async (req, res) => {
    const { applicationId } = req.params;

    try {
        const [rows] = await pool.query(
            `SELECT download_count, last_downloaded_at 
             FROM voting_applications 
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
            downloadCount: rows[0].download_count || 0,
            lastDownloaded: rows[0].last_downloaded_at,
            canDownload: (rows[0].download_count || 0) < 1
        });

    } catch (err) {
        console.error('Download status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to check download status'
        });
    }
});
// Status check endpoint
app.get("/api/voting/status/:votingNo", async (req, res) => {
    const votingNo = req.params.votingNo;
    
    try {
        const [rows] = await pool.query(
            `SELECT application_id, status, pdf_path, payment_status, download_count, last_downloaded_at
             FROM voting_applications 
             WHERE voting_card_no = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [votingNo]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Application not found"
            });
        }

        const application = rows[0];
        const downloadCount = application.download_count || 0;

        res.json({
            success: true,
            applicationId: application.application_id,
            status: application.status,
            paymentStatus: application.payment_status || 'pending',
            canDownload: application.pdf_path ? true : false,
            downloadCount: downloadCount,
            alreadyDownloaded: downloadCount >= 1,
            lastDownloaded: application.last_downloaded_at
        });

    } catch (err) {
        console.error("Status check error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// Create payment_orders table
async function createPaymentTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id VARCHAR(100) UNIQUE NOT NULL,
                application_id VARCHAR(50) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                payment_id VARCHAR(100),
                status VARCHAR(50) DEFAULT 'created',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (application_id) REFERENCES voting_applications(application_id)
            )
        `);
        console.log('✅ Payment orders table ready');
    } catch (err) {
        console.error('Error creating payment table:', err);
    }
}

createPaymentTable();

// Start server
const PORT = 5001;
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📝 Test endpoint: http://localhost:${PORT}/test`);
    console.log(`💰 Razorpay Key ID: ${RAZORPAY_KEY_ID}`);
    console.log(`💰 Razorpay configured: ${RAZORPAY_KEY_ID !== 'rzp_test_YOUR_ACTUAL_KEY_ID'}`);
    console.log('='.repeat(50) + '\n');
});