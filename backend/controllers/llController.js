// controllers/llController.js
const pool = require('../config/db');
const { getNextApplicationId } = require('../utils/idGenerator');

// Helper function to transform LL application data
const transformLLApp = (app) => {
    // Format date properly if it exists
    let formattedDob = app.dob;
    if (app.dob) {
        // If it's a Date object or MySQL date, format it as YYYY-MM-DD
        const dateObj = new Date(app.dob);
        if (!isNaN(dateObj.getTime())) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            formattedDob = `${year}-${month}-${day}`;
        }
    }

    return {
        id: app.application_id,
        date: app.date,
        type: app.type,
        name: app.name,
        mobile: app.mobile,
        aadhar: app.aadhar,
        appNo: app.app_no,
        dob: formattedDob, // Use formatted date
        password: app.password,
        walletBal: app.wallet_bal,
        status: app.status,
        textFeed: app.text_feed,
        testScore: app.test_score,
        testStatus: app.test_status || 'pending',
        examinerRemarks: app.examiner_remarks,
        documentStatus: app.document_status
    };
};

// Submit LL application
const submitLl = async (req, res) => {
    try {
        const { appNo, aadhar, dob, password } = req.body;
        
        console.log('Received LL submission:', { appNo, aadhar, dob }); // Debug log
        
        if (!appNo || !aadhar || !dob || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Validate Aadhar
        if (aadhar.length !== 12 || !/^\d+$/.test(aadhar)) {
            return res.status(400).json({ error: 'Invalid Aadhar number' });
        }

        // Validate and format date
        let formattedDob = dob;
        try {
            // Ensure date is in YYYY-MM-DD format
            const dateObj = new Date(dob);
            if (!isNaN(dateObj.getTime())) {
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                formattedDob = `${year}-${month}-${day}`;
            }
        } catch (e) {
            console.error('Date parsing error:', e);
        }

        // Check if application already exists
        const [existing] = await pool.query(
            'SELECT * FROM applications WHERE app_no = ? AND type = "ll"',
            [appNo]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Application number already exists' });
        }

        // Generate new application ID
        const appId = await getNextApplicationId();

        // Insert into applications table with type 'll'
        const [result] = await pool.query(
            `INSERT INTO applications 
            (application_id, app_no, aadhar, dob, password, type, status, name, mobile, document_status) 
            VALUES (?, ?, ?, ?, ?, 'll', 'pending', ?, ?, 'pending')`,
            [
                appId,
                appNo,
                aadhar,
                formattedDob, // Use formatted date
                password,
                `User ${appId}`,
                '9876543210'
            ]
        );

        // Insert into ll_test_results table
        await pool.query(
            `INSERT INTO ll_test_results (application_id, test_status) VALUES (?, 'pending')`,
            [appId]
        );

        // Fetch the newly created application
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
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
};

// Get LL applications
const getLlApplications = async (req, res) => {
    try {
        const { search, status } = req.query;
        
        let query = `
            SELECT a.*, 
                   DATE_FORMAT(a.dob, '%Y-%m-%d') as dob,  // Format date to YYYY-MM-DD
                   lr.test_status, 
                   lr.test_score, 
                   lr.examiner_remarks, 
                   lr.test_date 
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
            query += ` AND (a.app_no LIKE ? OR a.name LIKE ? OR a.mobile LIKE ? OR a.application_id LIKE ? OR a.aadhar LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        query += ' ORDER BY a.created_at DESC';

        const [applications] = await pool.query(query, params);
        
        const transformedApps = applications.map(app => transformLLApp(app));

        res.json(transformedApps);
    } catch (error) {
        console.error('Error fetching LL applications:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Update test result
const updateTestResult = async (req, res) => {
    try {
        const { id } = req.params;
        const { testStatus, testScore, examinerRemarks } = req.body;

        console.log('Updating LL test result:', { id, testStatus });

        // Check if test result exists
        const [existing] = await pool.query(
            'SELECT * FROM ll_test_results WHERE application_id = ?',
            [id]
        );

        if (existing.length === 0) {
            // Create new test result
            await pool.query(
                `INSERT INTO ll_test_results (application_id, test_status, test_score, examiner_remarks, test_date) 
                 VALUES (?, ?, ?, ?, CURRENT_DATE)`,
                [id, testStatus, testScore || 0, examinerRemarks || `Status updated to ${testStatus}`]
            );
        } else {
            // Update existing test result
            await pool.query(
                `UPDATE ll_test_results 
                 SET test_status = ?, 
                     test_score = COALESCE(?, test_score),
                     examiner_remarks = COALESCE(?, examiner_remarks),
                     test_date = CURRENT_DATE 
                 WHERE application_id = ?`,
                [testStatus, testScore || null, examinerRemarks || null, id]
            );
        }

        // Update application status based on test result
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

        // Fetch updated application to return
        const [updatedApp] = await pool.query(
            `SELECT a.*, 
                    DATE_FORMAT(a.dob, '%Y-%m-%d') as dob,
                    lr.test_status, 
                    lr.test_score, 
                    lr.examiner_remarks 
             FROM applications a 
             LEFT JOIN ll_test_results lr ON a.application_id = lr.application_id 
             WHERE a.application_id = ?`,
            [id]
        );

        res.json({ 
            success: true, 
            message: `Test status updated to ${testStatus}`,
            application: updatedApp[0] ? transformLLApp(updatedApp[0]) : null
        });
    } catch (error) {
        console.error('Error updating test result:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
};

// Get LL statistics
const getLlStats = async (req, res) => {
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
};

module.exports = {
    submitLl,
    getLlApplications,
    updateTestResult,
    getLlStats
};