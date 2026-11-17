# Requirements checklist

Mapping of the "DBMS Level 3 Project: Project Requirements" brief to this repository.
Status: **Met** = implemented in the repository. **Action** = something only the team can complete.

| # | Requirement | Status | Where |
|---|---|---|---|
| 1 | Unique title, real-world problem, not simple CRUD | Met | Fare intelligence: analytics, triggers, two databases. `README.md`, `docs/DOCUMENTATION.md` section 1. *Action:* confirm the title is unique in your section. |
| 2 | Two-member team, responsibilities, both DB and app work | Action | Names in `README.md`. Fill the contribution table (`docs/DOCUMENTATION.md` section 14) and make sure both members have commits touching `database/` and `webapp/`. |
| 3 | SQL (MySQL/PostgreSQL) + NoSQL or vector | Met | PostgreSQL + MongoDB (Option 1). Justified in `docs/DOCUMENTATION.md` section 7. |
| 4 | ER diagram, relational schema, entities, attributes, PK, FK, relationships, constraints; NoSQL data model, indexes, metadata, retrieval | Met | `docs/er_diagram.png`, `docs/DOCUMENTATION.md` sections 5, 6, 8 (SQL and the MongoDB data model, validator, indexes, retrieval strategy). |
| 5 | DDL: CREATE, ALTER, DROP, PK/FK, constraints, indexes, views | Met | `database/01_schema.sql` (ALTER ADD CONSTRAINT; scratch table with ADD/RENAME/ALTER COLUMN, CREATE/DROP INDEX, DROP TABLE; 6 indexes incl. GIN; 3 views), `02_advanced.sql` (materialized view). |
| 6 | DML: INSERT, UPDATE, DELETE, SELECT with JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | Met | `database/03_seed.sql`, `04_queries.sql` sections A to D (13 queries); app statements in `webapp/lib/queries.js`. |
| 7 | At least four advanced concepts | Met (8+) | Transactions (`04_queries.sql` F), views + materialized view, stored procedures and functions (`02_advanced.sql`), triggers (alerts, immutability), indexing (composite, GIN), full-text search, NoSQL aggregation (`05_mongo_setup.js`, `lib/mongo.js`, Admin page), window functions (`get_price_trend`, Q8). Vector similarity search: not used. |
| 8 | Vector / semantic search (optional) | Not applicable | Optional; no unstructured text in the domain. Reasoning in documentation section 7. |
| 9 | Functional Next.js interface with forms, tables, search, filtering, dashboards | Met | `webapp/app/(app)/*`: dashboard with heatmap, search with filters/sort/pagination/trend chart, watchlist forms, alerts table, admin console. Screenshots in `docs/screenshots/`. |
| 10 | App talks to the DB through a backend/API layer; no hard-coded credentials; environment variables | Met | Route handlers in `webapp/app/api/**`; configuration from `webapp/.env.local` (`DATABASE_URL`, `MONGODB_URI`, `SESSION_SECRET`); only `.env.example` is committed. |
| 11 | Authentication and role-based authorization (minimum 2 roles) | Met | Roles `admin` and `customer`. Signed httpOnly cookie, role re-read from the database each request, `middleware.js`, `app/(app)/admin/layout.js`, `route(handler, {roles})`. |
| 12 | Input validation at the database level; consistency and integrity | Met | CHECK / FK / UNIQUE constraints, bcrypt-format check, ObjectId-format check, immutability trigger, Mongo `$jsonSchema` validator. Proven by `04_queries.sql` section G (12 cases) and the API tests. App-side validation (zod) is an extra layer. |
| 13 | Basic DB and web security; no plaintext passwords or credentials | Met | bcrypt via pgcrypto, least-privilege role `airfare_app`, SECURITY DEFINER login/register, parameterised SQL with whitelisted ORDER BY, CSRF Origin check, throttling, CSP/security headers, secrets in git-ignored env file. |
| 14 | Documentation (problem statement ... conclusion) | Met | `docs/DOCUMENTATION.md` has every listed section. *Action:* paste your final `npm test` output in section 13, retake the Admin screenshot, fill section 14. |
| 15 | Git/GitHub, individual commits, README with setup and run steps | Action | Root `README.md` has setup and run instructions. Commit history must be made by you and your partner from your own accounts (see the push steps in the hand-over notes). |
| 16 | Demonstration: problem, ER, schema, DB implementation, queries, Next.js UI, integration, advanced features, test cases, contributions | Met | The README "Try these in the demo" section follows this order; each item has a file or page named in the documentation. |
| 17 | Originality | Action | Design and code are the team's own. Make sure it differs from other teams in the same domain, and cite any tutorial you adapted. |
| 18 | Beyond CRUD; justified database choices | Met | Analytics, triggers, materialized view, cross-database ingest, aggregation pipelines; justification table in documentation section 7. |
