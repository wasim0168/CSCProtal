const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { transformVotingApp } = require('./votingController'); // Import the function

// Admin: Get all voting applications
const getAllVotingApplications = async (req, res) => {
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
};

// Admin: Get all voting applications with pagination
const getVotingApplicationsPaginated = async (req, res) => {
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
};

// Admin: Update application status
const updateApplicationStatus = async (req, res) => {
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
};

// Admin: Upload PDF for voting application
const uploadVotingPdf = async (req, res) => {
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
};

// Admin: Alternative upload endpoint
const uploadVotingPdfAlt = async (req, res) => {
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
};

// Admin: Get PDF by application ID
const getPdfById = async (req, res) => {
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

        const fullPath = path.join(__dirname, '..', pdfPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: "File not found on server" });
        }

        res.download(fullPath, originalName || "voting-card.pdf");

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

module.exports = {
    getAllVotingApplications,
    getVotingApplicationsPaginated,
    updateApplicationStatus,
    uploadVotingPdf,
    uploadVotingPdfAlt,
    getPdfById
};