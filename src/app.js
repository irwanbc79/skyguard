require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const deviceRoutes = require('./routes/devices');
const kursRoutes = require('./routes/kurs');
const passengerRoutes = require('./routes/passenger');

app.use('/api/devices', deviceRoutes);
app.use('/api/passengers', require('./routes/passengers'));
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
