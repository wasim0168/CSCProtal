const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ TiDB Connected successfully');
        console.log('📊 Database:', process.env.DB_NAME);
        connection.release();
    } catch (error) {
        console.error('❌ TiDB Connection error:', error.message);
    }
}

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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Payment orders table ready');
    } catch (err) {
        console.error('Error creating payment table:', err);
    }
}

testConnection();
createPaymentTable();

module.exports = pool;