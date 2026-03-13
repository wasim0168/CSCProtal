const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const panRoutes = require('./routes/panRoutes');
const llRoutes = require('./routes/llRoutes');
const votingRoutes = require('./routes/votingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
}));

// Routes
app.use('/api/pan', panRoutes);
app.use('/api/ll', llRoutes);
app.use('/api/voting', votingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);


module.exports = app;