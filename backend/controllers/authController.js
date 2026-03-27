// controllers/authController.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Generate session token
const generateSessionToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Register new user
const register = async (req, res) => {
    try {
        const { username, email, password, full_name, phone, aadhar_number } = req.body;

        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, email and password are required' 
            });
        }

        // Check if user already exists
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username or email already exists' 
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user
        const [result] = await pool.query(
            `INSERT INTO users 
            (username, email, password, full_name, phone, aadhar_number, wallet_balance) 
            VALUES (?, ?, ?, ?, ?, ?, 0.00)`,
            [username, email, hashedPassword, full_name || null, phone || null, aadhar_number || null]
        );

        // Generate session token
        const sessionToken = generateSessionToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // Session expires in 7 days

        // Create session
        await pool.query(
            `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
            [result.insertId, sessionToken, req.ip, req.get('User-Agent'), expiresAt]
        );

        // Get user data (excluding password)
        const [user] = await pool.query(
            'SELECT id, username, email, full_name, phone, aadhar_number, wallet_balance, role, created_at FROM users WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            user: user[0],
            sessionToken,
            expiresAt
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during registration' 
        });
    }
};

// Login user
const login = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if ((!username && !email) || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username/email and password are required' 
            });
        }

        // Find user by username or email
        let query = 'SELECT * FROM users WHERE ';
        let params = [];

        if (username) {
            query += 'username = ?';
            params.push(username);
        } else {
            query += 'email = ?';
            params.push(email);
        }

        const [users] = await pool.query(query, params);

        if (users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }

        const user = users[0];

        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({ 
                success: false, 
                error: 'Account is deactivated. Please contact admin.' 
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }

        // Update last login
        await pool.query(
            'UPDATE users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );

        // Generate session token
        const sessionToken = generateSessionToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Create new session
        await pool.query(
            `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, sessionToken, req.ip, req.get('User-Agent'), expiresAt]
        );

        // Remove password from response
        delete user.password;

        res.json({
            success: true,
            message: 'Login successful',
            user,
            sessionToken,
            expiresAt
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during login' 
        });
    }
};

// Logout user
const logout = async (req, res) => {
    try {
        const sessionToken = req.headers['authorization']?.replace('Bearer ', '');

        if (sessionToken) {
            await pool.query(
                'DELETE FROM user_sessions WHERE session_token = ?',
                [sessionToken]
            );
        }

        res.json({ 
            success: true, 
            message: 'Logout successful' 
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during logout' 
        });
    }
};

// Verify session token
const verifySession = async (req, res) => {
    try {
        const sessionToken = req.headers['authorization']?.replace('Bearer ', '');

        if (!sessionToken) {
            return res.status(401).json({ 
                success: false, 
                error: 'No session token provided' 
            });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id, u.username, u.email, u.full_name, u.role, u.wallet_balance 
             FROM user_sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.session_token = ? AND s.expires_at > NOW()`,
            [sessionToken]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid or expired session' 
            });
        }

        const session = sessions[0];

        res.json({
            success: true,
            user: {
                id: session.id,
                username: session.username,
                email: session.email,
                full_name: session.full_name,
                role: session.role,
                wallet_balance: session.wallet_balance
            },
            sessionToken
        });

    } catch (error) {
        console.error('Session verification error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get user profile
const getProfile = async (req, res) => {
    try {
        const userId = req.userId; // Set by auth middleware

        const [users] = await pool.query(
            'SELECT id, username, email, full_name, phone, aadhar_number, wallet_balance, role, created_at, last_login FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Update user profile
const updateProfile = async (req, res) => {
    try {
        const userId = req.userId;
        const { full_name, phone, aadhar_number } = req.body;

        await pool.query(
            `UPDATE users 
             SET full_name = COALESCE(?, full_name),
                 phone = COALESCE(?, phone),
                 aadhar_number = COALESCE(?, aadhar_number)
             WHERE id = ?`,
            [full_name, phone, aadhar_number, userId]
        );

        const [users] = await pool.query(
            'SELECT id, username, email, full_name, phone, aadhar_number, wallet_balance, role FROM users WHERE id = ?',
            [userId]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: users[0]
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Change password
const changePassword = async (req, res) => {
    try {
        const userId = req.userId;
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Current password and new password are required' 
            });
        }

        // Get user with password
        const [users] = await pool.query(
            'SELECT password FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(current_password, users[0].password);

        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                error: 'Current password is incorrect' 
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        // Update password
        await pool.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        // Invalidate all sessions except current one
        const currentSessionToken = req.headers['authorization']?.replace('Bearer ', '');
        
        await pool.query(
            'DELETE FROM user_sessions WHERE user_id = ? AND session_token != ?',
            [userId, currentSessionToken]
        );

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

module.exports = {
    register,
    login,
    logout,
    verifySession,
    getProfile,
    updateProfile,
    changePassword
};