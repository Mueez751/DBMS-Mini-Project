// Every SQL statement the web app runs lives here, so the "important queries" for the
// report are in one place. Values are always bound as $n parameters. The only text
// spliced into SQL is the ORDER BY clause, chosen from the fixed whitelist below.
import { query } from './db';

const SORTS = {
  price_asc: 'lf.price ASC, lf.flight_date ASC',
  price_desc: 'lf.price DESC, lf.flight_date ASC',
  date_asc: 'lf.flight_date ASC, lf.price ASC',
  scraped_desc: 'lf.scraped_at DESC, lf.price ASC',
};

export async function getMeta() {
  const [routes, airlines, airports] = await Promise.all([
    query(`SELECT r.route_id, r.origin_iata, r.dest_iata, ao.city AS origin_city, ad.city AS dest_city
           FROM   routes r
           JOIN   airports ao ON ao.iata_code = r.origin_iata
           JOIN   airports ad ON ad.iata_code = r.dest_iata
           ORDER  BY r.origin_iata, r.dest_iata`),
    query(`SELECT iata_code, name FROM airlines ORDER BY name`),
    query(`SELECT iata_code, city, country FROM airports ORDER BY city`),
  ]);
  return { routes: routes.rows, airlines: airlines.rows, airports: airports.rows };
}

/** Headline numbers + the "board": cheapest upcoming economy fare per route vs that route's average. */
export async function getDashboard(userId) {
  const [kpi, board, overview] = await Promise.all([
    query(
      `SELECT (SELECT COUNT(*) FROM routes)                           AS routes,
              (SELECT COUNT(*) FROM fare_snapshots)                   AS observations,
              (SELECT COUNT(DISTINCT airline_iata) FROM fare_snapshots) AS airlines,
              (SELECT MAX(scraped_at) FROM fare_snapshots)            AS last_scrape,
              (SELECT COUNT(*) FROM watchlists WHERE user_id = $1)    AS my_watchlists,
              (SELECT COUNT(*) FROM alerts a
                 JOIN watchlists w ON w.watchlist_id = a.watchlist_id
                WHERE w.user_id = $1)                                 AS my_alerts`,
      [userId]
    ),
    query(
      `SELECT * FROM (
         SELECT DISTINCT ON (lf.route_id)
                lf.route_id, r.origin_iata, r.dest_iata, ad.city AS dest_city,
                al.name AS airline, lf.flight_date, lf.price,
                ROUND(100 * (ra.avg_price - lf.price) / ra.avg_price, 0) AS pct_below_avg
         FROM   v_latest_fares lf
         JOIN   routes   r  ON r.route_id   = lf.route_id
         JOIN   airports ad ON ad.iata_code = r.dest_iata
         JOIN   airlines al ON al.iata_code = lf.airline_iata
         JOIN  (SELECT route_id, AVG(price) AS avg_price
                FROM   fare_snapshots WHERE cabin_class = 'economy' GROUP BY route_id) ra
                ON ra.route_id = lf.route_id
         WHERE  lf.cabin_class = 'economy' AND lf.flight_date >= CURRENT_DATE
         ORDER  BY lf.route_id, lf.price ASC
       ) best
       ORDER BY pct_below_avg DESC, price ASC`
    ),
    query(`SELECT route_id, route, origin_city, dest_city, observations, avg_price, min_price, max_price
           FROM v_route_overview ORDER BY avg_price DESC`),
  ]);
  return { kpi: kpi.rows[0], board: board.rows, overview: overview.rows };
}

export async function getHeatmap(cabin) {
  const { rows } = await query(
    `SELECT route, month, avg_price, min_price, max_price, observations
     FROM   mv_monthly_route_heatmap
     WHERE  cabin_class = $1
     ORDER  BY route, month`,
    [cabin]
  );
  return rows;
}

export async function searchFares(p) {
  const limit = p.page_size;
  const offset = (p.page - 1) * p.page_size;
  const { rows } = await query(
    `SELECT lf.snapshot_id, r.origin_iata || ' > ' || r.dest_iata AS route,
            lf.airline_iata, al.name AS airline, lf.cabin_class, lf.flight_date, lf.price, lf.scraped_at,
            COUNT(*) OVER () AS total
     FROM   v_latest_fares lf
     JOIN   routes   r  ON r.route_id   = lf.route_id
     JOIN   airlines al ON al.iata_code = lf.airline_iata
     WHERE  lf.route_id = $1
       AND  ($2::text    IS NULL OR lf.cabin_class  = $2)
       AND  ($3::text    IS NULL OR lf.airline_iata = $3)
       AND  ($4::numeric IS NULL OR lf.price <= $4)
       AND  lf.flight_date >= COALESCE($5::date, CURRENT_DATE)
       AND  ($6::date    IS NULL OR lf.flight_date <= $6)
     ORDER  BY ${SORTS[p.sort]}
     LIMIT  $7 OFFSET $8`,
    [p.route_id, p.cabin ?? null, p.airline ?? null, p.max_price ?? null, p.from ?? null, p.to ?? null, limit, offset]
  );
  return { rows, total: rows[0]?.total ?? 0, page: p.page, page_size: p.page_size };
}

export async function cheapestDates(p) {
  const { rows } = await query('SELECT * FROM get_cheapest_dates($1, $2, $3, $4)', [p.route_id, p.cabin, p.days, p.limit]);
  return rows;
}

