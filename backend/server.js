const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const authRoutes = require('./routes/auth');
const jamRoutes = require('./routes/jams');
const reviewRoutes = require('./routes/reviews');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = Number(process.env.PORT) || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jampals';
const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const nativeAppOrigins = ['https://localhost', 'capacitor://localhost', 'http://localhost'];

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    // Same-origin website requests need no CORS headers. Cross-origin access
    // is granted only to origins explicitly listed in ALLOWED_ORIGINS.
    const isAllowed = !origin || process.env.NODE_ENV !== 'production'
      || allowedOrigins.includes(origin)
      || nativeAppOrigins.includes(origin);
    return callback(null, isAllowed);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

// Serve only the active website assets. The frontend folder also contains the
// Android project and build files, which should not be exposed as web assets.
const websiteFiles = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css'
};
for (const [route, fileName] of Object.entries(websiteFiles)) {
  app.get(route, (req, res, next) => {
    res.sendFile(path.join(FRONTEND_DIR, fileName), (error) => {
      if (error) next(error);
    });
  });
}

app.get('/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'starting',
    app: 'Jampals API',
    database: connected ? 'connected' : 'disconnected'
  });
});

app.get('/api', (req, res) => {
  res.json({
    name: 'Jampals API',
    version: 1,
    endpoints: ['/api/auth', '/api/jams', '/api/reviews', '/api/chat'],
    health: '/health'
  });
});

// Keep the API reachable while MongoDB is unavailable so health checks and
// database status remain observable. Data routes fail fast until it reconnects.
app.use('/api', (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  return res.status(503).json({ error: 'The database is temporarily unavailable. Please try again shortly.' });
});

app.use('/api/auth', authRoutes);
app.use('/api/jams', jamRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chat', chatRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Unexpected server error.' : err.message });
});

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('Set JWT_SECRET in the hosting service environment.');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Jampals API listening on port ${PORT}`);
  });

  const connectToDatabase = () => mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 5000
  }).then(() => {
    console.log('MongoDB connected.');
  }).catch((error) => {
    console.error(`MongoDB connection unavailable: ${error.message}`);
  });

  await connectToDatabase();
  const reconnectTimer = setInterval(() => {
    if (mongoose.connection.readyState === 0) connectToDatabase();
  }, 15000);

  const shutdown = async () => {
    clearInterval(reconnectTimer);
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Could not start Jampals API: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { app, start };
