require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const db = require('./db/postgres');
const { connectMongo } = require('./db/mongo');
const { authenticate } = require('./middleware/auth');

// Route modules
const authRoutes = require('./routes/auth');
const routesRoutes = require('./routes/routes');
const faresRoutes = require('./routes/fares');
const watchlistsRoutes = require('./routes/watchlists');
const alertsRoutes = require('./routes/alerts');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(authenticate);

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/fares', faresRoutes);
app.use('/api/watchlists', watchlistsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let pgStatus = 'down';
  let mongoStatus = 'down';

  try {
    const pgRes = await db.query('SELECT 1 AS ok');
    if (pgRes.rows[0].ok === 1) pgStatus = 'connected';
  } catch (err) {
    pgStatus = `error: ${err.message}`;
  }

  try {
    const { getMongoDb } = require('./db/mongo');
    const mongoDb = getMongoDb();
    if (mongoDb) {
      await mongoDb.command({ ping: 1 });
      mongoStatus = 'connected';
    }
  } catch (err) {
    mongoStatus = `error: ${err.message}`;
  }

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      postgres: pgStatus,
      mongodb: mongoStatus,
    },
  });
});

// Fallback for Single Page App
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'not_found', message: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'internal_server_error',
    message: 'An unexpected internal server error occurred.',
  });
});

// Start Server
async function startServer() {
  try {
    // Verify Postgres pool connection
    await db.query('SELECT NOW()');
    console.log('✓ Connected to PostgreSQL');

    // Connect to MongoDB
    await connectMongo();

    app.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(`🚀 Airline Fare Intelligence Platform Web Server`);
      console.log(`📍 Web Interface:   http://localhost:${PORT}`);
      console.log(`📡 API Endpoints:   http://localhost:${PORT}/api`);
      console.log(`🛡️  Auth & Roles:    Admin & Customer RBAC active`);
      console.log(`======================================================\n`);
    });
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
