-- =====================================================================
-- Airline Fare Intelligence Platform: DML, queries, transactions, tests
-- Requirement #6 (INSERT/UPDATE/DELETE/SELECT with JOIN, GROUP BY, HAVING,
-- ORDER BY, aggregates, subqueries) + demos of the #7 advanced features.
-- Run after 03_seed.sql. Each block has a short comment you can lift
-- straight into the "Important queries" section of your report.
-- =====================================================================

\echo '=== A. INSERT ==================================================='

-- A1. A customer creates a watchlist (bob wants BLR->DXB economy at or below 200)
INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
VALUES ((SELECT user_id FROM users WHERE email = 'bob@example.com'), 1, 200.00, 'economy')
RETURNING watchlist_id, user_id, route_id, target_price, cabin_class;

-- A2. The scraper ingests a new fare through the stored procedure.
--     The price-drop TRIGGER fires and alerts every matching watchlist
--     (alice's target is 175, bob's new one is 200: both should alert at 150).
CALL sp_record_fare_snapshot(1, 'EK', 'economy', 150.00, CURRENT_DATE + 12, '000000000000000000000064', NULL);

SELECT u.email, w.target_price, fs.price AS alerting_fare, a.triggered_at
FROM   alerts a
JOIN   watchlists    w  ON w.watchlist_id = a.watchlist_id
JOIN   users         u  ON u.user_id      = w.user_id
JOIN   fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
WHERE  fs.price = 150.00 AND fs.route_id = 1 AND fs.flight_date = CURRENT_DATE + 12
ORDER  BY u.email;

\echo '=== B. UPDATE ==================================================='

-- B1. A customer raises their target price
UPDATE watchlists
SET    target_price = 210.00
WHERE  user_id = (SELECT user_id FROM users WHERE email = 'bob@example.com')
  AND  route_id = 1 AND cabin_class = 'economy'
RETURNING watchlist_id, target_price;

-- B2. Password change: the new password is hashed in the database (bcrypt)
UPDATE users
SET    password_hash = crypt('NewPass@12345', gen_salt('bf', 10))
WHERE  email = 'bob@example.com'
RETURNING user_id, email, left(password_hash, 7) AS hash_prefix;

-- B3. Integrity: historical fares cannot be edited (trigger trg_fare_immutable)
DO $$
BEGIN
    UPDATE fare_snapshots SET price = 1.00 WHERE snapshot_id = 1;
    RAISE NOTICE 'FAIL: fare price was modified';
EXCEPTION WHEN integrity_constraint_violation THEN
    RAISE NOTICE 'PASS: update blocked -> %', SQLERRM;
END $$;

\echo '=== C. DELETE ==================================================='

-- C1. Deleting a watchlist cascades to its alerts (ON DELETE CASCADE)
SELECT COUNT(*) AS alerts_before FROM alerts;
DELETE FROM watchlists
WHERE  user_id = (SELECT user_id FROM users WHERE email = 'bob@example.com')
  AND  route_id = 1 AND cabin_class = 'economy';
SELECT COUNT(*) AS alerts_after FROM alerts;

-- C2. Data-retention clean-up: remove observations older than 30 days
--     (also removes their raw_scrape_refs rows through the cascade)
DELETE FROM fare_snapshots WHERE scraped_at < now() - INTERVAL '30 days';

\echo '=== D. SELECT: joins, grouping, subqueries, windows ============='

-- Q1. JOIN (5 tables) + correlated subquery:
--     cheapest upcoming economy fare on each route, with city and airline names
SELECT r.origin_iata || ' -> ' || r.dest_iata AS route,
       ao.city AS from_city, ad.city AS to_city,
       al.name AS airline, fs.flight_date, fs.price
