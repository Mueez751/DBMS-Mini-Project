-- =====================================================================
-- Airline Fare Intelligence Platform: PostgreSQL schema (DDL)
-- Requirement #5: CREATE / ALTER / DROP, PK/FK, constraints, indexes, views
-- Run order: 01_schema.sql -> 02_advanced.sql -> 03_seed.sql -> 04_queries.sql
-- Re-runnable: everything is dropped and recreated at the top.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- bcrypt hashing (crypt / gen_salt)

-- ---------------------------------------------------------------------
-- 0. RESET (DROP): makes the script safe to re-run
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_route_heatmap;
DROP VIEW  IF EXISTS v_users_public;
DROP VIEW  IF EXISTS v_route_overview;
DROP VIEW  IF EXISTS v_latest_fares;
DROP TABLE IF EXISTS alerts           CASCADE;
DROP TABLE IF EXISTS watchlists       CASCADE;
DROP TABLE IF EXISTS raw_scrape_refs  CASCADE;
DROP TABLE IF EXISTS fare_snapshots   CASCADE;
DROP TABLE IF EXISTS users            CASCADE;
DROP TABLE IF EXISTS routes           CASCADE;
DROP TABLE IF EXISTS airlines         CASCADE;
DROP TABLE IF EXISTS airports         CASCADE;

-- ---------------------------------------------------------------------
-- 1. CREATE TABLES (PKs, FKs, constraints = data validation at DB level)
-- ---------------------------------------------------------------------

-- Reference table: airports
CREATE TABLE airports (
    iata_code  CHAR(3)      PRIMARY KEY
               CONSTRAINT chk_airport_iata CHECK (iata_code ~ '^[A-Z]{3}$'),
    city       VARCHAR(100) NOT NULL,
    country    VARCHAR(100) NOT NULL
);

-- Reference table: airlines
CREATE TABLE airlines (
    iata_code  CHAR(2)      PRIMARY KEY
               CONSTRAINT chk_airline_iata CHECK (iata_code ~ '^[A-Z0-9]{2}$'),
    name       VARCHAR(100) NOT NULL UNIQUE
);

-- A route is an ordered (origin -> destination) airport pair
CREATE TABLE routes (
    route_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origin_iata  CHAR(3) NOT NULL REFERENCES airports(iata_code) ON UPDATE CASCADE ON DELETE RESTRICT,
    dest_iata    CHAR(3) NOT NULL REFERENCES airports(iata_code) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_route_pair      UNIQUE (origin_iata, dest_iata),
    CONSTRAINT chk_route_not_self CHECK  (origin_iata <> dest_iata)
);

