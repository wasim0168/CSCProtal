const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 5001;

// =================== MIDDLEWARE ===================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});


// =================== MYSQL POOL ===================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '02769500',
    database: process.env.DB_NAME || 'pan_card_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL Connected successfully to:', process.env.DB_HOST || 'localhost');
        console.log('📊 Database:', process.env.DB_NAME || 'pan_card_system');
        connection.release();
    } catch (error) {
        console.error('❌ MySQL Connection error:', error.message);
    }
}
testConnection();
// =================== RAZORPAY SETUP ===================
const RAZORPAY_KEY_ID = 'rzp_test_SMngUYBcHEMnGI';      // Get from Razorpay Dashboard
const RAZORPAY_KEY_SECRET = 'TlLWitR5GKvf2pSulULc9Vkg';       // Get from Razorpay Dashboard

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});



// =================== HELPER FUNCTIONS ===================
function generateApplicationId() {
    return 'VOT' + Date.now();
}

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Helper function to get next application ID
async function getNextApplicationId() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [exists] = await connection.query(
            'SELECT * FROM id_sequence WHERE name = "application_id"'
        );
        
        if (exists.length === 0) {
            await connection.query(
                'INSERT INTO id_sequence (name, value) VALUES ("application_id", 1000)'
            );
        }
        
        await connection.query(
            'UPDATE id_sequence SET value = value + 1 WHERE name = "application_id"'
        );
        
        const [result] = await connection.query(
            'SELECT value FROM id_sequence WHERE name = "application_id"'
        );
        
        await connection.commit();
        return result[0].value;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Helper function to get next voting application ID
async function getNextVotingApplicationId() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [exists] = await connection.query(
            'SELECT * FROM id_sequence WHERE name = "voting_application_id"'
        );
        
        if (exists.length === 0) {
            await connection.query(
                'INSERT INTO id_sequence (name, value) VALUES ("voting_application_id", 1000)'
            );
        }
        
        await connection.query(
            'UPDATE id_sequence SET value = value + 1 WHERE name = "voting_application_id"'
        );
        
        const [result] = await connection.query(
            'SELECT value FROM id_sequence WHERE name = "voting_application_id"'
        );
        
        await connection.commit();
        return `VOT${result[0].value}`;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// =================== UPLOAD SETUP ===================
const uploadDir = path.join(__dirname, 'uploads/voting/pdfs');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const appId = req.params.id;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${appId}_${uniqueSuffix}.pdf`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (file.mimetype !== 'application/pdf') {
            cb(new Error('Only PDF files are allowed'));
        } else {
            cb(null, true);
        }
    }
});

// =================== SERVER START ===================
// Get Razorpay key for frontend
app.get('/api/razorpay-key', (req, res) => {
    res.json({ key: RAZORPAY_KEY_ID });
});
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

// =================== HEALTH CHECK ===================
app.get('/', (req, res) => {
    res.send('CSC Portal Backend Running 🚀');
});

app.get('/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is working!',
        time: new Date().toISOString()
    });
});

// Simple status check route
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

// ===================================================
// ================= PAN APPLICATIONS =================
// ===================================================

// Submit PAN application
app.post('/api/submit-pan', async (req, res) => {
    try {
        const { aadhar } = req.body;
        
        if (!aadhar || aadhar.length !== 12 || !/^\d+$/.test(aadhar)) {
            return res.status(400).json({ error: 'Invalid Aadhar number' });
        }

        const appId = await getNextApplicationId();

        const [result] = await pool.query(
            `INSERT INTO applications 
            (application_id, name, mobile, aadhar, password, type, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                appId,
                `User ${appId}`,
                '9876543210',
                aadhar,
                `PAN${appId}`,
                'pan',
                'pending'
            ]
        );

        const [newApp] = await pool.query(
            'SELECT * FROM applications WHERE id = ?',
            [result.insertId]
        );

        res.json({ 
            success: true, 
            message: 'Application submitted successfully',
            application: newApp[0]
        });
    } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all applications
