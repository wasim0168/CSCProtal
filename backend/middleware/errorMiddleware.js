// Error handling middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err.message);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Max size is 5MB.' });
        }
        return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: err.message || 'Server error' });
};

// 404 handler
const notFound = (req, res) => {
    res.status(404).json({ error: 'Route not found' });
};

module.exports = {
    errorHandler,
    notFound
};