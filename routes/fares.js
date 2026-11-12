const express = require('express');
const router = express.Router();
const db = require('../db/postgres');

// GET /api/fares/search - Filtered fare snapshot search
router.get('/search', async (req, res) => {
  const {
    route_id,
    origin,
    dest,
    cabin_class = 'economy',
    start_date,
    end_date,
    airline,
    limit = 50,
  } = req.query;

  try {
    const conditions = [];
    const params = [];

    if (route_id) {
      params.push(parseInt(route_id, 10));
      conditions.push(`fs.route_id = $${params.length}`);
    }

    if (origin) {
      params.push(origin.toUpperCase());
      conditions.push(`r.origin_iata = $${params.length}`);
    }

    if (dest) {
      params.push(dest.toUpperCase());
      conditions.push(`r.dest_iata = $${params.length}`);
    }

    if (cabin_class) {
      params.push(cabin_class);
      conditions.push(`fs.cabin_class = $${params.length}`);
    }

    if (airline) {
      params.push(airline.toUpperCase());
      conditions.push(`fs.airline_iata = $${params.length}`);
    }

    if (start_date) {
      params.push(start_date);
      conditions.push(`fs.flight_date >= $${params.length}::date`);
    }

    if (end_date) {
      params.push(end_date);
      conditions.push(`fs.flight_date <= $${params.length}::date`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    const limitParam = `$${params.length}`;

    const query = `
      SELECT fs.snapshot_id,
             fs.route_id,
             r.origin_iata,
             r.dest_iata,
             orig.city AS origin_city,
             dest.city AS dest_city,
             fs.airline_iata,
             a.name AS airline_name,
             fs.cabin_class,
             fs.flight_date,
             fs.price,
             fs.scraped_at
      FROM fare_snapshots fs
      JOIN routes r ON r.route_id = fs.route_id
      JOIN airports orig ON orig.iata_code = r.origin_iata
      JOIN airports dest ON dest.iata_code = r.dest_iata
      JOIN airlines a ON a.iata_code = fs.airline_iata
      ${whereClause}
      ORDER BY fs.flight_date ASC, fs.price ASC
      LIMIT ${limitParam}
    `;

    const result = await db.query(query, params);
    res.json({ fares: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Fare search error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to search fares.' });
  }
});

// GET /api/fares/latest - From view v_latest_fares
router.get('/latest', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT route, origin_iata, dest_iata, airline, flight_date, cabin_class, price, scraped_at
      FROM v_latest_fares
      LIMIT 20
    `);
    res.json({ latestFares: result.rows });
  } catch (err) {
    console.error('Fetch latest fares error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch latest fares.' });
  }
});

// GET /api/fares/cheapest-dates - Calls PostgreSQL function get_cheapest_dates()
router.get('/cheapest-dates', async (req, res) => {
  const { route_id = 1, cabin = 'economy', days = 30, limit = 10 } = req.query;

  try {
    const result = await db.query(
      `SELECT flight_date, cheapest_airline, min_price, avg_price
       FROM get_cheapest_dates($1, $2, $3, $4)`,
      [
        parseInt(route_id, 10),
        cabin,
        parseInt(days, 10) || 30,
        parseInt(limit, 10) || 10,
      ]
    );

    res.json({
      route_id: parseInt(route_id, 10),
      cabin,
      cheapestDates: result.rows,
    });
  } catch (err) {
    console.error('Cheapest dates error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to retrieve cheapest dates.' });
  }
});

// GET /api/fares/price-trend - Calls PostgreSQL function get_price_trend() (Window functions)
router.get('/price-trend', async (req, res) => {
  const { route_id = 1, cabin = 'economy', days = 30 } = req.query;

  try {
    const result = await db.query(
      `SELECT obs_date, avg_price, moving_avg_7d, pct_change
       FROM get_price_trend($1, $2, $3)`,
      [
        parseInt(route_id, 10),
        cabin,
        parseInt(days, 10) || 30,
      ]
    );

    res.json({
      route_id: parseInt(route_id, 10),
      cabin,
      trend: result.rows,
    });
  } catch (err) {
    console.error('Price trend error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to retrieve price trends.' });
  }
});

// GET /api/fares/heatmap - Queries Materialized View mv_monthly_route_heatmap (#7 Materialized View)
router.get('/heatmap', async (req, res) => {
  const { route_id } = req.query;

  try {
    let result;
    if (route_id) {
      result = await db.query(
        `SELECT route_id, route, month, cabin_class, observations, avg_price, min_price, max_price
         FROM mv_monthly_route_heatmap
         WHERE route_id = $1
         ORDER BY month ASC, cabin_class ASC`,
        [parseInt(route_id, 10)]
      );
    } else {
      result = await db.query(
        `SELECT route_id, route, month, cabin_class, observations, avg_price, min_price, max_price
         FROM mv_monthly_route_heatmap
         ORDER BY route ASC, month ASC, cabin_class ASC`
      );
    }

    res.json({ heatmap: result.rows });
  } catch (err) {
    console.error('Heatmap error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch heatmap data.' });
  }
});

module.exports = router;
