const express = require('express');
const router = express.Router();
const db = require('../db/postgres');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/alerts - Alerts triggered by fn_fare_check_watchlists() trigger
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT a.alert_id,
             a.watchlist_id,
             a.triggered_at,
             w.target_price,
             w.cabin_class,
             r.route_id,
             r.origin_iata,
             r.dest_iata,
             orig.city AS origin_city,
             dest.city AS dest_city,
             fs.snapshot_id,
             fs.price AS alerting_fare,
             fs.flight_date,
             fs.airline_iata,
             air.name AS airline_name,
             ROUND(w.target_price - fs.price, 2) AS savings
      FROM alerts a
      JOIN watchlists w ON w.watchlist_id = a.watchlist_id
      JOIN fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
      JOIN routes r ON r.route_id = w.route_id
      JOIN airports orig ON orig.iata_code = r.origin_iata
      JOIN airports dest ON dest.iata_code = r.dest_iata
      JOIN airlines air ON air.iata_code = fs.airline_iata
      WHERE w.user_id = $1
      ORDER BY a.triggered_at DESC
      LIMIT 100
    `;

    const result = await db.query(query, [req.user.userId]);
    res.json({ alerts: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Fetch alerts error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch alerts.' });
  }
});

// GET /api/alerts/count - Badge count
router.get('/count', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(a.alert_id) AS alert_count
       FROM alerts a
       JOIN watchlists w ON w.watchlist_id = a.watchlist_id
       WHERE w.user_id = $1`,
      [req.user.userId]
    );

    res.json({ count: parseInt(result.rows[0].alert_count, 10) || 0 });
  } catch (err) {
    console.error('Alert count error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to get alert count.' });
  }
});

module.exports = router;

