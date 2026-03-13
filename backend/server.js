const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const panRoutes = require('./routes/panRoutes');
const llRoutes = require('./routes/llRoutes');
const votingRoutes = require('./routes/votingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Import middleware
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();
const PORT = process.env.PORT || 5001;

// =================== MIDDLEWARE ===================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// =================== ROUTES ===================
app.use('/api', panRoutes);
app.use('/api', llRoutes);        // This mounts LL routes under /api
app.use('/api/voting', votingRoutes);
app.use('/api', paymentRoutes);
app.use('/api/admin', adminRoutes);


// =================== HEALTH CHECK ===================
app.get('/', (req, res) => {
    res.send('CSC Portal Backend Running 🚀');
});

app.get('/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is working!',
        time: new Date().toISOString()
    });
});

// =================== ERROR HANDLING ===================
app.use(notFound);
app.use(errorHandler);

// =================== START SERVER ===================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Upload directory: ${path.join(__dirname, 'uploads/voting/pdfs')}`);
});