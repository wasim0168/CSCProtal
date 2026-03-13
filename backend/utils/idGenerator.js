const crypto = require('crypto');
const pool = require('../config/db');

function generateApplicationId() {
    return 'VOT' + Date.now();
}

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

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

module.exports = {
    generateApplicationId,
    generateSessionId,
    getNextApplicationId,
    getNextVotingApplicationId
};