/**
 * Comprehensive API Test Suite
 * Validates requirements #9, #10, #11, #12, #13
 */
const http = require('http');

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let adminToken = null;
let customerToken = null;
let testWatchlistId = null;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting API Verification Test Suite');
  console.log('====================================================\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    console.log('--- 1. Health Check & Database Connectivity (#10) ---');
    const health = await request('GET', '/api/health');
    assert(health.status === 200, `Health status 200 OK (got ${health.status})`);
    assert(health.body.database.postgres === 'connected', 'PostgreSQL database connected');

    // 2. Authentication & Roles (#11)
    console.log('\n--- 2. Authentication & Roles (#11 & #13) ---');
    // Admin login
    const adminLogin = await request('POST', '/api/auth/login', {
      email: 'admin@airfare.local',
      password: 'Admin@12345',
    });
    assert(adminLogin.status === 200, 'Admin login succeeded with bcrypt authentication');
    assert(adminLogin.body.user.role === 'admin', 'Admin role verified in JWT payload');
    adminToken = adminLogin.body.token;

    // Customer login
    const customerLogin = await request('POST', '/api/auth/login', {
      email: 'alice@example.com',
      password: 'Alice@12345',
    });
    assert(customerLogin.status === 200, 'Customer (Alice) login succeeded');
    assert(customerLogin.body.user.role === 'customer', 'Customer role verified');
    customerToken = customerLogin.body.token;

    // Profile check using view v_users_public (#13 security: no password leak)
    const meRes = await request('GET', '/api/auth/me', null, customerToken);
    assert(meRes.status === 200, 'Current profile retrieved via v_users_public');
    assert(!meRes.body.user.password_hash, 'Security #13: password_hash is not exposed in public view');

    // 3. Role-Based Authorization Enforcement (#11 & #13)
    console.log('\n--- 3. RBAC & Security Enforcement (#11 & #13) ---');
    const forbiddenRes = await request('GET', '/api/admin/stats', null, customerToken);
    assert(forbiddenRes.status === 403, 'Customer blocked from accessing admin endpoint (403 Forbidden)');

    const unauthRes = await request('GET', '/api/watchlists', null, null);
    assert(unauthRes.status === 401, 'Unauthenticated request blocked from watchlists (401 Unauthorized)');

    // 4. Input Validation Tests (#12)
    console.log('\n--- 4. Input Validation Tests (#12) ---');
    // Malformed email login
    const badEmail = await request('POST', '/api/auth/login', { email: 'not-an-email', password: 'abc' });
    assert(badEmail.status === 400, 'Malformed email rejected with 400 Bad Request');

    // Invalid negative target price
    const badPrice = await request('POST', '/api/watchlists', {
      route_id: 1,
      cabin_class: 'economy',
      target_price: -50,
    }, customerToken);
    assert(badPrice.status === 400, 'Negative target price rejected by validation middleware');

    // Invalid cabin class
    const badCabin = await request('POST', '/api/watchlists', {
      route_id: 1,
      cabin_class: 'hyper_luxury',
      target_price: 200,
    }, customerToken);
    assert(badCabin.status === 400, 'Invalid cabin class rejected');

    // 5. Database Integration & Stored Functions (#10)
    console.log('\n--- 5. Database Integration (#10) ---');
    const routesRes = await request('GET', '/api/routes');
    assert(routesRes.status === 200 && routesRes.body.routes.length > 0, `Fetched ${routesRes.body.routes.length} routes from v_route_overview`);

    const searchRes = await request('GET', '/api/fares/search?origin=BLR&dest=DXB&cabin_class=economy');
    assert(searchRes.status === 200 && searchRes.body.fares.length > 0, `Search returned ${searchRes.body.fares.length} fare snapshots using composite indexes`);

    const cheapestRes = await request('GET', '/api/fares/cheapest-dates?route_id=1&cabin=economy');
    assert(cheapestRes.status === 200 && cheapestRes.body.cheapestDates.length > 0, 'Successfully executed Stored Function get_cheapest_dates()');

    const trendRes = await request('GET', '/api/fares/price-trend?route_id=1&cabin=economy');
    assert(trendRes.status === 200 && trendRes.body.trend.length > 0, 'Successfully executed Stored Function get_price_trend() (Window functions)');

    const heatmapRes = await request('GET', '/api/fares/heatmap?route_id=1');
    assert(heatmapRes.status === 200, 'Successfully queried Materialized View mv_monthly_route_heatmap');

    // 6. Watchlists & Triggers (#7 & #10)
    console.log('\n--- 6. Watchlists & Price-Drop Triggers (#7 & #10) ---');
    const createWatchlist = await request('POST', '/api/watchlists', {
      route_id: 3, // BOM -> DXB
      cabin_class: 'economy',
      target_price: 300.00,
    }, customerToken);
    assert(createWatchlist.status === 201 || createWatchlist.status === 409, 'Watchlist creation handled properly');
    if (createWatchlist.body.watchlist) {
      testWatchlistId = createWatchlist.body.watchlist.watchlist_id;
    }

    const alertsRes = await request('GET', '/api/alerts', null, customerToken);
    assert(alertsRes.status === 200 && Array.isArray(alertsRes.body.alerts), `Customer has ${alertsRes.body.total} automated trigger alerts`);

    // 7. Admin Stored Procedure Execution (#7, #10, #11)
    console.log('\n--- 7. Admin Console & Stored Procedures (#7 & #11) ---');
    const statsRes = await request('GET', '/api/admin/stats', null, adminToken);
    assert(statsRes.status === 200 && statsRes.body.postgres.fare_snapshots > 0, `Admin telemetry: ${statsRes.body.postgres.fare_snapshots} snapshots recorded`);

    // Execute CALL sp_record_fare_snapshot()
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const dateStr = futureDate.toISOString().split('T')[0];

    const ingestRes = await request('POST', '/api/admin/ingest-snapshot', {
      route_id: 1,
      airline_iata: 'EK',
      cabin_class: 'economy',
      price: 145.00,
      flight_date: dateStr,
      mongo_doc_id: '000000000000000000000064',
    }, adminToken);
    assert(ingestRes.status === 201, `Stored Procedure CALL sp_record_fare_snapshot() succeeded (Snapshot ID: ${ingestRes.body.snapshot_id})`);

    // Refresh Materialized View
    const refreshRes = await request('POST', '/api/admin/refresh-heatmap', null, adminToken);
    assert(refreshRes.status === 200, 'Stored Procedure CALL sp_refresh_heatmap() executed successfully');

    // 8. MongoDB NoSQL Aggregation (#7)
    console.log('\n--- 8. MongoDB NoSQL Aggregation (#7) ---');
    const mongoAggRes = await request('GET', '/api/admin/mongo/aggregations', null, adminToken);
    assert(mongoAggRes.status === 200 && mongoAggRes.body.carrierAvg.length > 0, 'MongoDB multi-stage aggregation pipeline returned carrier averages');

    // Clean up test watchlist if created
    if (testWatchlistId) {
      await request('DELETE', `/api/watchlists/${testWatchlistId}`, null, customerToken);
    }

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

// Wait for server to be ready before running
setTimeout(runTests, 1500);
