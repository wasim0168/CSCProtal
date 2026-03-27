const pool = require('../config/db');
const { getNextApplicationId } = require('../utils/idGenerator');

// Submit PAN application
// controllers/panController.js - Update submitPan function
const submitPan = async (req, res) => {
    try {
        const { name, mobile, aadhar } = req.body;
        
        if (!name || !mobile || !aadhar) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Validate mobile
        if (!/^\d{10}$/.test(mobile)) {
            return res.status(400).json({ error: 'Invalid mobile number' });
        }

        // Validate Aadhar
        if (!/^\d{12}$/.test(aadhar)) {
            return res.status(400).json({ error: 'Invalid Aadhar number' });
        }

        const appId = await getNextApplicationId();

        const [result] = await pool.query(
            `INSERT INTO applications 
            (application_id, name, mobile, aadhar, password, type, status) 
            VALUES (?, ?, ?, ?, ?, 'pan', 'pending')`,
            [
                appId,
                name,
                mobile,
                aadhar,
                `PAN${appId}`,
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
};

// Get all applications
const getAllApplications = async (req, res) => {
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
};

// Get single application by ID
const getApplicationById = async (req, res) => {
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
};

// Update application
const updateApplication = async (req, res) => {
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
};

// Delete application
const deleteApplication = async (req, res) => {
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
};

// Get application statistics
const getStats = async (req, res) => {
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
};

// Generate PAN number for application
const generatePanNumber = async (req, res) => {
    try {
        const { id } = req.params;
        
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
};

// PAN placeholder
const panPlaceholder = (req, res) => {
    res.json({ message: 'PAN API placeholder working' });
};

module.exports = {
    submitPan,
    getAllApplications,
    getApplicationById,
    updateApplication,
    deleteApplication,
    getStats,
    generatePanNumber,
    panPlaceholder
};