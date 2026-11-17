# Airline Fare Intelligence Platform

DBMS Experiential Learning, Level 3 Project - PES University

## Team

| Name | SRN |
|---|---|
| Maniish Rajendran | PES2UG24CS265 |
| Mueez Ahmed | PES2UG24CS286 |

## What it is

Airfares change every day, and a traveller cannot tell whether today's price is good. This platform
records fare observations for a set of routes, then shows:

- the **cheapest upcoming fare per route** compared with that route's average (a departure-board dashboard),
- the **cheapest days to fly**, a **price trend with a 7-day moving average**, and a **monthly price heatmap**,
- **watchlists with target prices**: when a newly recorded fare reaches a target, a database **trigger** writes an alert,
- an **admin console** that records fares across *two databases* at once, inspects raw payloads, and runs MongoDB aggregations.

It is not a CRUD app: the value is in the analytics (window functions, materialized view, stored functions),
the trigger-driven alerts, and the PostgreSQL + MongoDB data flow.

## Databases (SQL + NoSQL, Option 1)

| Database | Holds | Why |
|---|---|---|
| **PostgreSQL** | users, airports, airlines, routes, fare snapshots, watchlists, alerts | Structured, relational, time-series data that needs constraints, joins, triggers, window functions and transactions. |
| **MongoDB** | raw Amadeus flight-offer JSON (`raw_fare_payloads`) | Deeply nested, variable-shape documents (optional fields, nonstop vs connecting, per-carrier extras). Stored as received; the normalised price goes to PostgreSQL. |

Link between them: `raw_scrape_refs.mongo_doc_id` (PostgreSQL) = `_id` of the document in MongoDB.

## Tech stack

Next.js 15 (App Router, route handlers as the API layer) - React 19 - PostgreSQL 14+ (with `pgcrypto`) - MongoDB 6+ -
`pg`, `mongodb`, `zod`, `jose` (signed session cookie). No credentials in source; everything comes from environment variables.

## Repository layout

```
airfare-intelligence/
├── README.md               <- you are here
├── database/               <- all SQL + MongoDB scripts (run in order, see below)
│   ├── 01_schema.sql           DDL: tables, constraints, indexes, views, ALTER/DROP demo
│   ├── 02_advanced.sql         materialized view, triggers, functions, procedures
│   ├── 03_seed.sql             sample data
│   ├── 04_queries.sql          DML, important queries, transactions, constraint tests
│   ├── 05_mongo_setup.js       MongoDB collection, validator, indexes, aggregations
│   └── 06_app_security.sql     least-privilege DB role, login/register functions
├── webapp/                 <- Next.js application (UI + API routes)
│   ├── app/                    pages (app/(app), app/(auth)) and API (app/api/**)
│   ├── components/             UI components (Nav, Heatmap, LineChart, ...)
│   ├── lib/                    db, mongo, auth, validation, queries (ALL app SQL), ingest
│   ├── middleware.js           first-line auth/role gate
│   ├── tests/api.test.mjs      end-to-end API tests
│   └── .env.example            configuration template
└── docs/                   <- project documentation, ER diagram, screenshots
    ├── DOCUMENTATION.md        full report (problem statement ... conclusion)
    ├── REQUIREMENTS_CHECKLIST.md  every requirement of the project brief -> where it is met
    ├── er_diagram.png / .svg / .dot
    └── screenshots/
```

## Setup

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer (`psql` on your PATH) - the `pgcrypto` extension ships with the standard install
- MongoDB 6 or newer running on `localhost:27017`, and `mongosh`

### 1. Create the PostgreSQL database

Pick a password for the restricted application role (`airfare_app`) and keep it for step 3.

**Windows (PowerShell)**

```powershell
$env:PGPASSWORD = "<your postgres superuser password>"
createdb -U postgres airfare
psql -U postgres -d airfare -v ON_ERROR_STOP=1 -f database/01_schema.sql
psql -U postgres -d airfare -v ON_ERROR_STOP=1 -f database/02_advanced.sql
psql -U postgres -d airfare -v ON_ERROR_STOP=1 -f database/03_seed.sql
psql -U postgres -d airfare -v ON_ERROR_STOP=1 -v app_password="ChooseAStrongPassword1" -f database/06_app_security.sql
psql -U postgres -d airfare -f database/04_queries.sql      # optional: demo queries + PASS/FAIL tests
```

