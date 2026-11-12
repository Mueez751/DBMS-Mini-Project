# Airline Fare Intelligence Platform: Database Layer

PostgreSQL (relational core) + MongoDB (raw Amadeus payloads).

## Run order

```bash
createdb airfare
psql -d airfare -v ON_ERROR_STOP=1 -f 01_schema.sql      # tables, constraints, indexes, views
psql -d airfare -v ON_ERROR_STOP=1 -f 02_advanced.sql    # triggers, functions, procedures, materialized view
psql -d airfare -v ON_ERROR_STOP=1 -f 03_seed.sql        # sample data (synthetic)
psql -d airfare -f 04_queries.sql                        # DML, queries, transactions, constraint tests
mongosh "mongodb://localhost:27017/airfare" 05_mongo_setup.js   # raw payload collection + aggregations
```

`01_schema.sql` drops and recreates everything, so the whole sequence can be re-run.
Do not put real credentials in these files; the app reads connection details from `.env`.

## Where each requirement is covered

| Requirement | File |
|---|---|
| #5 DDL: CREATE / ALTER / DROP, PK / FK, constraints, indexes, views | `01_schema.sql` |
| #6 DML: INSERT / UPDATE / DELETE / SELECT, JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | `03_seed.sql`, `04_queries.sql` (sections A to D) |
| #7 Triggers | `02_advanced.sql` (2a price-drop alerts, 2b fare immutability) |
| #7 Stored functions / procedures | `02_advanced.sql` (`get_cheapest_dates`, `get_price_trend`, `sp_record_fare_snapshot`, `sp_refresh_heatmap`) |
| #7 Materialized view | `02_advanced.sql` (`mv_monthly_route_heatmap`) |
| #7 Indexing and full-text search | `01_schema.sql` (section 3), `04_queries.sql` (Q9, section E) |
| #7 Transactions | `04_queries.sql` (section F) |
| #7 NoSQL aggregation | `05_mongo_setup.js` (section 5) |
| #12 Validation and integrity | CHECK / FK / UNIQUE constraints; `04_queries.sql` section G (test cases) |
| #13 Security | bcrypt-only `password_hash` enforced by a CHECK constraint; `v_users_public` view |

## PostgreSQL <-> MongoDB link

`raw_scrape_refs.mongo_doc_id` holds the `_id` of the raw document in
`raw_fare_payloads`. One Mongo document is one scrape batch for one route and day.
The scraper stores the raw JSON in MongoDB first, then calls
`CALL sp_record_fare_snapshot(...)` so the snapshot and its reference are saved atomically.

## Sample logins (seed data only)

| Email | Password | Role |
|---|---|---|
| admin@airfare.local | Admin@12345 | admin |
| alice@example.com | Alice@12345 | customer |
| bob@example.com | Bob@12345 | customer |
