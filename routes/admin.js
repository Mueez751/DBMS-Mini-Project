const express = require('express');
const router = express.Router();
const db = require('../db/postgres');
const { getMongoDb } = require('../db/mongo');
const { requireAdmin } = require('../middleware/auth');
const { validateSnapshot } = require('../middleware/validation');

// All admin routes strictly enforce Admin role authorization
router.use(requireAdmin);

// GET /api/admin/stats - System telemetry across PostgreSQL & MongoDB
router.get('/stats', async (req, res) => {
  try {
    const pgStatsQuery = `
      SELECT 'airports' AS entity, COUNT(*) AS count FROM airports
      UNION ALL
      SELECT 'airlines', COUNT(*) FROM airlines
      UNION ALL
      SELECT 'routes', COUNT(*) FROM routes
      UNION ALL
      SELECT 'users', COUNT(*) FROM users
      UNION ALL
      SELECT 'watchlists', COUNT(*) FROM watchlists
      UNION ALL
      SELECT 'fare_snapshots', COUNT(*) FROM fare_snapshots
      UNION ALL
      SELECT 'alerts', COUNT(*) FROM alerts
    `;
    const pgRes = await db.query(pgStatsQuery);

    const stats = {};
    pgRes.rows.forEach(r => {
      stats[r.entity] = parseInt(r.count, 10);
    });

    let mongoStats = { raw_payloads: 0, status: 'disconnected' };
    const mongoDb = getMongoDb();
    if (mongoDb) {
      try {
        const count = await mongoDb.collection('raw_fare_payloads').countDocuments();
        mongoStats = { raw_payloads: count, status: 'connected' };
      } catch (mErr) {
        mongoStats.error = mErr.message;
      }
    }

    res.json({
      postgres: stats,
      mongo: mongoStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch system stats.' });
  }
});

// POST /api/admin/ingest-snapshot - Calls stored procedure sp_record_fare_snapshot()
router.post('/ingest-snapshot', validateSnapshot, async (req, res) => {
  const {
    route_id,
    airline_iata,
    cabin_class,
    price,
    flight_date,
    mongo_doc_id = '000000000000000000000064',
  } = req.body;

  try {
    // In PostgreSQL: CALL sp_record_fare_snapshot(route_id, airline, cabin, price, flight_date, mongo_id, out)
    const result = await db.query(
      `CALL sp_record_fare_snapshot($1, $2, $3, $4, $5::date, $6, NULL)`,
      [
        parseInt(route_id, 10),
        airline_iata.toUpperCase(),
        cabin_class,
        parseFloat(price),
        flight_date,
        mongo_doc_id,
      ]
    );

    const snapshotId = result.rows && result.rows[0] ? result.rows[0].o_snapshot_id : null;

    // Check if alerts were fired by the trigger for this insertion
    const alertsFired = await db.query(
      `SELECT a.alert_id, u.email, w.target_price, fs.price AS alerting_fare
       FROM alerts a
       JOIN watchlists w ON w.watchlist_id = a.watchlist_id
       JOIN users u ON u.user_id = w.user_id
       JOIN fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
       WHERE fs.snapshot_id = $1`,
      [snapshotId]
    );

    res.status(201).json({
      message: 'Fare snapshot recorded atomically via stored procedure.',
      snapshot_id: snapshotId,
      trigger_alerts_fired: alertsFired.rows,
    });
  } catch (err) {
    if (err.constraint === 'chk_fare_price') {
      return res.status(400).json({
        error: 'invalid_price',
        message: 'Fare price must be strictly positive.',
      });
    }
    if (err.constraint === 'chk_mongo_oid') {
      return res.status(400).json({
        error: 'invalid_mongo_oid',
        message: 'mongo_doc_id must be a valid 24-character hexadecimal ObjectId.',
      });
    }
    console.error('Ingest snapshot error:', err);
    res.status(500).json({ error: 'server_error', message: err.message || 'Failed to ingest fare snapshot.' });
  }
});

// POST /api/admin/refresh-heatmap - Calls stored procedure sp_refresh_heatmap()
router.post('/refresh-heatmap', async (req, res) => {
  try {
    await db.query(`CALL sp_refresh_heatmap()`);
    const countRes = await db.query(`SELECT COUNT(*) AS total FROM mv_monthly_route_heatmap`);
    res.json({
      message: 'Materialized view mv_monthly_route_heatmap refreshed successfully.',
      total_heatmap_rows: parseInt(countRes.rows[0].total, 10),
    });
  } catch (err) {
    console.error('Heatmap refresh error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to refresh heatmap.' });
  }
});

// GET /api/admin/mongo/payloads - Browse MongoDB raw payloads (#7 NoSQL)
router.get('/mongo/payloads', async (req, res) => {
  const mongoDb = getMongoDb();
  if (!mongoDb) {
    return res.status(503).json({ error: 'mongo_unavailable', message: 'MongoDB is currently not connected.' });
  }

  const { route_id, limit = 10, skip = 0 } = req.query;
  const filter = {};
  if (route_id) filter.route_id = parseInt(route_id, 10);

  try {
    const col = mongoDb.collection('raw_fare_payloads');
    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ scraped_at: -1 })
      .skip(parseInt(skip, 10) || 0)
      .limit(Math.min(parseInt(limit, 10) || 10, 50))
      .toArray();

    res.json({ total, payloads: docs });
  } catch (err) {
    console.error('Fetch mongo payloads error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch raw payloads.' });
  }
});