FROM   fare_snapshots fs
JOIN   routes   r  ON r.route_id     = fs.route_id
JOIN   airports ao ON ao.iata_code   = r.origin_iata
JOIN   airports ad ON ad.iata_code   = r.dest_iata
JOIN   airlines al ON al.iata_code   = fs.airline_iata
WHERE  fs.cabin_class = 'economy'
  AND  fs.flight_date >= CURRENT_DATE
  AND  fs.price = (SELECT MIN(f2.price)
                   FROM   fare_snapshots f2
                   WHERE  f2.route_id    = fs.route_id
                     AND  f2.cabin_class = 'economy'
                     AND  f2.flight_date >= CURRENT_DATE)
ORDER  BY fs.price;

-- Q2. GROUP BY + HAVING + aggregates:
--     premium routes (economy average above 300) with enough data points
SELECT r.origin_iata || ' -> ' || r.dest_iata AS route,
       COUNT(*)                 AS observations,
       ROUND(AVG(fs.price), 2)  AS avg_price,
       MIN(fs.price)            AS lowest,
       MAX(fs.price)            AS highest
FROM   fare_snapshots fs
JOIN   routes r ON r.route_id = fs.route_id
WHERE  fs.cabin_class = 'economy'
GROUP  BY r.route_id, r.origin_iata, r.dest_iata
HAVING AVG(fs.price) > 300 AND COUNT(*) >= 100
ORDER  BY avg_price DESC;

-- Q3. Airline comparison on one route (aggregates incl. standard deviation)
SELECT al.name AS airline,
       COUNT(*)                    AS observations,
       ROUND(AVG(fs.price), 2)     AS avg_price,
       MIN(fs.price)               AS lowest,
       MAX(fs.price)               AS highest,
       ROUND(STDDEV(fs.price), 2)  AS price_volatility
FROM   fare_snapshots fs
JOIN   airlines al ON al.iata_code = fs.airline_iata
JOIN   routes   r  ON r.route_id   = fs.route_id
WHERE  r.origin_iata = 'DEL' AND r.dest_iata = 'LHR' AND fs.cabin_class = 'economy'
GROUP  BY al.name
ORDER  BY avg_price;

-- Q4. Day-of-week analysis: which weekdays are dearest to fly on BLR -> DXB?
SELECT to_char(fs.flight_date, 'Dy')            AS weekday,
       EXTRACT(ISODOW FROM fs.flight_date)::int AS weekday_no,
       ROUND(AVG(fs.price), 2)                  AS avg_price
FROM   fare_snapshots fs
WHERE  fs.route_id = 1 AND fs.cabin_class = 'economy'
GROUP  BY 1, 2
ORDER  BY weekday_no;

-- Q5. Deal detection: today's fares at least 15% below the 30-day route average
WITH route_avg AS (
    SELECT route_id, cabin_class, AVG(price) AS avg_price
    FROM   fare_snapshots
    WHERE  scraped_at >= now() - INTERVAL '30 days'
    GROUP  BY route_id, cabin_class
)
SELECT r.origin_iata || ' -> ' || r.dest_iata AS route,
       fs.airline_iata, fs.cabin_class, fs.flight_date, fs.price,
       ROUND(ra.avg_price, 2) AS route_avg,
       ROUND(100 * (ra.avg_price - fs.price) / ra.avg_price, 1) AS pct_below_avg
FROM   fare_snapshots fs
JOIN   route_avg ra ON ra.route_id = fs.route_id AND ra.cabin_class = fs.cabin_class
JOIN   routes    r  ON r.route_id  = fs.route_id
WHERE  fs.scraped_at::date = CURRENT_DATE
  AND  fs.price <= 0.85 * ra.avg_price
ORDER  BY pct_below_avg DESC
LIMIT  10;

-- Q6. Subquery with IN: customers watching a route that departs from India
SELECT u.email
FROM   users u
WHERE  u.user_id IN (SELECT w.user_id
                     FROM   watchlists w
                     JOIN   routes   r ON r.route_id   = w.route_id
                     JOIN   airports a ON a.iata_code  = r.origin_iata
                     WHERE  a.country = 'India')
ORDER  BY u.email;

-- Q7. LEFT JOIN + GROUP BY: every watchlist with how many alerts it produced
--     (watchlists that never fired still appear, with 0)
SELECT u.email,
       r.origin_iata || ' -> ' || r.dest_iata AS route,
       w.cabin_class, w.target_price,
       COUNT(a.alert_id)  AS alerts,
       MIN(fs.price)      AS best_alerting_fare
