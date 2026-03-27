// middleware/authMiddleware.js
const pool = require('../config/db');

const authenticate = async (req, res, next) => {
    try {
        const sessionToken = req.headers['authorization']?.replace('Bearer ', '');

        if (!sessionToken) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        const [sessions] = await pool.query(
            `SELECT user_id FROM user_sessions 
             WHERE session_token = ? AND expires_at > NOW()`,
            [sessionToken]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid or expired session' 
            });
        }

        req.userId = sessions[0].user_id;
        next();

    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

const isAdmin = async (req, res, next) => {
    try {
        const [users] = await pool.query(
            'SELECT role FROM users WHERE id = ?',
            [req.userId]
        );

        if (users.length === 0 || users[0].role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Admin access required' 
            });
        }

        next();

    } catch (error) {
        console.error('Admin check error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

module.exports = { authenticate, isAdmin };