**macOS / Linux**

```bash
createdb airfare
psql -d airfare -v ON_ERROR_STOP=1 -f database/01_schema.sql
psql -d airfare -v ON_ERROR_STOP=1 -f database/02_advanced.sql
psql -d airfare -v ON_ERROR_STOP=1 -f database/03_seed.sql
psql -d airfare -v ON_ERROR_STOP=1 -v app_password='ChooseAStrongPassword1' -f database/06_app_security.sql
psql -d airfare -f database/04_queries.sql                  # optional
```

`06_app_security.sql` prints `PASS` notices proving the app role cannot read password hashes, edit fares, or drop tables.
`01_schema.sql` drops and recreates everything, so the whole sequence can be re-run to reset the data.

### 2. Load MongoDB

```bash
mongosh "mongodb://localhost:27017/airfare" database/05_mongo_setup.js
```

This creates the validated `raw_fare_payloads` collection, its indexes (including a 90-day TTL), 98 sample
documents, and prints the aggregation results. The last line should read `PASS: invalid document rejected`.

### 3. Configure and start the web app

```bash
cd webapp
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```

Edit `.env.local`:

- `DATABASE_URL=postgresql://airfare_app:<the app_password from step 1>@localhost:5432/airfare`
  (URL-encode special characters in the password: `@` becomes `%40`, `#` becomes `%23`)
- `SESSION_SECRET=` a random string of at least 32 characters:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
- `MONGODB_URI` / `MONGODB_DB` only if MongoDB is not on `localhost:27017` / `airfare`

Then:

```bash
npm install
npm run dev            # http://localhost:3000
```

Production build: `npm run build && npm start` (add `COOKIE_SECURE=false` to `.env.local` when testing over plain http://localhost).

### 4. Sign in (seed data only)

| Email | Password | Role |
|---|---|---|
| admin@airfare.local | Admin@12345 | admin |
| alice@example.com | Alice@12345 | customer |
| bob@example.com | Bob@12345 | customer |

New accounts can be created on the Register page and are always `customer`.
Set `NEXT_PUBLIC_SHOW_DEMO_LOGINS=false` and change these passwords outside coursework.

### 5. Run the tests

With the app running (`npm run dev` in one terminal):

```bash
cd webapp
npm test                                   # BASE_URL defaults to http://localhost:3000
```

The suite covers authentication, role checks, validation, SQL-injection attempts, ownership rules, CSRF, brute-force
throttling, and the PostgreSQL + MongoDB ingest flow. It exits non-zero if any check fails.
Database-level tests (constraints, triggers, transactions, privileges) print `PASS`/`FAIL` from
`04_queries.sql` and `06_app_security.sql`.

## Try these in the demo

1. **Trigger**: sign in as admin, Admin -> *Record a fare*: BLR to DXB, Emirates, Economy, price `120`, any future date. The
   confirmation says how many watchlists were alerted. Sign in as alice: it shows up under *Alerts*.
2. **Two-database write**: after recording, copy the fare number into *Inspect a raw payload*: PostgreSQL row -> `mongo_doc_id` -> the raw JSON from MongoDB.
3. **Aggregation**: Admin -> *Raw payload analytics* (MongoDB `$unwind` / `$group` pipelines).
4. **Materialized view**: record fares, then *Refresh monthly prices*; the dashboard heatmap updates.
5. **Integrity**: try a negative price, a route from an airport to itself, or a duplicate watchlist: the database constraint message appears.
6. **Roles**: sign in as alice and open `/admin`: redirected; `GET /api/admin/stats` returns 403.

## Documentation

- [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md): problem statement, objectives, scope, functional requirements, ER diagram,
  relational schema, database justification, data dictionary, implementation, important queries, architecture, screenshots, testing, conclusion.
- [`docs/REQUIREMENTS_CHECKLIST.md`](docs/REQUIREMENTS_CHECKLIST.md): each of the 18 points in the project brief and where it is satisfied.

## Known limits

- Login throttling is in memory (per server process); use Redis or similar for multiple instances.
- The Content-Security-Policy allows `'unsafe-inline'` scripts because Next.js needs it without a nonce setup.
- Seed data is synthetic; the Amadeus payloads in MongoDB are Amadeus-shaped samples, not live API responses.
- Two databases cannot share one transaction. `lib/ingest.js` writes MongoDB first and deletes the document again if the PostgreSQL step fails.