FROM   watchlists w
JOIN   users  u ON u.user_id  = w.user_id
JOIN   routes r ON r.route_id = w.route_id
LEFT   JOIN alerts        a  ON a.watchlist_id  = w.watchlist_id
LEFT   JOIN fare_snapshots fs ON fs.snapshot_id = a.fare_snapshot_id
GROUP  BY u.email, r.origin_iata, r.dest_iata, w.cabin_class, w.target_price
ORDER  BY u.email, route;

-- Q8. Window function RANK: cheapest airline first, within each route (economy)
SELECT route, airline, avg_price,
       RANK() OVER (PARTITION BY route ORDER BY avg_price) AS price_rank
FROM (
    SELECT r.origin_iata || ' -> ' || r.dest_iata AS route,
           al.name AS airline,
           ROUND(AVG(fs.price), 2) AS avg_price
    FROM   fare_snapshots fs
    JOIN   routes   r  ON r.route_id = fs.route_id
    JOIN   airlines al ON al.iata_code = fs.airline_iata
    WHERE  fs.cabin_class = 'economy'
    GROUP  BY r.origin_iata, r.dest_iata, al.name
) t
ORDER  BY route, price_rank;

-- Q9. Full-text search over airports (uses the GIN index idx_airports_fts)
SELECT iata_code, city, country,
       ROUND(ts_rank(to_tsvector('simple', iata_code || ' ' || city || ' ' || country),
                     to_tsquery('simple', 'london | dubai'))::numeric, 4) AS rank
FROM   airports
WHERE  to_tsvector('simple', iata_code || ' ' || city || ' ' || country)
       @@ to_tsquery('simple', 'london | dubai')
ORDER  BY rank DESC, city;

-- Q10. Views
SELECT * FROM v_route_overview ORDER BY avg_price DESC;
SELECT * FROM v_users_public ORDER BY user_id;                 -- no password hashes exposed
SELECT * FROM v_latest_fares
WHERE  route_id = 1 AND cabin_class = 'economy' AND flight_date >= CURRENT_DATE
ORDER  BY flight_date, price LIMIT 5;

-- Q11. Materialized view: monthly economy heatmap
SELECT route, month, avg_price, min_price, max_price
FROM   mv_monthly_route_heatmap
WHERE  cabin_class = 'economy'
ORDER  BY route, month
LIMIT  12;

-- Q12. Stored functions
SELECT * FROM get_cheapest_dates(1, 'economy', 30, 5);   -- 5 cheapest days to fly BLR -> DXB
SELECT * FROM get_price_trend(1, 'economy', 14);         -- 7-day moving average + day-over-day change

-- Q13. A customer's alert inbox (what the Next.js "My alerts" page would run)
SELECT r.origin_iata || ' -> ' || r.dest_iata AS route,
       al.name AS airline, fs.cabin_class, fs.flight_date,
       fs.price AS fare, w.target_price, a.triggered_at
FROM   alerts a
JOIN   watchlists     w  ON w.watchlist_id  = a.watchlist_id
JOIN   users          u  ON u.user_id       = w.user_id
JOIN   fare_snapshots fs ON fs.snapshot_id  = a.fare_snapshot_id
JOIN   routes         r  ON r.route_id      = fs.route_id
JOIN   airlines       al ON al.iata_code    = fs.airline_iata
WHERE  u.email = 'alice@example.com'
ORDER  BY a.triggered_at DESC, fs.price
LIMIT  5;

\echo '=== E. Indexing: query plan uses idx_fare_route_date_cabin ======'
EXPLAIN (COSTS OFF)
SELECT * FROM fare_snapshots
WHERE  route_id = 1 AND flight_date = CURRENT_DATE + 10 AND cabin_class = 'economy';

\echo '=== F. TRANSACTIONS =============================================='

