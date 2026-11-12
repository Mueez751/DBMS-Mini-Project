const express = require('express');
const router = express.Router();
const db = require('../db/postgres');
const { requireAuth } = require('../middleware/auth');
const { validateWatchlist, validatePriceUpdate } = require('../middleware/validation');

// All watchlist routes require authentication
router.use(requireAuth);

// GET /api/watchlists - Fetch current user's watchlists
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT w.watchlist_id,
             w.user_id,
             w.route_id,
             r.origin_iata,
             r.dest_iata,
             orig.city AS origin_city,
             dest.city AS dest_city,
             w.target_price,
             w.cabin_class,
             w.created_at,
             COUNT(a.alert_id) AS alert_count,
             MIN(fs.price)     AS best_alerting_fare
      FROM watchlists w
      JOIN routes r ON r.route_id = w.route_id
      JOIN airports orig ON orig.iata_code = r.origin_iata
      JOIN airports dest ON dest.iata_code = r.dest_iata
      LEFT JOIN alerts a ON a.watchlist_id = w.watchlist_id
      LEFT JOIN fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
      WHERE w.user_id = $1
      GROUP BY w.watchlist_id, w.user_id, w.route_id, r.origin_iata, r.dest_iata, orig.city, dest.city, w.target_price, w.cabin_class, w.created_at
      ORDER BY w.created_at DESC
    `;

    const result = await db.query(query, [req.user.userId]);
    res.json({ watchlists: result.rows });
  } catch (err) {
    console.error('Fetch watchlists error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch watchlists.' });
  }
});

// POST /api/watchlists - Create new watchlist
router.post('/', validateWatchlist, async (req, res) => {
  const { route_id, target_price, cabin_class } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
       VALUES ($1, $2, $3, $4)
       RETURNING watchlist_id, user_id, route_id, target_price, cabin_class, created_at`,
      [req.user.userId, parseInt(route_id, 10), parseFloat(target_price), cabin_class]
    );

    res.status(201).json({
      message: 'Watchlist created successfully. Price drop triggers are now active for this route.',
      watchlist: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_watchlist',
        message: 'You already have a watchlist for this route and cabin class.',
      });
    }
    if (err.constraint === 'chk_watch_price') {
      return res.status(400).json({
        error: 'invalid_price',
        message: 'Target price must be strictly greater than zero.',
      });
    }
    console.error('Create watchlist error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to create watchlist.' });
  }
});

// PUT /api/watchlists/:id - Update target price
router.put('/:id', validatePriceUpdate, async (req, res) => {
  const watchlistId = parseInt(req.params.id, 10);
  const { target_price } = req.body;

  try {
    const result = await db.query(
      `UPDATE watchlists
       SET target_price = $1
       WHERE watchlist_id = $2 AND user_id = $3
       RETURNING watchlist_id, user_id, route_id, target_price, cabin_class`,
      [parseFloat(target_price), watchlistId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Watchlist not found or unauthorized to update.',
      });
    }

    res.json({
      message: 'Target price updated successfully.',
      watchlist: result.rows[0],
    });
  } catch (err) {
    if (err.constraint === 'chk_watch_price') {
      return res.status(400).json({
        error: 'invalid_price',
        message: 'Target price must be strictly greater than zero.',
      });
    }
    console.error('Update watchlist error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to update target price.' });
  }
});

// DELETE /api/watchlists/:id - Delete watchlist (cascades to alerts)
router.delete('/:id', async (req, res) => {
  const watchlistId = parseInt(req.params.id, 10);

  try {
    const result = await db.query(
      `DELETE FROM watchlists
       WHERE watchlist_id = $1 AND user_id = $2
       RETURNING watchlist_id`,
      [watchlistId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Watchlist not found or unauthorized to delete.',
      });
    }

    res.json({ message: 'Watchlist and associated alerts deleted successfully.' });
  } catch (err) {
    console.error('Delete watchlist error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to delete watchlist.' });
  }
});

module.exports = router;

