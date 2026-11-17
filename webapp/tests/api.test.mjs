// End-to-end API tests: authentication, roles, validation, ownership, injection, CSRF,
// throttling and the PostgreSQL + MongoDB ingest flow. Run against a running server:
//
//   BASE_URL=http://localhost:3000 node tests/api.test.mjs
//
// Needs the seeded database (database/01 to 03 + 06, and 05_mongo_setup.js) and the sample logins from the README.
// Prints PASS / FAIL for every case and exits non-zero if anything failed.

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ORIGIN = new URL(BASE).origin;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

/** Tiny client that keeps its own cookie jar, one per simulated browser. */
function client() {
  let cookie = '';
  return {
    async req(method, path, body, headers = {}) {
      const res = await fetch(BASE + path, {
        method,
        redirect: 'manual',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const pair = c.split(';')[0];
        if (pair.startsWith('af_session=')) cookie = pair.endsWith('=') ? '' : pair;
      }
      let data = null;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers, setCookie: set };
    },
    get: function (p, h) { return this.req('GET', p, undefined, h); },
    post: function (p, b, h) { return this.req('POST', p, b, h); },
    patch: function (p, b, h) { return this.req('PATCH', p, b, h); },
    del: function (p, h) { return this.req('DELETE', p, undefined, h); },
    setRawCookie(v) { cookie = v; },
  };
}

const anon = client();
const alice = client();
const bob = client();
const admin = client();

