/**
 * SkyPulse - Airline Fare Intelligence Platform Frontend
 * Comprehensive Database-Driven Web Interface
 */

const state = {
  currentUser: null,
  token: localStorage.getItem('token') || null,
  routes: [],
  airports: [],
  airlines: [],
  priceTrendChart: null,
  cheapestDatesChart: null,
  authMode: 'login', // 'login' or 'register'
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupAuthEvents();
  setupSearchEvents();
  setupAnalyticsEvents();
  setupWatchlistEvents();
  setupAdminEvents();

  // Load initial reference data
  await loadReferenceData();

  // Check auth session
  await checkAuthSession();

  // Load initial fare results
  loadInitialFares();
});

/* ==========================================================================
   Helper: API Fetch with JWT Authorization
   ========================================================================== */
async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || (data.details ? data.details.join(', ') : 'Request failed'));
  }
  return data;
}

/* ==========================================================================
   Toast Notifications
   ========================================================================== */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    info: 'fa-circle-info',
  };

  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

/* ==========================================================================
   Tab Navigation
   ========================================================================== */
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTabId = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });

      const targetContent = document.getElementById(targetTabId);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // Tab specific triggers
      if (targetTabId === 'tab-analytics') {
        renderAnalyticsCharts();
        loadHeatmap();
      } else if (targetTabId === 'tab-watchlists') {
        if (!state.currentUser) {
          openLoginModal();
          showToast('Please sign in to view your watchlists and alerts', 'info');
        } else {
          loadUserWatchlists();
          loadUserAlerts();
        }
      } else if (targetTabId === 'tab-admin') {
        if (!state.currentUser || state.currentUser.role !== 'admin') {
          showToast('Admin privilege required', 'error');
        } else {
          loadAdminTelemetry();
        }
      }
    });
  });
}

/* ==========================================================================
   Authentication & Roles (#11 & #13)
   ========================================================================== */
async function checkAuthSession() {
  if (!state.token) {
    updateAuthUI(null);
    return;
  }

  try {
    const data = await apiFetch('/api/auth/me');
    state.currentUser = data.user;
    updateAuthUI(state.currentUser);
    updateAlertBadge();
  } catch (err) {
    console.warn('Session expired or invalid:', err.message);
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('token');
    updateAuthUI(null);
  }
}

function updateAuthUI(user) {
  const loggedOutDiv = document.getElementById('authLoggedOut');
  const loggedInDiv = document.getElementById('authLoggedIn');
  const adminTab = document.getElementById('navAdminTab');

  if (user) {
    loggedOutDiv.style.display = 'none';
    loggedInDiv.style.display = 'flex';

    document.getElementById('userEmailText').textContent = user.email;
    document.getElementById('userAvatar').textContent = user.email.charAt(0).toUpperCase();

    const roleBadge = document.getElementById('userRoleBadge');
    roleBadge.textContent = user.role;
    roleBadge.className = `user-role-badge ${user.role}`;

    // Admin role shows admin console tab
    if (user.role === 'admin') {
      adminTab.style.display = 'flex';
    } else {
      adminTab.style.display = 'none';
    }
  } else {
    loggedOutDiv.style.display = 'flex';
    loggedInDiv.style.display = 'none';
    adminTab.style.display = 'none';
    document.getElementById('navAlertBadge').textContent = '0';
  }
}