export async function priceTrend(p) {
  const { rows } = await query('SELECT * FROM get_price_trend($1, $2, $3)', [p.route_id, p.cabin, p.days]);
  return rows;
}

/** Full-text search over airports (GIN index idx_airports_fts), then the routes touching any match. */
export async function findRoutesByText(text) {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5);
  if (!tokens.length) return [];
  const tsquery = tokens.map((t) => `${t}:*`).join(' & '); // tokens are [a-z0-9] only, safe for to_tsquery
  const { rows } = await query(
    `WITH hits AS (
       SELECT iata_code FROM airports
       WHERE  to_tsvector('simple', iata_code || ' ' || city || ' ' || country) @@ to_tsquery('simple', $1)
     )
     SELECT r.route_id, r.origin_iata, r.dest_iata, ao.city AS origin_city, ad.city AS dest_city
     FROM   routes r
     JOIN   airports ao ON ao.iata_code = r.origin_iata
     JOIN   airports ad ON ad.iata_code = r.dest_iata
     WHERE  r.origin_iata IN (SELECT iata_code FROM hits) OR r.dest_iata IN (SELECT iata_code FROM hits)
     ORDER  BY r.origin_iata, r.dest_iata
     LIMIT  20`,
    [tsquery]
  );
  return rows;
}

// ---- watchlists: every statement is scoped to the signed-in user (ownership check) ----

export async function listWatchlists(userId) {
  const { rows } = await query(
    `SELECT w.watchlist_id, w.route_id, r.origin_iata, r.dest_iata, w.cabin_class, w.target_price,
            (SELECT MIN(lf.price) FROM v_latest_fares lf
              WHERE lf.route_id = w.route_id AND lf.cabin_class = w.cabin_class
                AND lf.flight_date >= CURRENT_DATE)                      AS current_best,
            (SELECT COUNT(*) FROM alerts a WHERE a.watchlist_id = w.watchlist_id) AS alert_count
     FROM   watchlists w
     JOIN   routes r ON r.route_id = w.route_id
     WHERE  w.user_id = $1
     ORDER  BY r.origin_iata, r.dest_iata, w.cabin_class`,
    [userId]
  );
  return rows;
}

export async function createWatchlist(userId, { route_id, cabin_class, target_price }) {
  const { rows } = await query(
    `INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
     VALUES ($1, $2, $3, $4)
     RETURNING watchlist_id, route_id, cabin_class, target_price`,
    [userId, route_id, target_price, cabin_class]
  );
  return rows[0];
}

export async function updateWatchlist(userId, watchlistId, target_price) {
  const { rows } = await query(
    `UPDATE watchlists SET target_price = $1
     WHERE  watchlist_id = $2 AND user_id = $3
     RETURNING watchlist_id, target_price`,
    [target_price, watchlistId, userId]
  );
  return rows[0] || null;
}

export async function deleteWatchlist(userId, watchlistId) {
  const { rowCount } = await query('DELETE FROM watchlists WHERE watchlist_id = $1 AND user_id = $2', [watchlistId, userId]);
  return rowCount > 0;
}

export async function listAlerts(userId) {
  const { rows } = await query(
    `SELECT a.alert_id, r.origin_iata || ' > ' || r.dest_iata AS route, al.name AS airline,
            fs.cabin_class, fs.flight_date, fs.price AS fare, w.target_price, a.triggered_at
     FROM   alerts a
     JOIN   watchlists     w  ON w.watchlist_id = a.watchlist_id
     JOIN   fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
     JOIN   routes         r  ON r.route_id     = fs.route_id
     JOIN   airlines       al ON al.iata_code   = fs.airline_iata
     WHERE  w.user_id = $1
     ORDER  BY a.triggered_at DESC, fs.price ASC
     LIMIT  100`,
    [userId]
  );
  return rows;
}

// ---- admin ----

export async function adminStats() {
  const { rows } = await query(
    `SELECT (SELECT COUNT(*) FROM v_users_public WHERE role = 'admin')    AS admins,
            (SELECT COUNT(*) FROM v_users_public WHERE role = 'customer') AS customers,
            (SELECT COUNT(*) FROM fare_snapshots)                         AS snapshots,
            (SELECT COUNT(*) FROM raw_scrape_refs)                        AS raw_refs,
            (SELECT COUNT(*) FROM alerts)                                 AS alerts,
            (SELECT MAX(scraped_at) FROM fare_snapshots)                  AS last_scrape`
  );
  return rows[0];
}

export async function listUsers() {
  const { rows } = await query('SELECT user_id, email, role, created_at FROM v_users_public ORDER BY user_id');
  return rows;
}

export async function createRoute({ origin_iata, dest_iata }) {
  const { rows } = await query(
    'INSERT INTO routes (origin_iata, dest_iata) VALUES ($1, $2) RETURNING route_id, origin_iata, dest_iata',
    [origin_iata, dest_iata]
  );
  return rows[0];
}

export async function refreshHeatmap() {
  await query('CALL sp_refresh_heatmap()');
}

export async function mongoRefForSnapshot(snapshotId) {
  const { rows } = await query(
    `SELECT rs.mongo_doc_id, fs.price, fs.airline_iata, fs.cabin_class, fs.flight_date
     FROM   raw_scrape_refs rs JOIN fare_snapshots fs ON fs.snapshot_id = rs.snapshot_id
     WHERE  rs.snapshot_id = $1`,
    [snapshotId]
  );
  return rows[0] || null;
}