-- T1. COMMIT: a new customer and their first watchlist are created atomically
BEGIN;
INSERT INTO users (email, password_hash, role)
VALUES ('carol@example.com', crypt('Carol@12345', gen_salt('bf', 10)), 'customer');
INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
SELECT user_id, 3, 150.00, 'economy' FROM users WHERE email = 'carol@example.com';
COMMIT;
SELECT u.email, w.route_id, w.target_price
FROM   users u JOIN watchlists w ON w.user_id = u.user_id
WHERE  u.email = 'carol@example.com';

-- T2. Automatic ROLLBACK: the second insert violates a CHECK constraint, so the
--     user insert before it is undone as well (all-or-nothing).
DO $$
BEGIN
    INSERT INTO users (email, password_hash, role)
    VALUES ('dave@example.com', crypt('Dave@12345', gen_salt('bf', 10)), 'customer');
    INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
    SELECT user_id, 3, -5.00, 'economy' FROM users WHERE email = 'dave@example.com';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Transaction rolled back -> %', SQLERRM;
END $$;
SELECT COUNT(*) AS dave_rows_after_rollback FROM users WHERE email = 'dave@example.com';   -- expect 0

-- T3. Explicit ROLLBACK: a destructive change is tried and then undone
SELECT COUNT(*) AS alerts_before FROM alerts;
BEGIN;
DELETE FROM alerts;
SELECT COUNT(*) AS alerts_inside_transaction FROM alerts;   -- 0
ROLLBACK;
SELECT COUNT(*) AS alerts_after_rollback FROM alerts;       -- restored

\echo '=== G. CONSTRAINT TEST CASES (data validation at DB level) ======='
-- Each statement must be REJECTED by the database. Output is PASS/FAIL per case.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
          ('negative fare price',
           $q$INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date) VALUES (1,'EK','economy',-10,CURRENT_DATE+5)$q$),
          ('invalid cabin class',
           $q$INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date) VALUES (1,'EK','luxury',100,CURRENT_DATE+5)$q$),
          ('unknown airline (foreign key)',
           $q$INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date) VALUES (1,'ZZ','economy',100,CURRENT_DATE+5)$q$),
          ('route from an airport to itself',
           $q$INSERT INTO routes (origin_iata, dest_iata) VALUES ('DXB','DXB')$q$),
          ('duplicate route',
           $q$INSERT INTO routes (origin_iata, dest_iata) VALUES ('BLR','DXB')$q$),
          ('plaintext password',
           $q$INSERT INTO users (email, password_hash, role) VALUES ('eve@example.com','plaintext123','customer')$q$),
          ('malformed email',
           $q$INSERT INTO users (email, password_hash, role) VALUES ('not-an-email', crypt('x', gen_salt('bf',10)), 'customer')$q$),
          ('duplicate email',
           $q$INSERT INTO users (email, password_hash, role) VALUES ('alice@example.com', crypt('x', gen_salt('bf',10)), 'customer')$q$),
          ('invalid role',
           $q$INSERT INTO users (email, password_hash, role) VALUES ('mallory@example.com', crypt('x', gen_salt('bf',10)), 'superuser')$q$),
          ('zero target price',
           $q$INSERT INTO watchlists (user_id, route_id, target_price, cabin_class) VALUES (1,2,0,'economy')$q$),
          ('malformed MongoDB ObjectId',
           $q$INSERT INTO raw_scrape_refs (snapshot_id, mongo_doc_id) SELECT MAX(snapshot_id), 'not-an-objectid' FROM fare_snapshots$q$),
          ('delete a referenced airline',
           $q$DELETE FROM airlines WHERE iata_code = 'EK'$q$)
        ) AS v(test_name, stmt)
    LOOP
        BEGIN
            EXECUTE t.stmt;
            RAISE EXCEPTION 'ACCEPTED';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'ACCEPTED' THEN
                RAISE NOTICE 'FAIL: % was accepted by the database', t.test_name;
            ELSE
                RAISE NOTICE 'PASS: % -> rejected (%)', t.test_name, split_part(SQLERRM, E'\n', 1);
            END IF;
        END;
    END LOOP;
END $$;