function setupAuthEvents() {
  const modal = document.getElementById('loginModal');
  const btnOpen = document.getElementById('btnOpenLoginModal');
  const btnClose = document.getElementById('btnCloseLoginModal');
  const btnLogout = document.getElementById('btnLogout');
  const authForm = document.getElementById('authForm');
  const toggleLink = document.getElementById('authToggleLink');

  btnOpen.addEventListener('click', openLoginModal);
  btnClose.addEventListener('click', () => modal.classList.remove('active'));

  // Quick Demo Login buttons
  document.querySelectorAll('.btn-demo').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('authEmail').value = btn.dataset.email;
      document.getElementById('authPassword').value = btn.dataset.pass;
      authForm.dispatchEvent(new Event('submit'));
    });
  });

  // Toggle Login / Register
  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    const isRegister = state.authMode === 'register';
    state.authMode = isRegister ? 'login' : 'register';

    document.getElementById('authModalTitle').textContent = isRegister ? 'Sign In to SkyPulse' : 'Create New Account';
    document.getElementById('btnSubmitAuth').textContent = isRegister ? 'Sign In' : 'Register Account';
    document.getElementById('authToggleText').textContent = isRegister ? 'Need an account?' : 'Already have an account?';
    toggleLink.textContent = isRegister ? 'Create Account' : 'Sign In';
    document.getElementById('authRoleGroup').style.display = isRegister ? 'none' : 'block';
  });

  // Submit Login/Register
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('authErrorMsg');
    errorBox.style.display = 'none';

    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const role = document.getElementById('authRole').value;

    try {
      const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = state.authMode === 'register' ? { email, password, role } : { email, password };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      state.token = res.token;
      state.currentUser = res.user;
      localStorage.setItem('token', res.token);

      updateAuthUI(state.currentUser);
      modal.classList.remove('active');
      showToast(`Welcome, ${state.currentUser.email}! (${state.currentUser.role})`, 'success');

      updateAlertBadge();
      if (document.getElementById('tab-watchlists').classList.contains('active')) {
        loadUserWatchlists();
        loadUserAlerts();
      }
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    }
  });

  // Logout
  btnLogout.addEventListener('click', async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('token');
    updateAuthUI(null);
    showToast('Signed out successfully', 'info');

    // If on protected tab, switch back to search
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab && (activeTab.dataset.tab === 'tab-watchlists' || activeTab.dataset.tab === 'tab-admin')) {
      document.querySelector('[data-tab="tab-search"]').click();
    }
  });
}

function openLoginModal() {
  document.getElementById('loginModal').classList.add('active');
}

/* ==========================================================================
   Reference Data Loading (#10)
   ========================================================================== */
async function loadReferenceData() {
  try {
    const [routesRes, airportsRes, airlinesRes] = await Promise.all([
      apiFetch('/api/routes'),
      apiFetch('/api/routes/airports'),
      apiFetch('/api/routes/airlines'),
    ]);

    state.routes = routesRes.routes || [];
    state.airports = airportsRes.airports || [];
    state.airlines = airlinesRes.airlines || [];

    populateAirportDropdowns();
    populateRouteDropdowns();
    renderQuickRouteChips();
  } catch (err) {
    console.error('Failed to load reference data:', err);
    showToast('Failed to load airport and route references', 'error');
  }
}

function populateAirportDropdowns() {
  const originSelect = document.getElementById('searchOrigin');
  const destSelect = document.getElementById('searchDest');

  originSelect.innerHTML = '<option value="">Select Origin...</option>';
  destSelect.innerHTML = '<option value="">Select Destination...</option>';

  state.airports.forEach(ap => {
    const optText = `${ap.city} (${ap.iata_code}) - ${ap.country}`;
    originSelect.add(new Option(optText, ap.iata_code));
    destSelect.add(new Option(optText, ap.iata_code));
  });

  // Set default search pair: BLR -> DXB
  originSelect.value = 'BLR';
  destSelect.value = 'DXB';
}

function populateRouteDropdowns() {
  const analyticsRoute = document.getElementById('analyticsRoute');
  const ingestRoute = document.getElementById('ingestRoute');
  const watchlistRoute = document.getElementById('modalWatchlistRoute');
  const ingestAirline = document.getElementById('ingestAirline');

  analyticsRoute.innerHTML = '';
  ingestRoute.innerHTML = '';
  watchlistRoute.innerHTML = '';
  ingestAirline.innerHTML = '';

  state.routes.forEach(r => {
    const label = `${r.route} (${r.from_city} → ${r.to_city})`;
    analyticsRoute.add(new Option(label, r.route_id));
    ingestRoute.add(new Option(label, r.route_id));
    watchlistRoute.add(new Option(label, r.route_id));
  });

  state.airlines.forEach(a => {
    ingestAirline.add(new Option(`${a.name} (${a.iata_code})`, a.iata_code));
  });
}

