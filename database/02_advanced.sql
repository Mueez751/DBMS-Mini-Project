-- =====================================================================
-- Airline Fare Intelligence Platform: advanced database features
-- Requirement #7. Concepts covered here:
--   1. Materialized view   (monthly route heatmap)
--   2. Triggers            (price-drop alerts + fare immutability guard)
--   3. Stored functions    (cheapest dates, price trend with window functions)
--   4. Stored procedures   (atomic fare ingestion, heatmap refresh)
--   5. Indexing + full-text search  -> defined in 01_schema.sql
--   6. Transactions        -> demonstrated in 04_queries.sql
--   7. NoSQL aggregation   -> 05_mongo_setup.js
-- Run after 01_schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MATERIALIZED VIEW: monthly price heatmap per route and cabin
--    Pre-computed because the dashboard reads it constantly and the
--    underlying fare_snapshots table keeps growing.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_monthly_route_heatmap AS
SELECT fs.route_id,
       r.origin_iata || '-' || r.dest_iata       AS route,
       date_trunc('month', fs.flight_date)::date AS month,
       fs.cabin_class,
       COUNT(*)                                  AS observations,
       ROUND(AVG(fs.price), 2)                   AS avg_price,
       MIN(fs.price)                             AS min_price,
       MAX(fs.price)                             AS max_price
FROM   fare_snapshots fs
JOIN   routes r ON r.route_id = fs.route_id
GROUP  BY fs.route_id, r.origin_iata, r.dest_iata, date_trunc('month', fs.flight_date), fs.cabin_class
WITH DATA;

-- unique index lets you run REFRESH MATERIALIZED VIEW CONCURRENTLY manually
CREATE UNIQUE INDEX uq_mv_heatmap ON mv_monthly_route_heatmap (route_id, month, cabin_class);

-- ---------------------------------------------------------------------
-- 2a. TRIGGER: price-drop alerts
--     After every new fare, find watchlists on the same route + cabin whose
--     target price is met, and write an alert row for each.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fare_check_watchlists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO alerts (watchlist_id, fare_snapshot_id)
    SELECT w.watchlist_id, NEW.snapshot_id
    FROM   watchlists w
    WHERE  w.route_id    = NEW.route_id
      AND  w.cabin_class = NEW.cabin_class
      AND  NEW.price    <= w.target_price
    ON CONFLICT (watchlist_id, fare_snapshot_id) DO NOTHING;
    RETURN NULL;   -- AFTER trigger: return value is ignored
END;
$$;

CREATE TRIGGER trg_fare_check_watchlists
AFTER INSERT ON fare_snapshots
FOR EACH ROW EXECUTE FUNCTION fn_fare_check_watchlists();

-- ---------------------------------------------------------------------
-- 2b. TRIGGER: data integrity guard
--     A fare snapshot is a historical observation. Its price, route,
--     airline, cabin and flight date can never be edited after insertion.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fare_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.price        IS DISTINCT FROM OLD.price
    OR NEW.route_id     IS DISTINCT FROM OLD.route_id
    OR NEW.airline_iata IS DISTINCT FROM OLD.airline_iata
    OR NEW.cabin_class  IS DISTINCT FROM OLD.cabin_class
    OR NEW.flight_date  IS DISTINCT FROM OLD.flight_date THEN
        RAISE EXCEPTION 'fare_snapshots row % is a historical record and cannot be modified', OLD.snapshot_id
              USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fare_immutable
BEFORE UPDATE ON fare_snapshots
FOR EACH ROW EXECUTE FUNCTION fn_fare_immutable();

-- ---------------------------------------------------------------------
-- 3a. FUNCTION: cheapest dates to fly on a route
--     For each flight date in the next N days, the cheapest airline and
--     price, plus the average price across all observations for that date.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_cheapest_dates(
    p_route_id   INT,
    p_cabin      VARCHAR,
    p_days_ahead INT DEFAULT 30,
    p_limit      INT DEFAULT 10
)
RETURNS TABLE (flight_date DATE, cheapest_airline CHAR(2), min_price NUMERIC, avg_price NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT d.fdate, d.airline_iata, d.price, ROUND(d.avg_all, 2)
    FROM (
        SELECT DISTINCT ON (fs.flight_date)
               fs.flight_date AS fdate,
               fs.airline_iata,
               fs.price,
               AVG(fs.price) OVER (PARTITION BY fs.flight_date) AS avg_all
        FROM   fare_snapshots fs
        WHERE  fs.route_id    = p_route_id
          AND  fs.cabin_class = p_cabin
          AND  fs.flight_date BETWEEN CURRENT_DATE AND CURRENT_DATE + p_days_ahead
        ORDER  BY fs.flight_date, fs.price ASC
    ) d
    ORDER BY d.price ASC
    LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------
-- 3b. FUNCTION: price trend with a 7-day moving average
--     Daily average price by scrape date, moving average, and the
--     day-over-day percentage change (window functions).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_price_trend(
    p_route_id INT,
    p_cabin    VARCHAR,
    p_days     INT DEFAULT 30
)
RETURNS TABLE (obs_date DATE, avg_price NUMERIC, moving_avg_7d NUMERIC, pct_change NUMERIC)
LANGUAGE sql
STABLE
AS $$
    WITH daily AS (
        SELECT fs.scraped_at::date AS d, AVG(fs.price) AS p
        FROM   fare_snapshots fs
        WHERE  fs.route_id    = p_route_id
          AND  fs.cabin_class = p_cabin
          AND  fs.scraped_at >= now() - make_interval(days => p_days)
        GROUP  BY fs.scraped_at::date
    )
    SELECT d,
           ROUND(p, 2),
           ROUND(AVG(p) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2),
           ROUND(100 * (p - LAG(p) OVER (ORDER BY d)) / NULLIF(LAG(p) OVER (ORDER BY d), 0), 2)
    FROM   daily
    ORDER  BY d;
$$;

-- ---------------------------------------------------------------------
-- 4a. PROCEDURE: atomic fare ingestion
--     The scraper stores the raw Amadeus JSON in MongoDB first, then calls
--     this with the resulting ObjectId. Both inserts succeed together or
--     neither is kept (a procedure call runs as one transaction).
--     The price-drop trigger fires inside this same transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_record_fare_snapshot(
    p_route_id      INT,
    p_airline       CHAR(2),
    p_cabin         VARCHAR,
    p_price         NUMERIC,
    p_flight_date   DATE,
    p_mongo_doc_id  CHAR(24),
    INOUT o_snapshot_id BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date)
    VALUES (p_route_id, p_airline, p_cabin, p_price, p_flight_date)
    RETURNING snapshot_id INTO o_snapshot_id;

    INSERT INTO raw_scrape_refs (snapshot_id, mongo_doc_id)
    VALUES (o_snapshot_id, p_mongo_doc_id);
END;
$$;

-- ---------------------------------------------------------------------
-- 4b. PROCEDURE: refresh the heatmap (admin action / scheduled job)
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_refresh_heatmap()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_monthly_route_heatmap;
END;
$$;
