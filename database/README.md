# database/

Everything that creates and populates the databases. Run the files **in this order**
(full commands, including Windows PowerShell, are in the root `README.md`):

| Order | File | Purpose |
|---|---|---|
| 1 | `01_schema.sql` | DROP/CREATE/ALTER tables, constraints, indexes, FTS index, views. Re-runnable: it resets everything. |
| 2 | `02_advanced.sql` | Materialized view, triggers, stored functions and procedures. |
| 3 | `03_seed.sql` | Synthetic sample data (2,858 fares, 3 users, watchlists, trigger-generated alerts). |
| 4 | `06_app_security.sql` | Creates the least-privilege role `airfare_app` + login/register functions. Needs `-v app_password=...`. |
| 5 | `04_queries.sql` | Optional: DML demos, report queries, transactions and PASS/FAIL constraint tests. |
| 6 | `05_mongo_setup.js` | MongoDB: validated collection, indexes, sample raw payloads, aggregation demos. |

`06_app_security.sql` must run **after** `01`-`03` because `01_schema.sql` drops the tables (and their grants).
