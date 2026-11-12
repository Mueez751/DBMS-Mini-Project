-- =====================================================================
-- Airline Fare Intelligence Platform: sample data (DML: INSERT)
-- Run after 01_schema.sql and 02_advanced.sql.
--
-- This is SYNTHETIC sample data so the project works out of the box.
-- Replace the fare_snapshots load with your real PySpark/Parquet output
-- (e.g. \copy from a CSV export) once your pipeline is connected.
--
-- Fares are generated relative to today's date, so "next 30 days" queries
-- always have data. Seeded login passwords (stored only as bcrypt hashes):
--   admin@airfare.local / Admin@12345   (role: admin)
--   alice@example.com   / Alice@12345   (role: customer)
--   bob@example.com     / Bob@12345     (role: customer)
-- Change these before any real deployment.
-- =====================================================================

-- Reference data -------------------------------------------------------
INSERT INTO airports (iata_code, city, country) VALUES
    ('BLR', 'Bengaluru',  'India'),
    ('DEL', 'Delhi',      'India'),
    ('BOM', 'Mumbai',     'India'),
    ('DXB', 'Dubai',      'United Arab Emirates'),
    ('LHR', 'London',     'United Kingdom'),
    ('JFK', 'New York',   'United States'),
    ('SIN', 'Singapore',  'Singapore');

INSERT INTO airlines (iata_code, name) VALUES
    ('EK', 'Emirates'),
    ('BA', 'British Airways'),
    ('AI', 'Air India'),
    ('SQ', 'Singapore Airlines'),
    ('6E', 'IndiGo'),
    ('VS', 'Virgin Atlantic');

-- route_id is assigned 1..7 in this order (the MongoDB seed relies on it)
INSERT INTO routes (origin_iata, dest_iata) VALUES
    ('BLR', 'DXB'),   -- 1
    ('DEL', 'LHR'),   -- 2
    ('BOM', 'DXB'),   -- 3
    ('DXB', 'LHR'),   -- 4
    ('LHR', 'JFK'),   -- 5
    ('DXB', 'JFK'),   -- 6
    ('BLR', 'SIN');   -- 7

-- Users: passwords are hashed with bcrypt inside the database ----------
INSERT INTO users (email, password_hash, role) VALUES
    ('admin@airfare.local', crypt('Admin@12345', gen_salt('bf', 10)), 'admin'),
    ('alice@example.com',   crypt('Alice@12345', gen_salt('bf', 10)), 'customer'),
    ('bob@example.com',     crypt('Bob@12345',   gen_salt('bf', 10)), 'customer');

-- Watchlists are inserted BEFORE the fares so the price-drop trigger
-- (02_advanced.sql) generates alerts while the fares load.
INSERT INTO watchlists (user_id, route_id, target_price, cabin_class)
SELECT u.user_id, r.route_id, v.target, v.cabin
FROM (VALUES
        ('alice@example.com', 'BLR', 'DXB',  175.00, 'economy'),
        ('alice@example.com', 'DEL', 'LHR', 1700.00, 'business'),
        ('bob@example.com',   'DXB', 'LHR',  450.00, 'economy'),
        ('bob@example.com',   'LHR', 'JFK',  400.00, 'economy')   -- deliberately too low: never alerts
     ) AS v(email, o, d, target, cabin)
JOIN users  u ON u.email = v.email
JOIN routes r ON r.origin_iata = v.o AND r.dest_iata = v.d;

-- Fare history: 14 scrape days x 6 lead times x 2 cabins per route/airline.
-- Price model: route base fare x cabin multiplier x airline factor
--   x lead-time uplift (closer departure = dearer) x weekend uplift x noise.
SELECT setseed(0.42);   -- reproducible "random" noise