// GET /api/admin/mongo/aggregations - Run MongoDB aggregations (#7 NoSQL aggregation)
router.get('/mongo/aggregations', async (req, res) => {
  const mongoDb = getMongoDb();
  if (!mongoDb) {
    return res.status(503).json({ error: 'mongo_unavailable', message: 'MongoDB is currently not connected.' });
  }

  try {
    const col = mongoDb.collection('raw_fare_payloads');

    // 1. Average price by carrier per route
    const carrierAvg = await col.aggregate([
      { $unwind: '$data' },
      { $unwind: '$data.itineraries' },
      { $unwind: '$data.itineraries.segments' },
      {
        $group: {
          _id: {
            route: { $concat: ['$origin', '-', '$destination'] },
            carrier: '$data.itineraries.segments.carrierCode',
          },
          offers: { $sum: 1 },
          avgTotal: { $avg: { $toDouble: '$data.price.total' } },
        },
      },
      {
        $project: {
          _id: 0,
          route: '$_id.route',
          carrier: '$_id.carrier',
          offers: 1,
          avgTotal: { $round: ['$avgTotal', 2] },
        },
      },
      { $sort: { route: 1, avgTotal: 1 } },
      { $limit: 15 },
    ]).toArray();

    // 2. Nonstop vs connecting offers
    const stopsDistribution = await col.aggregate([
      { $unwind: '$data' },
      { $unwind: '$data.itineraries' },
      {
        $group: {
          _id: { $size: '$data.itineraries.segments' },
          offers: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          stops: { $subtract: ['$_id', 1] },
          offers: 1,
        },
      },
      { $sort: { stops: 1 } },
    ]).toArray();

    // 3. Low seat availability per route
    const lowSeats = await col.aggregate([
      { $unwind: '$data' },
      { $match: { 'data.numberOfBookableSeats': { $lte: 3 } } },
      {
        $group: {
          _id: { $concat: ['$origin', '-', '$destination'] },
          lowSeatOffers: { $sum: 1 },
        },
      },
      { $sort: { lowSeatOffers: -1 } },
    ]).toArray();

    res.json({
      carrierAvg,
      stopsDistribution,
      lowSeats,
    });
  } catch (err) {
    console.error('Mongo aggregations error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to run NoSQL aggregations.' });
  }
});

module.exports = router;