function renderQuickRouteChips() {
  const bar = document.getElementById('quickRoutesBar');
  // keep label
  const label = bar.querySelector('.quick-label');
  bar.innerHTML = '';
  bar.appendChild(label);

  state.routes.slice(0, 5).forEach(r => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'route-chip';
    chip.textContent = `${r.origin_iata || r.route.split('-')[0]} ✈ ${r.dest_iata || r.route.split('-')[1]}`;
    chip.addEventListener('click', () => {
      const parts = r.route.split('-');
      document.getElementById('searchOrigin').value = parts[0];
      document.getElementById('searchDest').value = parts[1];
      document.getElementById('fareSearchForm').dispatchEvent(new Event('submit'));
    });
    bar.appendChild(chip);
  });
}

/* ==========================================================================
   Fare Search & Results (#10)
   ========================================================================== */
function setupSearchEvents() {
  const form = document.getElementById('fareSearchForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const origin = document.getElementById('searchOrigin').value;
    const dest = document.getElementById('searchDest').value;
    const cabin = document.getElementById('searchCabin').value;
    const startDate = document.getElementById('searchStartDate').value;
    const endDate = document.getElementById('searchEndDate').value;

    if (origin === dest) {
      showToast('Origin and destination cannot be the same airport', 'error');
      return;
    }

    const params = new URLSearchParams({
      origin,
      dest,
      cabin_class: cabin,
    });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const list = document.getElementById('fareResultsList');
    list.innerHTML = `<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i> Querying indexed fares...</div>`;

    try {
      const data = await apiFetch(`/api/fares/search?${params.toString()}`);
      renderFareCards(data.fares);
      document.getElementById('searchResultsCount').textContent = `Found ${data.total} flight fare observation(s)`;
    } catch (err) {
      list.innerHTML = `<div class="loading-state text-danger">${err.message}</div>`;
    }
  });

  // Track route from search
  document.getElementById('btnCreateWatchlistFromSearch').addEventListener('click', () => {
    if (!state.currentUser) {
      openLoginModal();
      showToast('Please sign in to create a price alert watchlist', 'info');
      return;
    }

    const origin = document.getElementById('searchOrigin').value;
    const dest = document.getElementById('searchDest').value;
    const cabin = document.getElementById('searchCabin').value;

    const matchedRoute = state.routes.find(r => r.route === `${origin}-${dest}`);
    if (matchedRoute) {
      document.getElementById('modalWatchlistRoute').value = matchedRoute.route_id;
    }
    document.getElementById('modalWatchlistCabin').value = cabin;
    document.getElementById('createWatchlistModal').classList.add('active');
  });
}

async function loadInitialFares() {
  const list = document.getElementById('fareResultsList');
  try {
    const data = await apiFetch('/api/fares/search?limit=12');
    renderFareCards(data.fares);
  } catch (err) {
    list.innerHTML = `<div class="loading-state">Could not load fares: ${err.message}</div>`;
  }
}