WITH route_base(route_id, base) AS (
    SELECT r.route_id, v.base
    FROM (VALUES ('BLR','DXB',180), ('DEL','LHR',520), ('BOM','DXB',160),
                 ('DXB','LHR',480), ('LHR','JFK',560), ('DXB','JFK',780),
                 ('BLR','SIN',210)) AS v(o, d, base)
    JOIN routes r ON r.origin_iata = v.o AND r.dest_iata = v.d
),
route_air(route_id, airline) AS (
    SELECT r.route_id, v.al
    FROM (VALUES ('BLR','DXB','EK'), ('BLR','DXB','AI'), ('BLR','DXB','6E'),
                 ('DEL','LHR','BA'), ('DEL','LHR','AI'), ('DEL','LHR','VS'),
                 ('BOM','DXB','EK'), ('BOM','DXB','AI'), ('BOM','DXB','6E'),
                 ('DXB','LHR','EK'), ('DXB','LHR','BA'),
                 ('LHR','JFK','BA'), ('LHR','JFK','VS'),
                 ('DXB','JFK','EK'),
                 ('BLR','SIN','SQ'), ('BLR','SIN','AI'), ('BLR','SIN','6E')) AS v(o, d, al)
    JOIN routes r ON r.origin_iata = v.o AND r.dest_iata = v.d
),
cabins(cabin, mult) AS (VALUES ('economy', 1.0), ('business', 3.2)),
leads(lead)         AS (VALUES (3), (7), (14), (21), (30), (45)),
scrape_days(d)      AS (SELECT generate_series(0, 13))
INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date, scraped_at)
SELECT ra.route_id,
       ra.airline,
       c.cabin,
       ROUND((  b.base * c.mult
              * (0.90 + (abs(hashtext(ra.route_id::text || ra.airline)) % 26) / 100.0)
              * (1 + (45 - l.lead) / 150.0)
              * CASE WHEN EXTRACT(ISODOW FROM (CURRENT_DATE - s.d) + l.lead) IN (5, 7) THEN 1.08 ELSE 1.0 END
              * (0.95 + random() * 0.10))::numeric, 2),
       (CURRENT_DATE - s.d) + l.lead,
       (CURRENT_DATE - s.d) + TIME '06:00'
FROM route_base b
JOIN route_air ra ON ra.route_id = b.route_id
CROSS JOIN cabins c
CROSS JOIN leads l
CROSS JOIN scrape_days s;

-- Link every snapshot to its MongoDB batch document.
-- Convention shared with 05_mongo_setup.js:
--   ObjectId = hex(route_id * 100 + days_ago), left-padded with zeros to 24 chars
INSERT INTO raw_scrape_refs (snapshot_id, mongo_doc_id)
SELECT snapshot_id,
       lpad(to_hex(route_id * 100 + (CURRENT_DATE - scraped_at::date)), 24, '0')
FROM   fare_snapshots;

-- Two "flash sale" fares ingested through the stored procedure (today's batch).
-- The first one drops below Alice's BLR->DXB target and fires the trigger.
CALL sp_record_fare_snapshot(1, 'EK', 'economy', 139.00, CURRENT_DATE + 20, '000000000000000000000064', NULL);
CALL sp_record_fare_snapshot(4, 'BA', 'economy', 399.00, CURRENT_DATE + 25, '000000000000000000000190', NULL);

-- Build the dashboard heatmap and refresh planner statistics
CALL sp_refresh_heatmap();
ANALYZE;

-- Quick sanity check of what was loaded
SELECT 'airports' AS tbl, COUNT(*) FROM airports
UNION ALL SELECT 'airlines',        COUNT(*) FROM airlines
UNION ALL SELECT 'routes',          COUNT(*) FROM routes
UNION ALL SELECT 'users',           COUNT(*) FROM users
UNION ALL SELECT 'watchlists',      COUNT(*) FROM watchlists
UNION ALL SELECT 'fare_snapshots',  COUNT(*) FROM fare_snapshots
UNION ALL SELECT 'raw_scrape_refs', COUNT(*) FROM raw_scrape_refs
UNION ALL SELECT 'alerts (trigger-generated)', COUNT(*) FROM alerts;
