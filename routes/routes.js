const express = require('express');
const router = express.Router();
const db = require('../db/postgres');

// GET /api/routes - Retrieves route list from v_route_overview
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT route_id, route, origin_city AS from_city, dest_city AS to_city, observations AS total_snapshots, avg_price, min_price, max_price
       FROM v_route_overview
       ORDER BY route_id ASC`
    );
    res.json({ routes: result.rows });
  } catch (err) {
    console.error('Fetch routes error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch routes.' });
  }
});

// GET /api/routes/airports - Reference airports
router.get('/airports', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT iata_code, city, country
       FROM airports
       ORDER BY city ASC`
    );
    res.json({ airports: result.rows });
  } catch (err) {
    console.error('Fetch airports error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch airports.' });
  }
});

// GET /api/routes/airlines - Reference airlines with optional Full-Text Search (#7 Indexing)
router.get('/airlines', async (req, res) => {
  const { q } = req.query;

  try {
    let result;
    if (q && q.trim()) {
      // Full-text search using GIN index on to_tsvector('english', name)
      result = await db.query(
        `SELECT iata_code, name
         FROM airlines
         WHERE to_tsvector('english', name) @@ plainto_tsquery('english', $1)
            OR name ILIKE $2
         ORDER BY name ASC`,
        [q.trim(), `%${q.trim()}%`]
      );
    } else {
      result = await db.query(
        `SELECT iata_code, name
         FROM airlines
         ORDER BY name ASC`
      );
    }
    res.json({ airlines: result.rows });
  } catch (err) {
    console.error('Fetch airlines error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch airlines.' });
  }
});

module.exports = router;
