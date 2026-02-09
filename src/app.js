require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));

// CORS - batasi origin yang diizinkan
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 200, // max 200 requests per windowMs
  message: { status: 'error', message: 'Terlalu banyak request, coba lagi nanti' }
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const deviceRoutes = require('./routes/devices');
const kursRoutes = require('./routes/kurs');
const passengerRoutes = require('./routes/passenger');
const cargoRoutes = require('./routes/cargo');

app.use('/api/devices', deviceRoutes);
app.use('/api/passengers', require('./routes/passengers'));
app.use('/api/cargo', cargoRoutes);
app.use('/api/kurs', kursRoutes);
app.use('/api/passenger', passengerRoutes);

// HS Codes route
app.use('/api/hs-codes', require('./routes/hscodes'));
app.use('/api/hs', require('./routes/hscodes'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global error handler — harus di paling bawah setelah semua routes
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    const { initKurs } = require('./services/kursService');
    initKurs();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB error:', err));
