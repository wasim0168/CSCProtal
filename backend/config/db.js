const mysql = require('mysql2/promise');
require('dotenv').config();

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

testConnection();
createPaymentTable();

module.exports = pool;