-- Application users (two roles: admin / customer)
-- password_hash must look like a bcrypt hash, so plaintext can never be stored.
CREATE TABLE users (
    user_id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          VARCHAR(255) NOT NULL UNIQUE
                   CONSTRAINT chk_user_email CHECK (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
    password_hash  TEXT NOT NULL
                   CONSTRAINT chk_user_bcrypt CHECK (password_hash ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
    role           VARCHAR(10) NOT NULL DEFAULT 'customer'
                   CONSTRAINT chk_user_role CHECK (role IN ('admin', 'customer')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Core time-series table: one row per scraped fare observation
CREATE TABLE fare_snapshots (
    snapshot_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_id      INT          NOT NULL REFERENCES routes(route_id)      ON DELETE CASCADE,
    airline_iata  CHAR(2)      NOT NULL REFERENCES airlines(iata_code)   ON DELETE RESTRICT,
    cabin_class   VARCHAR(20)  NOT NULL
                  CONSTRAINT chk_fare_cabin CHECK (cabin_class IN ('economy','premium_economy','business','first')),
    price         NUMERIC(10,2) NOT NULL
                  CONSTRAINT chk_fare_price CHECK (price > 0),
    flight_date   DATE         NOT NULL,
    scraped_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Bridge to MongoDB: which raw Amadeus document a snapshot came from.
-- mongo_doc_id is a 24-char hex ObjectId. Several snapshots can share one
-- document (one Mongo document = one scrape batch for a route).
CREATE TABLE raw_scrape_refs (
    snapshot_id   BIGINT PRIMARY KEY REFERENCES fare_snapshots(snapshot_id) ON DELETE CASCADE,
    mongo_doc_id  CHAR(24) NOT NULL
                  CONSTRAINT chk_mongo_oid CHECK (mongo_doc_id ~ '^[0-9a-f]{24}$')
);

-- A user's target price for a route + cabin
CREATE TABLE watchlists (
    watchlist_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    route_id      INT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE,
    target_price  NUMERIC(10,2) NOT NULL
                  CONSTRAINT chk_watch_price CHECK (target_price > 0),
    cabin_class   VARCHAR(20) NOT NULL
                  CONSTRAINT chk_watch_cabin CHECK (cabin_class IN ('economy','premium_economy','business','first')),
    CONSTRAINT uq_watch UNIQUE (user_id, route_id, cabin_class)
);

-- Written automatically by a trigger when a fare drops to/below a target
CREATE TABLE alerts (
    alert_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    watchlist_id      INT    NOT NULL REFERENCES watchlists(watchlist_id)       ON DELETE CASCADE,
    fare_snapshot_id  BIGINT NOT NULL REFERENCES fare_snapshots(snapshot_id)    ON DELETE CASCADE,
    triggered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_alert UNIQUE (watchlist_id, fare_snapshot_id)
);

-- ---------------------------------------------------------------------
-- 2. ALTER: add constraints after creation
-- ---------------------------------------------------------------------
-- Stop the same fare being stored twice by a repeated scrape
ALTER TABLE fare_snapshots
    ADD CONSTRAINT uq_fare_observation
    UNIQUE (route_id, airline_iata, cabin_class, flight_date, scraped_at);

-- Sanity cap on a target price
ALTER TABLE watchlists
    ADD CONSTRAINT chk_watch_price_cap CHECK (target_price < 1000000);

-- ---------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------
-- Hottest query path: fares for a route/date/cabin
CREATE INDEX idx_fare_route_date_cabin ON fare_snapshots (route_id, flight_date, cabin_class);
-- Airline comparison queries
CREATE INDEX idx_fare_airline          ON fare_snapshots (airline_iata);
-- Trend queries by scrape time
CREATE INDEX idx_fare_scraped_at       ON fare_snapshots (scraped_at DESC);
-- Used by the alert trigger to find matching watchlists quickly
CREATE INDEX idx_watch_route_cabin     ON watchlists (route_id, cabin_class);
CREATE INDEX idx_alerts_watchlist      ON alerts (watchlist_id);
-- Full-text search on airport / city / country (search box in the app)
CREATE INDEX idx_airports_fts ON airports
    USING GIN (to_tsvector('simple', iata_code || ' ' || city || ' ' || country));

-- ---------------------------------------------------------------------
-- 4. ALTER / DROP demonstration (scratch table, removed again)
-- ---------------------------------------------------------------------
CREATE TABLE scrape_job_demo (
    job_id  INT PRIMARY KEY,
    status  VARCHAR(20)
);
ALTER TABLE scrape_job_demo ADD COLUMN started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE scrape_job_demo RENAME COLUMN status TO job_status;
ALTER TABLE scrape_job_demo ALTER COLUMN job_status SET NOT NULL;
CREATE INDEX idx_tmp_demo ON scrape_job_demo (job_status);
DROP INDEX idx_tmp_demo;
DROP TABLE scrape_job_demo;

-- ---------------------------------------------------------------------
-- 5. VIEWS
-- ---------------------------------------------------------------------
-- Users without the password hash: what the app should read for display
CREATE VIEW v_users_public AS
SELECT user_id, email, role, created_at FROM users;

-- Latest scraped price for every route / airline / cabin / flight date
CREATE VIEW v_latest_fares AS
SELECT DISTINCT ON (route_id, airline_iata, cabin_class, flight_date)
       snapshot_id, route_id, airline_iata, cabin_class, flight_date, price, scraped_at
FROM   fare_snapshots
ORDER  BY route_id, airline_iata, cabin_class, flight_date, scraped_at DESC;

-- Readable route summary (airport names + fare statistics)
CREATE VIEW v_route_overview AS
SELECT r.route_id,
       r.origin_iata || ' -> ' || r.dest_iata AS route,
       ao.city AS origin_city,
       ad.city AS dest_city,
       COUNT(fs.snapshot_id)                   AS observations,
       ROUND(AVG(fs.price), 2)                 AS avg_price,
       MIN(fs.price)                           AS min_price,
       MAX(fs.price)                           AS max_price
FROM   routes r
JOIN   airports ao ON ao.iata_code = r.origin_iata
JOIN   airports ad ON ad.iata_code = r.dest_iata
LEFT   JOIN fare_snapshots fs ON fs.route_id = r.route_id
GROUP  BY r.route_id, ao.city, ad.city;
