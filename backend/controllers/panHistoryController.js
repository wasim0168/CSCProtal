const pool = require('../config/db');

// Store PAN search history
const storePanHistory = async (req, res) => {
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
};

// Get user's PAN history
// panHistoryController.js - Update the getPanHistory function

// Get user's PAN history
const getPanHistory = async (req, res) => {
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

        // Update each history item with the latest application data
        for (let item of history) {
            const [applications] = await pool.query(
                'SELECT application_id, status, pan_number FROM applications WHERE aadhar = ? ORDER BY created_at DESC LIMIT 1',
                [item.aadhar_number]
            );

            if (applications.length > 0) {
                const app = applications[0];
                
                // Use the actual pan_number from applications table, not generated PAN
                if (app.pan_number && app.pan_number !== item.pan_number) {
                    await pool.query(
                        'UPDATE pan_search_history SET pan_number = ?, status = ?, is_pan_visible = ? WHERE id = ?',
                        [app.pan_number, app.status, app.status === 'completed', item.id]
                    );
                    item.pan_number = app.pan_number;
                    item.status = app.status;
                    item.is_pan_visible = app.status === 'completed';
                }
            }
        }

        // Fetch updated history
        const [updatedHistory] = await pool.query(
            'SELECT * FROM pan_search_history WHERE 1=1' + (userId ? ' AND user_id = ?' : '') + ' ORDER BY search_date DESC LIMIT 50',
            userId ? [userId] : []
        );

        const transformedHistory = updatedHistory.map(item => ({
            id: item.id,
            aadhar: item.aadhar_number.replace(/(\d{4})/g, '$1 ').trim(),
            panNumber: item.is_pan_visible ? item.pan_number : '•••••••••',
            serviceName: item.service_name || 'PAN Application',
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
};

// Admin endpoint to reveal PAN numbers
// Admin endpoint to reveal PAN numbers
const revealPan = async (req, res) => {
    try {
        const [result] = await pool.query(
            `UPDATE pan_search_history ph
            JOIN applications a ON ph.aadhar_number = a.aadhar
            SET ph.is_pan_visible = TRUE, 
                ph.pan_number = a.pan_number,  // Use actual pan_number from applications
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
};

module.exports = {
    storePanHistory,
    getPanHistory,
    revealPan
};