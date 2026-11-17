-- =====================================================================
-- Airline Fare Intelligence Platform: application security layer
-- Requirement #11 (roles), #12 (integrity), #13 (security)
--
-- Run AFTER 01 to 03 (01_schema.sql drops the tables, which also drops grants):
--   psql -d airfare -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -f 06_app_security.sql
--
-- What it does
--   1. Creates airfare_app, a LOGIN role with the minimum privileges the web app needs.
--      The Next.js app connects as this role (DATABASE_URL), never as the table owner.
--   2. The app can NOT read users.password_hash and can not touch the users table at all.
--      Sign-in and sign-up go through two SECURITY DEFINER functions that do the bcrypt
--      work inside the database.
--   3. Fare history is append-only for the app: it can INSERT fares only through the
--      sp_record_fare_snapshot procedure, and can never UPDATE or DELETE them.
--   4. Self-test at the bottom proves each restriction (PASS / FAIL notices).
-- =====================================================================

-- 1. The role -----------------------------------------------------------
SELECT format('CREATE ROLE airfare_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airfare_app') \gexec
SELECT format('ALTER ROLE airfare_app PASSWORD %L', :'app_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO airfare_app', current_database()) \gexec

-- 2. Credential handling happens inside the database ---------------------
-- Returns the user row only when the bcrypt hash matches. Unknown emails still burn one
-- bcrypt computation so response time does not reveal whether an account exists.
CREATE OR REPLACE FUNCTION fn_verify_login(p_email text, p_password text)
RETURNS TABLE (user_id int, email varchar, role varchar)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_hash text;
BEGIN
    SELECT u.password_hash INTO v_hash FROM users u WHERE lower(u.email) = lower(p_email);
    IF v_hash IS NULL THEN
        PERFORM crypt(p_password, '$2a$10$abcdefghijklmnopqrstuu');
        RETURN;
    END IF;
    RETURN QUERY
        SELECT u.user_id, u.email, u.role
        FROM   users u
        WHERE  lower(u.email) = lower(p_email)
          AND  u.password_hash = crypt(p_password, v_hash);
END;
$$;

-- Self-registration always creates a 'customer'. Admins can only be created by the
-- database owner, so nobody can sign themselves up as an admin through the app.
CREATE OR REPLACE FUNCTION fn_register_user(p_email text, p_password text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id int;
BEGIN
    IF length(p_password) < 8 OR length(p_password) > 72 THEN
        RAISE EXCEPTION 'Password must be 8 to 72 characters' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO users (email, password_hash, role)
    VALUES (lower(trim(p_email)), crypt(p_password, gen_salt('bf', 10)), 'customer')
    RETURNING user_id INTO v_id;
    RETURN v_id;
END;
$$;

-- 3. Routines that write on the app's behalf run with the owner's rights --
-- so the app role needs EXECUTE only, not INSERT on the underlying tables.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public'
          AND  p.proname IN ('sp_record_fare_snapshot', 'sp_refresh_heatmap', 'fn_fare_check_watchlists')
    LOOP
        EXECUTE format('ALTER ROUTINE %s SECURITY DEFINER SET search_path = public, pg_temp', r.sig);
    END LOOP;

    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public'
          AND  p.proname IN ('fn_verify_login', 'fn_register_user', 'sp_record_fare_snapshot',
                             'sp_refresh_heatmap', 'get_cheapest_dates', 'get_price_trend')
    LOOP
        EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC', r.sig);
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO airfare_app', r.sig);
    END LOOP;
END $$;

-- 4. Table privileges (least privilege) ---------------------------------
GRANT USAGE ON SCHEMA public TO airfare_app;

GRANT SELECT ON airports, airlines, routes, fare_snapshots, raw_scrape_refs, alerts, watchlists,
                v_users_public, v_latest_fares, v_route_overview, mv_monthly_route_heatmap
      TO airfare_app;
GRANT INSERT, UPDATE, DELETE ON watchlists TO airfare_app;   -- customers manage their own watchlists
GRANT INSERT ON routes TO airfare_app;                       -- admins add routes (checked in the app)
-- Deliberately NOT granted: any access to users, UPDATE/DELETE on fare_snapshots,
-- DELETE on routes/airports/airlines, and any DDL.

-- 5. Self-test: each statement below must be refused to airfare_app --------
DO $$
DECLARE
    t record;
    n int;
BEGIN
    SET LOCAL ROLE airfare_app;

    FOR t IN
        SELECT * FROM (VALUES
            ('read password hashes',          'SELECT password_hash FROM users'),
            ('read the users table',          'SELECT * FROM users'),
            ('promote a user to admin',       'UPDATE users SET role = ''admin'''),
            ('insert users directly',         'INSERT INTO users (email, password_hash, role) VALUES (''x@y.zz'', ''x'', ''admin'')'),
            ('delete fare history',           'DELETE FROM fare_snapshots'),
            ('edit fare history',             'UPDATE fare_snapshots SET price = 1'),
            ('insert a fare without the SP',  'INSERT INTO fare_snapshots (route_id, airline_iata, cabin_class, price, flight_date) VALUES (1, ''EK'', ''economy'', 100, CURRENT_DATE)'),
            ('delete a route',                'DELETE FROM routes'),
            ('drop a table',                  'DROP TABLE alerts')
        ) AS v(label, stmt)
    LOOP
        BEGIN
            EXECUTE t.stmt;
            RAISE NOTICE 'FAIL: airfare_app was allowed to %', t.label;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS: airfare_app cannot %', t.label;
        END;
    END LOOP;

    -- the things the app MUST still be able to do
    SELECT COUNT(*) INTO n FROM fn_verify_login('admin@airfare.local', 'Admin@12345');
    RAISE NOTICE '%: login function accepts the right password', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END;
    SELECT COUNT(*) INTO n FROM fn_verify_login('admin@airfare.local', 'wrong-password');
    RAISE NOTICE '%: login function rejects a wrong password', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;
    SELECT COUNT(*) INTO n FROM v_users_public;
    RAISE NOTICE '%: app can list users without hashes (% rows)', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