function renderFareCards(fares) {
  const container = document.getElementById('fareResultsList');
  if (!fares || fares.length === 0) {
    container.innerHTML = `<div class="loading-state">No fares found matching your search criteria.</div>`;
    return;
  }

  container.innerHTML = fares.map(f => {
    const flightDate = new Date(f.flight_date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return `
      <div class="fare-card">
        <div class="fare-top">
          <div class="airline-badge">
            <span class="carrier-tag">${f.airline_iata}</span>
            <span>${f.airline_name || f.airline_iata}</span>
          </div>
          <span class="cabin-tag">${f.cabin_class.replace('_', ' ')}</span>
        </div>

        <div class="route-flight-row">
          <div class="airport-info">
            <div class="airport-code">${f.origin_iata}</div>
            <div class="airport-city">${f.origin_city || ''}</div>
          </div>
          <div class="flight-arrow">
            <i class="fa-solid fa-plane"></i>
          </div>
          <div class="airport-info">
            <div class="airport-code">${f.dest_iata}</div>
            <div class="airport-city">${f.dest_city || ''}</div>
          </div>
        </div>

        <div class="fare-bottom">
          <div class="flight-date-text">
            <i class="fa-regular fa-calendar"></i> ${flightDate}
          </div>
          <div class="fare-price">$${parseFloat(f.price).toFixed(2)}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   Analytics, Charts & Materialized View (#7 & #9)
   ========================================================================== */
function setupAnalyticsEvents() {
  document.getElementById('btnRefreshAnalytics').addEventListener('click', () => {
    renderAnalyticsCharts();
  });
}

async function renderAnalyticsCharts() {
  const routeId = document.getElementById('analyticsRoute').value || 1;
  const cabin = document.getElementById('analyticsCabin').value || 'economy';
  const days = document.getElementById('analyticsDays').value || 30;

  try {
    const [trendData, cheapestData] = await Promise.all([
      apiFetch(`/api/fares/price-trend?route_id=${routeId}&cabin=${cabin}&days=${days}`),
      apiFetch(`/api/fares/cheapest-dates?route_id=${routeId}&cabin=${cabin}&days=${days}&limit=10`),
    ]);

    drawPriceTrendChart(trendData.trend || []);
    drawCheapestDatesChart(cheapestData.cheapestDates || []);
  } catch (err) {
    console.error('Analytics charts error:', err);
    showToast('Failed to load analytics chart data', 'error');
  }
}

function drawPriceTrendChart(trendRows) {
  const ctx = document.getElementById('chartPriceTrend').getContext('2d');
  if (state.priceTrendChart) {
    state.priceTrendChart.destroy();
  }

  const labels = trendRows.map(r => new Date(r.obs_date || r.flight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const avgPrices = trendRows.map(r => parseFloat(r.avg_price || r.min_price || 0));
  const rollingAvgs = trendRows.map(r => parseFloat(r.moving_avg_7d || r.rolling_7d_avg || 0));

  state.priceTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Daily Avg Price ($)',
          data: avgPrices,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
        },
        {
          label: '7-Day Rolling Moving Avg ($)',
          data: rollingAvgs,
          borderColor: '#3b82f6',
          borderDash: [5, 5],
          tension: 0.3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      },
    },
  });
}

function drawCheapestDatesChart(cheapestRows) {
  const ctx = document.getElementById('chartCheapestDates').getContext('2d');
  if (state.cheapestDatesChart) {
    state.cheapestDatesChart.destroy();
  }

  const labels = cheapestRows.map(r => `${new Date(r.flight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${r.cheapest_airline})`);
  const prices = cheapestRows.map(r => parseFloat(r.min_price));

  state.cheapestDatesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Best Price ($)',
          data: prices,
          backgroundColor: '#06b6d4',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      },
    },
  });
}

async function loadHeatmap() {
  const tbody = document.querySelector('#heatmapTable tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center">Querying materialized view mv_monthly_route_heatmap...</td></tr>`;

  try {
    const data = await apiFetch('/api/fares/heatmap');
    if (!data.heatmap || data.heatmap.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center">No heatmap data found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.heatmap.map(row => {
      const monthStr = new Date(row.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return `
        <tr>
          <td><strong>${row.route}</strong></td>
          <td>${monthStr}</td>
          <td><span class="cabin-tag">${row.cabin_class.replace('_', ' ')}</span></td>
          <td>${row.observations}</td>
          <td>$${parseFloat(row.avg_price).toFixed(2)}</td>
          <td style="color: var(--accent-emerald); font-weight:700;">$${parseFloat(row.min_price).toFixed(2)}</td>
          <td>$${parseFloat(row.max_price).toFixed(2)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${err.message}</td></tr>`;
  }
}

/* ==========================================================================
   Watchlists & Price-Drop Alerts (#7, #11, #12)
   ========================================================================== */
function setupWatchlistEvents() {
  const modal = document.getElementById('createWatchlistModal');
  const btnClose = document.getElementById('btnCloseWatchlistModal');
  const btnOpen = document.getElementById('btnOpenCreateWatchlistModal');
  const form = document.getElementById('createWatchlistForm');

  btnOpen.addEventListener('click', () => {
    if (!state.currentUser) {
      openLoginModal();
      showToast('Please sign in to create a watchlist', 'info');
      return;
    }
    modal.classList.add('active');
  });

  btnClose.addEventListener('click', () => modal.classList.remove('active'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('watchlistModalError');
    errorBox.style.display = 'none';

    const routeId = document.getElementById('modalWatchlistRoute').value;
    const cabin = document.getElementById('modalWatchlistCabin').value;
    const targetPrice = document.getElementById('modalWatchlistTarget').value;

    try {
      await apiFetch('/api/watchlists', {
        method: 'POST',
        body: JSON.stringify({
          route_id: routeId,
          cabin_class: cabin,
          target_price: targetPrice,
        }),
      });

      modal.classList.remove('active');
      showToast('Watchlist created! Price drop triggers are actively monitoring this route.', 'success');
      loadUserWatchlists();
      loadUserAlerts();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    }
  });
}

async function loadUserWatchlists() {
  const container = document.getElementById('watchlistsList');
  container.innerHTML = `<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading your watchlists...</div>`;

  try {
    const data = await apiFetch('/api/watchlists');
    if (!data.watchlists || data.watchlists.length === 0) {
      container.innerHTML = `<div class="loading-state">No active watchlists. Click "New Watchlist" to start tracking flight fares!</div>`;
      return;
    }

    container.innerHTML = data.watchlists.map(w => `
      <div class="watchlist-card" data-id="${w.watchlist_id}">
        <div class="watchlist-card-left">
          <div style="font-weight:700; font-size:1.05rem;">
            ${w.origin_iata} ✈ ${w.dest_iata}
            <span style="font-weight:400; font-size:0.8rem; color: var(--text-dim);">(${w.origin_city} to ${w.dest_city})</span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted);">
            Cabin: <strong class="cabin-tag">${w.cabin_class}</strong> |
            Alerts: <strong style="color:var(--accent-emerald);">${w.alert_count}</strong>
            ${w.best_alerting_fare ? `| Lowest Alerted: <strong>$${parseFloat(w.best_alerting_fare).toFixed(2)}</strong>` : ''}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:0.75rem;">
          <div class="target-price-edit-row">
            <span style="font-size:0.8rem; color:var(--text-dim);">$</span>
            <input type="number" step="0.01" class="form-control input-sm target-input" value="${parseFloat(w.target_price).toFixed(2)}">
            <button class="btn btn-secondary btn-sm btn-update-target" title="Update target price">
              <i class="fa-solid fa-check"></i>
            </button>
          </div>
          <button class="btn btn-danger btn-sm btn-delete-watchlist" title="Delete watchlist">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');

    // Attach actions to watchlist buttons
    container.querySelectorAll('.btn-update-target').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = e.target.closest('.watchlist-card');
        const id = card.dataset.id;
        const newPrice = card.querySelector('.target-input').value;

        try {
          await apiFetch(`/api/watchlists/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ target_price: newPrice }),
          });
          showToast('Target price updated successfully', 'success');
          loadUserAlerts();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.btn-delete-watchlist').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = e.target.closest('.watchlist-card');
        const id = card.dataset.id;
        if (!confirm('Are you sure you want to delete this watchlist and its alerts?')) return;

        try {
          await apiFetch(`/api/watchlists/${id}`, { method: 'DELETE' });
          showToast('Watchlist removed', 'info');
          loadUserWatchlists();
          loadUserAlerts();
          updateAlertBadge();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="loading-state text-danger">${err.message}</div>`;
  }
}

async function loadUserAlerts() {
  const container = document.getElementById('alertsList');
  const badge = document.getElementById('alertTotalCountBadge');
  container.innerHTML = `<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i> Checking alerts...</div>`;

  try {
    const data = await apiFetch('/api/alerts');
    badge.textContent = `${data.total} Alert(s)`;

    if (!data.alerts || data.alerts.length === 0) {
      container.innerHTML = `<div class="loading-state">No price drop alerts triggered yet for your target thresholds.</div>`;
      return;
    }

    container.innerHTML = data.alerts.map(a => {
      const dateStr = new Date(a.flight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const triggeredTime = new Date(a.triggered_at).toLocaleString();

      return `
        <div class="alert-item">
          <div class="alert-meta">
            <div class="alert-route-title">
              <i class="fa-solid fa-tag text-emerald"></i>
              ${a.origin_iata} ✈ ${a.dest_iata}
              <span class="carrier-tag">${a.airline_iata}</span>
              <span class="cabin-tag">${a.cabin_class}</span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-muted);">
              Flight Date: <strong>${dateStr}</strong> | Triggered at: <em>${triggeredTime}</em>
            </div>
            <div style="font-size:0.8rem; color:var(--text-dim); margin-top:0.2rem;">
              Target: $${parseFloat(a.target_price).toFixed(2)} → Alerting Fare: <strong style="color:#fff;">$${parseFloat(a.alerting_fare).toFixed(2)}</strong>
            </div>
          </div>

          <div class="savings-badge">
            <div style="font-size:0.7rem; text-transform:uppercase;">You Save</div>
            <div>+$${parseFloat(a.savings).toFixed(2)}</div>
          </div>
        </div>
      `;
    }).join('');

    updateAlertBadge();
  } catch (err) {
    container.innerHTML = `<div class="loading-state text-danger">${err.message}</div>`;
  }
}

async function updateAlertBadge() {
  if (!state.currentUser) return;
  try {
    const data = await apiFetch('/api/alerts/count');
    document.getElementById('navAlertBadge').textContent = data.count || 0;
  } catch (err) {
    // silent fail
  }
}

/* ==========================================================================
   Admin Console & Stored Procedures (#7, #10, #11)
   ========================================================================== */
function setupAdminEvents() {
  // Stored procedure form submission
  const ingestForm = document.getElementById('adminIngestForm');
  ingestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const noticeBox = document.getElementById('ingestResultNotice');
    noticeBox.style.display = 'none';

    const routeId = document.getElementById('ingestRoute').value;
    const airline = document.getElementById('ingestAirline').value;
    const cabin = document.getElementById('ingestCabin').value;
    const price = document.getElementById('ingestPrice').value;
    const flightDate = document.getElementById('ingestDate').value;
    const mongoDocId = document.getElementById('ingestMongoOid').value;

    try {
      const data = await apiFetch('/api/admin/ingest-snapshot', {
        method: 'POST',
        body: JSON.stringify({
          route_id: routeId,
          airline_iata: airline,
          cabin_class: cabin,
          price,
          flight_date: flightDate,
          mongo_doc_id: mongoDocId,
        }),
      });

      const alertCount = data.trigger_alerts_fired ? data.trigger_alerts_fired.length : 0;
      noticeBox.className = 'alert alert-success';
      noticeBox.innerHTML = `
        <strong><i class="fa-solid fa-circle-check"></i> ${data.message}</strong><br>
        Snapshot ID: <code>${data.snapshot_id}</code> |
        Trigger Alerts Fired: <strong>${alertCount}</strong>
      `;
      noticeBox.style.display = 'block';
      showToast(`Snapshot ${data.snapshot_id} recorded! Fired ${alertCount} alert(s)`, 'success');

      // Refresh admin telemetry
      loadAdminTelemetry();
    } catch (err) {
      noticeBox.className = 'alert alert-danger';
      noticeBox.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation"></i> Error:</strong> ${err.message}`;
      noticeBox.style.display = 'block';
    }
  });

  // Heatmap refresh button
  document.getElementById('btnAdminRefreshHeatmap').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/admin/refresh-heatmap', { method: 'POST' });
      showToast(res.message, 'success');
      loadHeatmap();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Run Mongo Aggregations
  document.getElementById('btnAdminRunMongoAggs').addEventListener('click', async () => {
    const resBox = document.getElementById('mongoAggResults');
    const jsonPre = document.getElementById('mongoAggJson');

    resBox.style.display = 'block';
    jsonPre.textContent = 'Running NoSQL aggregation pipelines across Amadeus payloads...';

    try {
      const data = await apiFetch('/api/admin/mongo/aggregations');
      jsonPre.textContent = JSON.stringify(data, null, 2);
      showToast('MongoDB Aggregation pipelines executed successfully', 'success');
    } catch (err) {
      jsonPre.textContent = `Error running aggregations: ${err.message}`;
    }
  });

  // Default flight date for ingestion (10 days ahead)
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 10);
  document.getElementById('ingestDate').value = futureDate.toISOString().split('T')[0];
}

async function loadAdminTelemetry() {
  try {
    const data = await apiFetch('/api/admin/stats');
    const pg = data.postgres;

    document.getElementById('statAirportsRoutes').textContent = `${pg.airports} / ${pg.routes}`;
    document.getElementById('statSnapshots').textContent = pg.fare_snapshots ? pg.fare_snapshots.toLocaleString() : '-';
    document.getElementById('statAlerts').textContent = pg.alerts ? pg.alerts.toLocaleString() : '-';
    document.getElementById('statMongoPayloads').textContent = data.mongo.raw_payloads ? data.mongo.raw_payloads.toLocaleString() : 'Connected';
  } catch (err) {
    console.error('Failed to load admin stats:', err);
  }
}
