require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/devices', require('./routes/devices'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Serve index.html for root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT, '0.0.0.0', () => console.log(`Server running on port ${process.env.PORT}`));
  })
  .catch(err => console.error('MongoDB error:', err));