app.get('/api/applications', async (req, res) => {
    try {
        const { type, search } = req.query;
        
        let query = 'SELECT * FROM applications WHERE 1=1';
        const params = [];

        if (type && type !== 'all') {
            query += ' AND type = ?';
            params.push(type);
        }

        if (search) {
            query += ` AND (name LIKE ? OR aadhar LIKE ? OR mobile LIKE ? OR application_id LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        query += ' ORDER BY application_id DESC';

        const [applications] = await pool.query(query, params);
        
        const transformedApps = applications.map(app => ({
            id: app.application_id,
            date: app.date,
            type: app.type,
            name: app.name,
            mobile: app.mobile,
            aadhar: app.aadhar,
            appNo: app.app_no,
            dob: app.dob,
            password: app.password,
            walletBal: app.wallet_bal,
            status: app.status,
            textFeed: app.text_feed,
            panNumber: app.pan_number,
            testScore: app.test_score,
            testStatus: app.test_status,
            examinerRemarks: app.examiner_remarks,
            documentStatus: app.document_status
        }));

        res.json(transformedApps);
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single application by ID
app.get('/api/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [applications] = await pool.query(
            'SELECT * FROM applications WHERE application_id = ?',
            [id]
        );

        if (applications.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const app = applications[0];
        const transformedApp = {
            id: app.application_id,
            date: app.date,
            type: app.type,
            name: app.name,
            mobile: app.mobile,
            aadhar: app.aadhar,
            appNo: app.app_no,
            dob: app.dob,
            password: app.password,
            walletBal: app.wallet_bal,
            status: app.status,
            textFeed: app.text_feed,
            panNumber: app.pan_number
        };

        res.json(transformedApp);
    } catch (error) {
        console.error('Error fetching application:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update application
app.put('/api/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const fieldMappings = {
            'appNo': 'app_no',
            'aadhar': 'aadhar',
            'panNumber': 'pan_number',
            'dob': 'dob',
            'walletBal': 'wallet_bal',
            'status': 'status',
            'textFeed': 'text_feed',
            'password': 'password',
            'name': 'name',
            'mobile': 'mobile',
            'testScore': 'test_score',
            'testStatus': 'test_status',
            'examinerRemarks': 'examiner_remarks',
            'documentStatus': 'document_status'
        };

        if (updates.status) {
            const validStatuses = ['pending', 'active', 'completed'];
            if (!validStatuses.includes(updates.status)) {
                return res.status(400).json({ 
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
                });
            }
        }

        if (updates.panNumber && updates.panNumber.trim() !== '') {
            const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
            if (!panRegex.test(updates.panNumber)) {
                return res.status(400).json({ 
                    error: 'Invalid PAN number format. Must be 10 characters: 5 letters, 4 numbers, 1 letter (e.g., ABCDE1234F)' 
                });
            }
        }

        if (updates.dob !== undefined) {
            if (updates.dob === null || updates.dob === '' || updates.dob === 'Invalid Date') {
                updates.dob = null;
            } else {
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(updates.dob)) {
                    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
                }
            }
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const updateFields = [];
            const params = [];

            Object.keys(updates).forEach(field => {
                if (fieldMappings[field] && updates[field] !== undefined) {
                    updateFields.push(`${fieldMappings[field]} = ?`);
                    params.push(updates[field]);
                }
            });

            if (updateFields.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            params.push(id);
            const query = `UPDATE applications SET ${updateFields.join(', ')} WHERE application_id = ?`;
            
            await connection.query(query, params);

            if (updates.panNumber) {
                const [app] = await connection.query(
                    'SELECT aadhar FROM applications WHERE application_id = ?',
                    [id]
                );

                if (app.length > 0 && app[0].aadhar) {
                    await connection.query(
                        `UPDATE pan_search_history 
                         SET pan_number = ?, status = 'completed', is_pan_visible = TRUE 
                         WHERE aadhar_number = ?`,
                        [updates.panNumber, app[0].aadhar]
                    );
                }
            }

            await connection.commit();

            const [updatedApp] = await connection.query(
                'SELECT * FROM applications WHERE application_id = ?',
                [id]
            );

            connection.release();

            if (updatedApp.length === 0) {
                return res.status(404).json({ error: 'Application not found' });
            }

            const app = updatedApp[0];
            const transformedApp = {
                id: app.application_id,
                date: app.date,
                type: app.type,
                name: app.name,
                mobile: app.mobile,
                aadhar: app.aadhar,
                panNumber: app.pan_number,
                appNo: app.app_no,
                dob: app.dob,
                password: app.password,
                walletBal: app.wallet_bal,
                status: app.status,
                textFeed: app.text_feed
            };

            res.json({ success: true, application: transformedApp });

        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }

    } catch (error) {
        console.error('Error updating application:', error);
        
        if (error.code === 'ER_TRUNCATED_WRONG_VALUE' || error.code === 'WARN_DATA_TRUNCATED') {
            return res.status(400).json({ 
                error: 'Invalid data format. Please check date fields and other inputs.' 
            });
        }
        
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Delete application
app.delete('/api/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [result] = await pool.query(
            'DELETE FROM applications WHERE application_id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        res.json({ success: true, message: 'Application deleted successfully' });
    } catch (error) {
        console.error('Error deleting application:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get application statistics
app.get('/api/stats', async (req, res) => {
    try {
        const [total] = await pool.query('SELECT COUNT(*) as count FROM applications');
        const [pan] = await pool.query('SELECT COUNT(*) as count FROM applications WHERE type = "pan"');
        const [ll] = await pool.query('SELECT COUNT(*) as count FROM applications WHERE type = "ll"');
        
        res.json({
            total: total[0].count,
            pan: pan[0].count,
            ll: ll[0].count
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generate PAN number for application
app.post('/api/applications/:id/generate-pan', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Generate a random PAN number format: ABCDE1234F
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const randomLetters = Array(5).fill().map(() => letters[Math.floor(Math.random() * 26)]).join('');
        const randomNumbers = Math.floor(1000 + Math.random() * 9000);
        const lastLetter = letters[Math.floor(Math.random() * 26)];
        const panNumber = `${randomLetters}${randomNumbers}${lastLetter}`;

        const [result] = await pool.query(
            'UPDATE applications SET pan_number = ? WHERE application_id = ?',
            [panNumber, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        res.json({ 
            success: true, 
            panNumber: panNumber,
            message: 'PAN number generated successfully'
        });

    } catch (error) {
        console.error('Error generating PAN:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===================================================
// ================= PAN HISTORY =====================
// ===================================================

// Store PAN search history
app.post('/api/pan-history/store', async (req, res) => {
    try {
        const { aadhar, userId } = req.body;
        
        if (!aadhar || aadhar.length !== 12) {
            return res.status(400).json({ error: 'Invalid Aadhar number' });
        }

        const sessionId = userId || req.headers['x-session-id'] || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const [result] = await pool.query(
            `INSERT INTO pan_search_history 
            (user_id, aadhar_number, ip_address, user_agent, status, is_pan_visible) 
            VALUES (?, ?, ?, ?, 'pending', FALSE)`,
            [sessionId, aadhar, ipAddress, userAgent]
        );

        const [applications] = await pool.query(
            'SELECT application_id, status, text_feed FROM applications WHERE aadhar = ? ORDER BY created_at DESC LIMIT 1',
            [aadhar]
        );

        let panNumber = null;
        let status = 'pending';
        
        if (applications.length > 0) {
            const app = applications[0];
            panNumber = `PAN${app.application_id}`;
            status = app.status;
            
            await pool.query(
                'UPDATE pan_search_history SET pan_number = ?, status = ? WHERE id = ?',
                [panNumber, status, result.insertId]
            );
        }

        res.json({ 
            success: true, 
            message: 'History stored successfully',
            sessionId: sessionId,
            historyId: result.insertId,
            application: applications.length > 0 ? applications[0] : null
        });

    } catch (error) {
        console.error('Error storing history:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user's PAN history
app.post('/api/pan-history/get', async (req, res) => {
    try {
        const { userId, aadhar } = req.body;
        
        let query = 'SELECT * FROM pan_search_history WHERE 1=1';
        const params = [];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        if (aadhar) {
            query += ' AND aadhar_number = ?';
            params.push(aadhar);
        }

        query += ' ORDER BY search_date DESC LIMIT 50';

        const [history] = await pool.query(query, params);

        for (let item of history) {
            const [applications] = await pool.query(
                'SELECT application_id, status, text_feed FROM applications WHERE aadhar = ? ORDER BY created_at DESC LIMIT 1',
                [item.aadhar_number]
            );

            if (applications.length > 0) {
                const app = applications[0];
                const panNumber = `PAN${app.application_id}`;
                
                if (item.pan_number !== panNumber || item.status !== app.status) {
                    await pool.query(
                        'UPDATE pan_search_history SET pan_number = ?, status = ?, is_pan_visible = ? WHERE id = ?',
                        [panNumber, app.status, app.status === 'completed', item.id]
                    );
                    item.pan_number = panNumber;
                    item.status = app.status;
                    item.is_pan_visible = app.status === 'completed';
                }
            }
        }

        const [updatedHistory] = await pool.query(
            'SELECT * FROM pan_search_history WHERE 1=1' + (userId ? ' AND user_id = ?' : '') + ' ORDER BY search_date DESC LIMIT 50',
            userId ? [userId] : []
        );

        const transformedHistory = updatedHistory.map(item => ({
            id: item.id,
            aadhar: item.aadhar_number.replace(/(\d{4})/g, '$1 ').trim(),
            panNumber: item.is_pan_visible ? item.pan_number : '•••••••••',
            serviceName: item.service_name,
            date: new Date(item.search_date).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            status: item.status,
            isPanVisible: item.is_pan_visible
        }));

        res.json({ 
            success: true, 
            history: transformedHistory,
            count: transformedHistory.length
        });

    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin endpoint to reveal PAN numbers (no auth required now)
app.post('/api/admin/reveal-pan', async (req, res) => {
    try {
        const [result] = await pool.query(
            `UPDATE pan_search_history ph
            JOIN applications a ON ph.aadhar_number = a.aadhar
            SET ph.is_pan_visible = TRUE, 
                ph.pan_number = CONCAT('PAN', a.application_id),
                ph.status = a.status
            WHERE a.status = 'completed' OR a.status = 'active'`
        );

        res.json({ 
            success: true, 
            message: `Updated ${result.affectedRows} records`,
            count: result.affectedRows
        });

    } catch (error) {
        console.error('Error revealing PAN:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===================================================
// ================= LL APPLICATIONS =================
// ===================================================

// Submit LL application
app.post('/api/submit-ll', async (req, res) => {
    try {
        const { appNo, dob, password } = req.body;
        
        if (!appNo || !dob || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [existing] = await pool.query(
            'SELECT * FROM applications WHERE app_no = ? AND type = "ll"',
            [appNo]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Application number already exists' });
        }

        const appId = await getNextApplicationId();

        const [result] = await pool.query(
            `INSERT INTO applications 
            (application_id, app_no, dob, password, type, status, name, mobile, aadhar, document_status) 
            VALUES (?, ?, ?, ?, 'll', 'pending', ?, ?, ?, 'pending')`,
            [
                appId,
                appNo,
                dob,
                password,
                `User ${appId}`,
                '9876543210',
                '000000000000'
            ]
        );

        await pool.query(
            `INSERT INTO ll_test_results (application_id, test_status) VALUES (?, 'pending')`,
            [appId]
        );

        const [newApp] = await pool.query(
            `SELECT a.*, lr.test_status, lr.test_score, lr.examiner_remarks 
             FROM applications a 
             LEFT JOIN ll_test_results lr ON a.application_id = lr.application_id 
             WHERE a.id = ?`,
            [result.insertId]
        );

        res.json({ 
            success: true, 
            message: 'LL application submitted successfully',
            application: transformLLApp(newApp[0])
        });

    } catch (error) {
        console.error('Error submitting LL application:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get LL applications with filters
app.get('/api/ll-applications', async (req, res) => {
    try {
        const { search, status } = req.query;
        
        let query = `
            SELECT a.*, lr.test_status, lr.test_score, lr.examiner_remarks, lr.test_date 
            FROM applications a 
            LEFT JOIN ll_test_results lr ON a.application_id = lr.application_id 
            WHERE a.type = 'll'
        `;
        const params = [];

        if (status && status !== 'all') {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (search) {
            query += ` AND (a.app_no LIKE ? OR a.name LIKE ? OR a.mobile LIKE ? OR a.application_id LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        query += ' ORDER BY a.created_at DESC';

        const [applications] = await pool.query(query, params);
        
        const transformedApps = applications.map(app => transformLLApp(app));

        res.json(transformedApps);
    } catch (error) {
        console.error('Error fetching LL applications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update LL test result
app.put('/api/ll-applications/:id/test-result', async (req, res) => {
    try {
        const { id } = req.params;
        const { testScore, testStatus, examinerRemarks } = req.body;

        if (!testStatus || !['pending', 'passed', 'failed'].includes(testStatus)) {
            return res.status(400).json({ error: 'Invalid test status' });
        }

        await pool.query(
            `UPDATE ll_test_results 
             SET test_score = ?, test_status = ?, examiner_remarks = ?, test_date = CURRENT_DATE 
             WHERE application_id = ?`,
            [testScore || 0, testStatus, examinerRemarks, id]
        );

        if (testStatus === 'passed') {
            await pool.query(
                'UPDATE applications SET status = "active" WHERE application_id = ?',
                [id]
            );
        } else if (testStatus === 'failed') {
            await pool.query(
                'UPDATE applications SET status = "pending" WHERE application_id = ?',
                [id]
            );
        }

        const [updatedApp] = await pool.query(
            `SELECT a.*, lr.test_status, lr.test_score, lr.examiner_remarks 
             FROM applications a 
             LEFT JOIN ll_test_results lr ON a.application_id = lr.application_id 
             WHERE a.application_id = ?`,
            [id]
        );

        res.json({ 
            success: true, 
            message: 'Test result updated successfully',
            application: transformLLApp(updatedApp[0])
        });

    } catch (error) {
        console.error('Error updating test result:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get LL application statistics
app.get('/api/ll-stats', async (req, res) => {
    try {
        const [total] = await pool.query(
            'SELECT COUNT(*) as count FROM applications WHERE type = "ll"'
        );
        
        const [pending] = await pool.query(
            'SELECT COUNT(*) as count FROM applications WHERE type = "ll" AND status = "pending"'
        );
        
        const [active] = await pool.query(
            'SELECT COUNT(*) as count FROM applications WHERE type = "ll" AND status = "active"'
        );
        
        const [passed] = await pool.query(
            `SELECT COUNT(*) as count FROM ll_test_results lr 
             JOIN applications a ON lr.application_id = a.application_id 
             WHERE a.type = "ll" AND lr.test_status = "passed"`
        );

        res.json({
            total: total[0].count,
            pending: pending[0].count,
            active: active[0].count,
            passed: passed[0].count
        });
    } catch (error) {
        console.error('Error fetching LL stats:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Helper function to transform LL application data
function transformLLApp(app) {
    return {
        id: app.application_id,
        date: app.date,
        type: app.type,
        name: app.name,
        mobile: app.mobile,
        aadhar: app.aadhar,
        appNo: app.app_no,
        dob: app.dob,
        password: app.password,
        walletBal: app.wallet_bal,
        status: app.status,
        textFeed: app.text_feed,
        testScore: app.test_score,
        testStatus: app.test_status || 'pending',
        examinerRemarks: app.examiner_remarks,
        documentStatus: app.document_status
    };
}

// ===================================================
// ================= VOTING APPLICATIONS =============
// ===================================================

// Submit Voting Application
app.post('/api/voting/apply', async (req, res) => {
    try {
        const {
            full_name,
            mobile,
            email,
            address
        } = req.body;

        if (!full_name || !mobile || !email || !address) {
            return res.status(400).json({ 
                error: 'All fields are required: full_name, mobile, email, address' 
            });
        }

        const application_id = generateApplicationId();
        const session_id = generateSessionId();

        await pool.query(
            `INSERT INTO voting_applications
            (application_id, user_session_id, full_name, mobile, email, address, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [application_id, session_id, full_name, mobile, email, address]
        );

        res.json({
            success: true,
            application_id,
            session_id,
            message: 'Application submitted successfully'
        });

    } catch (error) {
        console.error('Error submitting voting application:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Get Application Status
app.get('/api/voting/status/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(
            'SELECT * FROM voting_applications WHERE application_id = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const app = rows[0];
        res.json({
            application_id: app.application_id,
            status: app.status,
            full_name: app.full_name,
            mobile: app.mobile,
            email: app.email,
            created_at: app.created_at,
            completed_at: app.completed_at,
            pdf_available: !!(app.pdf_path && app.status === 'completed')
        });

    } catch (error) {
        console.error('Error fetching application:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Upload PDF - NO AUTH REQUIRED
app.post(
    '/api/admin/voting/upload/:id',
    upload.single('pdf'),
    async (req, res) => {
        try {
            const { id } = req.params;

            if (!req.file) {
                return res.status(400).json({ error: 'PDF file required' });
            }

            const pdfPath = `/uploads/voting/pdfs/${req.file.filename}`;

            const [result] = await pool.query(
                `UPDATE voting_applications
                 SET status = 'completed',
                     pdf_path = ?,
                     pdf_original_name = ?,
                     completed_at = NOW()
                 WHERE application_id = ?`,
                [pdfPath, req.file.originalname, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Application not found' });
            }

            res.json({
                success: true,
                message: 'PDF uploaded successfully',
                pdf_path: pdfPath
            });

        } catch (error) {
            console.error('Error uploading PDF:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Alternative admin upload endpoint - NO AUTH REQUIRED
app.post(
    '/api/admin/voting-applications/:id/upload-pdf',
    upload.single('pdf'),
    async (req, res) => {
        try {
            const { id } = req.params;

            if (!req.file) {
                return res.status(400).json({ error: 'PDF required' });
            }

            const pdfPath = `/uploads/voting/pdfs/${req.file.filename}`;

            const [result] = await pool.query(
                `UPDATE voting_applications
                 SET status = 'completed',
                     pdf_path = ?,
                     pdf_original_name = ?,
                     completed_at = NOW()
                 WHERE application_id = ?`,
                [pdfPath, req.file.originalname, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Application not found' });
            }

            res.json({
                success: true,
                message: 'PDF uploaded successfully'
            });

        } catch (error) {
            console.error('Error uploading PDF:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Download PDF
app.get('/api/voting/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sessionId = req.headers['x-session-id'];

        const [rows] = await pool.query(
            'SELECT * FROM voting_applications WHERE application_id = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const appData = rows[0];

        // Optional session check - remove if not needed
        if (appData.user_session_id && appData.user_session_id !== sessionId) {
            return res.status(403).json({ error: 'Access denied. Invalid session.' });
        }

        if (!appData.pdf_path || appData.status !== 'completed') {
            return res.status(404).json({ error: 'PDF not available' });
        }

        const filePath = path.join(__dirname, appData.pdf_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'PDF file not found on server' });
        }

        res.download(filePath, appData.pdf_original_name || `voting_${id}.pdf`);

    } catch (error) {
        console.error('Error downloading PDF:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: Get single voting application by ID - NO AUTH REQUIRED
app.get("/api/voting/pdf/:id", async (req, res) => {
    const applicationId = req.params.id;

    try {
        const [rows] = await pool.query(
            "SELECT pdf_path, pdf_original_name FROM voting_applications WHERE application_id = ?",
            [applicationId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Application not found" });
        }

        const pdfPath = rows[0].pdf_path;
        const originalName = rows[0].pdf_original_name;

        if (!pdfPath) {
            return res.status(404).json({ error: "PDF not uploaded yet" });
        }

        const fullPath = path.join(__dirname, pdfPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: "File not found on server" });
        }

        res.download(fullPath, originalName || "voting-card.pdf");

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});
// const name = new type(arguments);

// Get user's voting history
app.get('/api/voting/history', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID required' });
        }

        const [applications] = await pool.query(
            'SELECT * FROM voting_applications WHERE user_session_id = ? ORDER BY created_at DESC',
            [sessionId]
        );
        
        const history = applications.map(app => ({
            application_id: app.application_id,
            full_name: app.full_name,
            status: app.status,
            date: app.created_at,
            pdf_available: !!(app.pdf_path && app.status === 'completed')
        }));

        res.json({ 
            success: true, 
            history,
            count: history.length
        });

    } catch (error) {
        console.error('Error fetching voting history:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: Get all voting applications - NO AUTH REQUIRED
app.get('/api/admin/voting/all', async (req, res) => {
    try {
        const [applications] = await pool.query(
            'SELECT * FROM voting_applications ORDER BY created_at DESC'
        );

        res.json({
            success: true,
            applications,
            count: applications.length
        });

    } catch (error) {
        console.error('Error fetching voting applications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: Get all voting applications with pagination - NO AUTH REQUIRED
app.get('/api/admin/voting-applications', async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = 'SELECT * FROM voting_applications WHERE 1=1';
        const params = [];
        const countParams = [];

        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
            countParams.push(status);
        }

        if (search) {
            query += ` AND (voting_card_no LIKE ? OR state LIKE ? OR application_id LIKE ? OR full_name LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        const countQuery = query.replace(
            'SELECT *', 
            'SELECT COUNT(*) as total'
        );
        const [countResult] = await pool.query(countQuery, countParams);

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [applications] = await pool.query(query, params);
        
        const transformedApps = applications.map(app => transformVotingApp(app));

        res.json({
            applications: transformedApps,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(countResult[0].total / limit),
                totalItems: countResult[0].total,
                itemsPerPage: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error fetching voting applications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: Update application status - NO AUTH REQUIRED
app.put('/api/admin/voting-applications/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        const validStatuses = ['pending', 'processing', 'completed', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const updateData = {
            status: status
        };

        if (status === 'completed') {
            updateData.completed_at = new Date();
        }

        const [result] = await pool.query(
            'UPDATE voting_applications SET ? WHERE application_id = ? OR id = ?',
            [updateData, id, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        res.json({ 
            success: true, 
            message: `Status updated to ${status}` 
        });

    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get voting statistics
app.get('/api/voting/stats', async (req, res) => {
    try {
        const [total] = await pool.query('SELECT COUNT(*) as count FROM voting_applications');
        const [pending] = await pool.query('SELECT COUNT(*) as count FROM voting_applications WHERE status = "pending"');
        const [completed] = await pool.query('SELECT COUNT(*) as count FROM voting_applications WHERE status = "completed"');
        
        res.json({
            total: total[0].count,
            pending: pending[0].count,
            completed: completed[0].count
        });
    } catch (error) {
        console.error('Error fetching voting stats:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Helper function to transform voting application data
function transformVotingApp(app) {
    return {
        id: app.application_id,
        internalId: app.id,
        votingCardNo: app.voting_card_no,
        fullName: app.full_name,
        mobile: app.mobile,
        email: app.email,
        address: app.address,
        state: app.state,
        date: app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : '-',
        status: app.status,
        paymentStatus: app.payment_status,
        amount: app.amount || 50,
        pdfUrl: app.pdf_path ? `/api/voting/download/${app.application_id}` : null,
        pdfName: app.pdf_original_name,
        canDownload: app.status === 'completed' && app.pdf_path
    };
}
// ================= USER SUBMIT VOTING APPLICATION =================

app.post('/api/voting/submit', async (req, res) => {
    try {
        const { votingNo, state } = req.body;

        if (!votingNo || !state) {
            return res.status(400).json({ error: 'Voting number and state required' });
        }

        // Generate IDs
        const applicationId = 'VOT' + Math.floor(100000 + Math.random() * 900000);
        const sessionId = 'SES' + Date.now();

        await pool.query(
            `INSERT INTO voting_applications
            (application_id, voting_card_no, state, user_session_id, status, amount)
            VALUES (?, ?, ?, ?, 'pending', 50)`,
            [applicationId, votingNo.trim(), state.trim(), sessionId]
        );

        res.json({
            success: true,
            sessionId,
            application: {
                id: applicationId
            }
        });

    } catch (error) {
        console.error("Submit Error:", error);
        res.status(500).json({ error: error.message });
    }
});
// ================= CHECK STATUS =================

app.get('/api/voting/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(
            `SELECT application_id, status, pdf_path 
             FROM voting_applications 
             WHERE application_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const app = rows[0];

        res.json({
            id: app.application_id,
            status: app.status,
            canDownload: app.status === 'completed'
        });

    } catch (error) {
        console.error("Status Error:", error);
        res.status(500).json({ error: error.message });
    }
});
// ===================================================
// ================= PLACEHOLDER ENDPOINTS ===========
// ===================================================

// PAN placeholder
app.post('/api/pan/apply', (req, res) => {
    res.json({ message: 'PAN API placeholder working' });
});

// LL placeholder
app.post('/api/ll/apply', (req, res) => {
    res.json({ message: 'LL API placeholder working' });
});

// =================== START SERVER ===================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Upload directory: ${uploadDir}`);
});