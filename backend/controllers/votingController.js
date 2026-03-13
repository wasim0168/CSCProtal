const pool = require('../config/db');
const { generateApplicationId, generateSessionId } = require('../utils/idGenerator');
const fs = require('fs');
const path = require('path');

// Helper function to transform voting application data
const transformVotingApp = (app) => {
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
};

// Submit Voting Application (old method)
const applyVoting = async (req, res) => {
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
};

// Submit Voting Application (new method with votingNo)
const submitVoting = async (req, res) => {
    try {
        const { votingNo, state } = req.body;

        if (!votingNo || !state) {
            return res.status(400).json({ error: 'Voting number and state required' });
        }

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
};

// Get Application Status by ID
const getVotingStatus = async (req, res) => {
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
};

// Simple status check by voting number
const checkStatusByVotingNo = async (req, res) => {
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
};

// Get application by ID (for status check)
const getVotingApplicationById = async (req, res) => {
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
};

// Download PDF
const downloadPdf = async (req, res) => {
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

        if (appData.user_session_id && appData.user_session_id !== sessionId) {
            return res.status(403).json({ error: 'Access denied. Invalid session.' });
        }

        if (!appData.pdf_path || appData.status !== 'completed') {
            return res.status(404).json({ error: 'PDF not available' });
        }

        const filePath = path.join(__dirname, '..', appData.pdf_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'PDF file not found on server' });
        }

        res.download(filePath, appData.pdf_original_name || `voting_${id}.pdf`);

    } catch (error) {
        console.error('Error downloading PDF:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// PDF download with payment check
const downloadPdfWithPayment = async (req, res) => {
    const { applicationId } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    try {
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

        if (application.payment_status !== 'completed') {
            return res.status(403).json({
                success: false,
                error: 'Payment required to download PDF',
                paymentRequired: true
            });
        }

        if (application.download_count >= 1) {
            return res.status(403).json({
                success: false,
                error: 'Download limit exceeded. PDF can only be downloaded once.',
                downloadCount: application.download_count
            });
        }

        if (!application.pdf_path) {
            return res.status(404).json({
                success: false,
                error: 'PDF not found'
            });
        }

        const pdfPath = path.join(__dirname, '..', application.pdf_path);
        if (fs.existsSync(pdfPath)) {
            await pool.query(
                `UPDATE voting_applications 
                 SET download_count = download_count + 1,
                     last_downloaded_at = NOW()
                 WHERE application_id = ?`,
                [applicationId]
            );

            await pool.query(
                `INSERT INTO pdf_downloads (application_id, ip_address, user_agent)
                 VALUES (?, ?, ?)`,
                [applicationId, ipAddress, userAgent]
            );

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
};

// Get download status
const getDownloadStatus = async (req, res) => {
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
};

// Get user's voting history
const getVotingHistory = async (req, res) => {
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
};

// Get voting statistics
const getVotingStats = async (req, res) => {
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
};

// At the bottom of votingController.js, update module.exports to include transformVotingApp
module.exports = {
    applyVoting,
    submitVoting,
    getVotingStatus,
    checkStatusByVotingNo,
    getVotingApplicationById,
    downloadPdf,
    downloadPdfWithPayment,
    getDownloadStatus,
    getVotingHistory,
    getVotingStats,
    transformVotingApp  // Add this line
};