async function main() {
  console.log(`Testing ${BASE}\n`);

  // ---------------------------------------------------------------- authentication
  console.log('--- Authentication ---');
  let r = await anon.get('/api/meta');
  check('anonymous API call is rejected (401)', r.status === 401);

  r = await anon.get('/dashboard');
  check('anonymous page request redirects to /login', r.status === 307 && (r.headers.get('location') || '').includes('/login'), `status ${r.status}`);

  r = await anon.post('/api/auth/login', { email: 'alice@example.com', password: 'Wrong@12345' });
  const wrongPwMessage = r.data?.error;
  check('wrong password is rejected (401)', r.status === 401, `status ${r.status}`);

  r = await anon.post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong@12345' });
  check('unknown email gets the same message as a wrong password', r.status === 401 && r.data?.error === wrongPwMessage);

  r = await anon.post('/api/auth/login', { password: 'x' });
  check('login with missing email is a validation error (400)', r.status === 400 && !!r.data?.fields?.email);

  r = await anon.post('/api/auth/login', '{not json');
  check('malformed JSON body is rejected (400)', r.status === 400);

  r = await alice.post('/api/auth/login', { email: 'alice@example.com', password: 'Alice@12345' });
  check('customer can sign in', r.status === 200 && r.data?.user?.role === 'customer', `status ${r.status} ${JSON.stringify(r.data)}`);
  const cookieLine = r.setCookie.find((c) => c.startsWith('af_session=')) || '';
  check('session cookie is HttpOnly', /httponly/i.test(cookieLine));
  check('session cookie is SameSite=Lax', /samesite=lax/i.test(cookieLine));
  check('login response never contains a password or hash', !/password|hash/i.test(JSON.stringify(r.data)));

  r = await alice.get('/api/auth/me');
  check('/api/auth/me returns the signed-in customer', r.status === 200 && r.data?.user?.email === 'alice@example.com');

  r = await bob.post('/api/auth/login', { email: 'bob@example.com', password: 'Bob@12345' });
  check('second customer can sign in', r.status === 200);

  r = await admin.post('/api/auth/login', { email: 'admin@airfare.local', password: 'Admin@12345' });
  check('admin can sign in', r.status === 200 && r.data?.user?.role === 'admin');

  const forged = client();
  forged.setRawCookie('af_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0.invalidsignature');
  r = await forged.get('/api/admin/stats');
  check('forged / tampered session cookie is rejected (401)', r.status === 401, `status ${r.status}`);

  // ---------------------------------------------------------------- authorization (roles)
  console.log('\n--- Role-based access ---');
  r = await alice.get('/api/admin/stats');
  check('customer cannot read admin stats (403)', r.status === 403);
  r = await alice.get('/api/admin/users');
  check('customer cannot list users (403)', r.status === 403);
  r = await alice.post('/api/admin/routes', { origin_iata: 'BLR', dest_iata: 'LHR' });
  check('customer cannot create a route (403)', r.status === 403);
  r = await alice.post('/api/admin/fares', { route_id: 1, airline_iata: 'EK', cabin_class: 'economy', price: 100, flight_date: '2099-01-01' });
  check('customer cannot ingest a fare (403)', r.status === 403);
  r = await alice.post('/api/admin/refresh');
  check('customer cannot refresh the heatmap (403)', r.status === 403);
  r = await alice.get('/admin');
  check('customer is redirected away from the /admin page', r.status === 307 && (r.headers.get('location') || '').includes('/dashboard'), `status ${r.status}`);

  r = await admin.get('/api/admin/stats');
  check('admin can read admin stats', r.status === 200 && r.data?.stats?.customers >= 2);
  r = await admin.get('/api/admin/users');
  check('admin user list has no password hashes', r.status === 200 && r.data.rows.length >= 3 && !/password|hash/i.test(JSON.stringify(r.data)));

  // ---------------------------------------------------------------- registration
  console.log('\n--- Registration ---');
  const stamp = Date.now();
  const fresh = client();
  r = await fresh.post('/api/auth/register', { email: `new${stamp}@example.com`, password: 'short' });
  check('weak password is rejected (400)', r.status === 400 && !!r.data?.fields?.password);
  r = await fresh.post('/api/auth/register', { email: 'not-an-email', password: 'Strong@12345' });
  check('invalid email is rejected (400)', r.status === 400 && !!r.data?.fields?.email);
  r = await fresh.post('/api/auth/register', { email: 'alice@example.com', password: 'Strong@12345' });
  check('duplicate email is rejected (409)', r.status === 409, `status ${r.status}`);
  r = await fresh.post('/api/auth/register', { email: `new${stamp}@example.com`, password: 'Strong@12345', role: 'admin' });
  check('registration succeeds (201)', r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
  r = await fresh.get('/api/auth/me');
  check('a "role: admin" field in the request is ignored: new account is a customer', r.data?.user?.role === 'customer');
  r = await fresh.get('/api/admin/stats');
  check('self-registered account cannot reach admin APIs', r.status === 403);

  // ---------------------------------------------------------------- read APIs
  console.log('\n--- Search, trends and dashboards ---');
  r = await alice.get('/api/meta');
  check('meta lists the 7 seeded routes', r.status === 200 && r.data.routes.length >= 7);
  const routeBlrDxb = r.data.routes.find((x) => x.origin_iata === 'BLR' && x.dest_iata === 'DXB');
  const routeBomDxb = r.data.routes.find((x) => x.origin_iata === 'BOM' && x.dest_iata === 'DXB');

  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&cabin=economy&sort=price_asc&page_size=10`);
  const prices = (r.data?.rows || []).map((x) => x.price);
  check('fare search returns rows for a route', r.status === 200 && prices.length > 0 && r.data.total >= prices.length);
  check('fare search honours ascending price sort', prices.every((p, i) => i === 0 || prices[i - 1] <= p));
  check('fare search only returns the requested cabin', (r.data?.rows || []).every((x) => x.cabin_class === 'economy'));

  const cap = prices.length ? prices[Math.floor(prices.length / 2)] : 200;
  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&cabin=economy&max_price=${cap}`);
  check('max_price filter is respected', r.status === 200 && r.data.rows.every((x) => x.price <= cap));

  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&airline=EK`);
  check('airline filter is respected', r.status === 200 && r.data.rows.length > 0 && r.data.rows.every((x) => x.airline_iata === 'EK'));

  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&page_size=5&page=2`);
  check('pagination returns the requested page size', r.status === 200 && r.data.rows.length <= 5 && r.data.page === 2);

  r = await alice.get('/api/fares?route_id=abc');
  check('non-numeric route_id is rejected (400)', r.status === 400);
  r = await alice.get('/api/fares');
  check('missing route_id is rejected (400)', r.status === 400);
  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&cabin=luxury`);
  check('invalid cabin is rejected (400)', r.status === 400);
  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&airline=${encodeURIComponent("EK' OR '1'='1")}`);
  check('SQL injection attempt in a filter is rejected (400)', r.status === 400);
  r = await alice.get(`/api/fares?route_id=${routeBlrDxb.route_id}&sort=${encodeURIComponent('price; DROP TABLE alerts;--')}`);
  check('SQL injection attempt in sort is rejected (400)', r.status === 400);
  r = await alice.get(`/api/fares?route_id=${encodeURIComponent('1 OR 1=1')}`);
  check('SQL injection attempt in route_id is rejected (400)', r.status === 400);

  r = await alice.get(`/api/cheapest?route_id=${routeBlrDxb.route_id}&cabin=economy&days=30&limit=5`);
  const cheap = (r.data?.rows || []).map((x) => x.min_price);
  check('cheapest dates returns up to the limit, cheapest first', r.status === 200 && cheap.length > 0 && cheap.length <= 5 && cheap.every((p, i) => i === 0 || cheap[i - 1] <= p));

  r = await alice.get(`/api/trend?route_id=${routeBlrDxb.route_id}&cabin=economy&days=14`);
  check('trend returns daily averages with a moving average', r.status === 200 && r.data.rows.length > 3 && r.data.rows[0].moving_avg_7d != null);

  r = await alice.get('/api/heatmap?cabin=economy');
  check('heatmap returns monthly route prices', r.status === 200 && r.data.rows.length > 7 && r.data.rows[0].avg_price > 0);

  r = await alice.get('/api/airports?q=lon');
  check('full-text airport search finds routes touching London', r.status === 200 && r.data.routes.some((x) => x.origin_iata === 'LHR' || x.dest_iata === 'LHR'));
  r = await alice.get('/api/airports?q=zzzzqq');
  check('full-text search with no match returns an empty list', r.status === 200 && r.data.routes.length === 0);
  r = await alice.get(`/api/airports?q=${encodeURIComponent("'); DROP TABLE airports;--")}`);
  check('hostile text in the airport search is harmless', r.status === 200 || r.status === 400);

  r = await alice.get('/api/dashboard');
  check('dashboard returns KPIs, the fare board and route overview', r.status === 200 && r.data.kpi.routes >= 7 && r.data.board.length > 0 && r.data.overview.length > 0);

  // ---------------------------------------------------------------- watchlists
  console.log('\n--- Watchlists (CRUD + ownership) ---');
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'economy', target_price: 150 });
  check('customer creates a watchlist (201)', r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
  const wlId = r.data?.watchlist_id;

  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'economy', target_price: 160 });
  check('duplicate watchlist for the same route + cabin is rejected (409)', r.status === 409);
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'first', target_price: -5 });
  check('negative target price is rejected (400)', r.status === 400 && !!r.data?.fields?.target_price);
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'first', target_price: 0 });
  check('zero target price is rejected (400)', r.status === 400);
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'first', target_price: 'abc' });
  check('non-numeric target price is rejected (400)', r.status === 400);
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'first', target_price: 99.999 });
  check('more than 2 decimal places is rejected (400)', r.status === 400);
  r = await alice.post('/api/watchlists', { route_id: 99999, cabin_class: 'first', target_price: 100 });
  check('unknown route is rejected by the database foreign key (409)', r.status === 409, `status ${r.status}`);
  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'luxury', target_price: 100 });
  check('invalid cabin class is rejected (400)', r.status === 400);

  r = await alice.get('/api/watchlists');
  check('customer sees their own watchlists', r.status === 200 && r.data.rows.some((x) => x.watchlist_id === wlId) && r.data.rows.length >= 3);
  r = await bob.get('/api/watchlists');
  check("customer does not see another user's watchlists", r.status === 200 && !r.data.rows.some((x) => x.watchlist_id === wlId));

  r = await bob.patch(`/api/watchlists/${wlId}`, { target_price: 1 });
  check("a customer cannot edit someone else's watchlist (404)", r.status === 404);
  r = await bob.del(`/api/watchlists/${wlId}`);
  check("a customer cannot delete someone else's watchlist (404)", r.status === 404);

  r = await alice.patch(`/api/watchlists/${wlId}`, { target_price: 155.5 });
  check('owner updates the target price', r.status === 200 && r.data.target_price === 155.5);
  r = await alice.patch(`/api/watchlists/${wlId}`, { target_price: -1 });
  check('owner cannot set an invalid price (400)', r.status === 400);

  r = await alice.post('/api/watchlists', { route_id: routeBomDxb.route_id, cabin_class: 'business', target_price: 100 }, { Origin: 'https://evil.example' });
  check('cross-site request (foreign Origin) is blocked (403)', r.status === 403);

  r = await alice.del(`/api/watchlists/${wlId}`);
  check('owner deletes their watchlist', r.status === 200);
  r = await alice.del(`/api/watchlists/${wlId}`);
  check('deleting it again returns 404', r.status === 404);

  r = await alice.get('/api/alerts');
  check('alerts list returns the trigger-generated alerts', r.status === 200 && r.data.rows.length > 0 && r.data.rows[0].fare > 0);

  // ---------------------------------------------------------------- admin operations
  console.log('\n--- Admin operations ---');
  r = await admin.post('/api/admin/routes', { origin_iata: 'BLR', dest_iata: 'DXB' });
  check('duplicate route is rejected (409)', r.status === 409);
  r = await admin.post('/api/admin/routes', { origin_iata: 'DXB', dest_iata: 'DXB' });
  check('route from an airport to itself is rejected (400)', r.status === 400);
  r = await admin.post('/api/admin/routes', { origin_iata: 'XXX', dest_iata: 'DXB' });
  check('route with an unknown airport is rejected by the foreign key (409)', r.status === 409);
  r = await admin.post('/api/admin/routes', { origin_iata: 'dxb1', dest_iata: 'DEL' });
  check('malformed airport code is rejected (400)', r.status === 400);
  r = await admin.post('/api/admin/routes', { origin_iata: 'SIN', dest_iata: 'DXB' });
  check('admin creates a new route (201)', r.status === 201 || r.status === 409, `status ${r.status}`);

  const statsBefore = (await admin.get('/api/admin/stats')).data;
  r = await admin.post('/api/admin/fares', { route_id: routeBlrDxb.route_id, airline_iata: 'EK', cabin_class: 'economy', price: -1, flight_date: '2099-01-01' });
  check('ingest rejects a negative price (400)', r.status === 400);
  r = await admin.post('/api/admin/fares', { route_id: routeBlrDxb.route_id, airline_iata: 'EK', cabin_class: 'economy', price: 100, flight_date: '2001-01-01' });
  check('ingest rejects a flight date in the past (400)', r.status === 400);

  const flightDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const alertsBefore = (await alice.get('/api/alerts')).data.rows.length;
  r = await admin.post('/api/admin/fares', { route_id: routeBlrDxb.route_id, airline_iata: 'EK', cabin_class: 'economy', price: 111.11, flight_date: flightDate });
  const statsAfter = (await admin.get('/api/admin/stats')).data;
  if (r.status === 201) {
    check('ingest stores the fare in PostgreSQL and the raw payload in MongoDB (201)', !!r.data.snapshot_id && /^[0-9a-f]{24}$/.test(r.data.mongo_doc_id));
    check('ingesting a cheap fare fires the price-drop trigger for matching watchlists', r.data.alerts_triggered >= 1, `alerts_triggered=${r.data.alerts_triggered}`);
    const alertsAfter = (await alice.get('/api/alerts')).data.rows.length;
    check("the new alert appears in the watchlist owner's alert list", alertsAfter > alertsBefore);
    check('snapshot count increased by exactly one', statsAfter.stats.snapshots === statsBefore.stats.snapshots + 1);
    const raw = await admin.get(`/api/admin/raw/${r.data.snapshot_id}`);
    check('admin can open the raw MongoDB payload for that fare', raw.status === 200 && raw.data.payload?.data?.[0]?.price?.total === '111.11', `status ${raw.status}`);
    const rawAsCustomer = await alice.get(`/api/admin/raw/${r.data.snapshot_id}`);
    check('customer cannot open raw payloads (403)', rawAsCustomer.status === 403);
    // Unknown snapshot id
    const missing = await admin.get('/api/admin/raw/99999999');
    check('raw lookup for an unknown snapshot returns 404', missing.status === 404);
  } else {
    check('with MongoDB unreachable, ingest fails cleanly with 503', r.status === 503, `status ${r.status} ${JSON.stringify(r.data)}`);
    check('...and writes nothing to PostgreSQL (no orphan fare)', statsAfter.stats.snapshots === statsBefore.stats.snapshots);
    console.log('NOTE  MongoDB was not reachable: the successful ingest path was not exercised.');
  }

  r = await alice.get('/api/admin/insights');
  check('customer cannot run the MongoDB aggregations (403)', r.status === 403);
  r = await admin.get('/api/admin/insights');
  if (r.status === 200) {
    check('MongoDB aggregation returns carrier averages, stop counts and low-seat counts', Array.isArray(r.data.carrierAvg) && r.data.carrierAvg.length > 0 && Array.isArray(r.data.stops) && Array.isArray(r.data.lowSeats), JSON.stringify(r.data).slice(0, 200));
  } else {
    check('with MongoDB unreachable, the aggregation endpoint fails cleanly with 503', r.status === 503, `status ${r.status}`);
  }

  r = await admin.post('/api/admin/refresh');
  check('admin refreshes the heatmap materialized view', r.status === 200 && r.data.ok === true);

  // ---------------------------------------------------------------- throttling (last: it locks an IP key)
  console.log('\n--- Brute-force throttling ---');
  const attacker = client();
  const target = `lock${stamp}@example.com`;
  let last;
  for (let i = 0; i < 5; i++) last = await attacker.post('/api/auth/login', { email: target, password: 'Wrong@12345' });
  check('first 5 wrong guesses get 401', last.status === 401);
  r = await attacker.post('/api/auth/login', { email: target, password: 'Wrong@12345' });
  check('6th attempt is throttled (429)', r.status === 429, `status ${r.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failed:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(2);
});
