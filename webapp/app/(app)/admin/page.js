'use client';

import { useState } from 'react';
import { Empty, ErrorBlock, Field, Loading, Notice, Panel } from '@/components/ui';
import { api, useFetch } from '@/lib/client';
import { CABIN_OPTIONS, count, fmtDay, fmtStamp, fmtTime, money, routeLabel } from '@/lib/format';

const today = () => new Date().toISOString().slice(0, 10);

function RecordFare({ meta, onDone }) {
  const [f, setF] = useState({ route_id: '', airline_iata: '', cabin_class: 'economy', price: '', flight_date: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const fields = error?.fields || {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = { ...f, route_id: f.route_id || meta.routes[0]?.route_id, airline_iata: f.airline_iata || meta.airlines[0]?.iata_code };
      setResult(await api('/api/admin/fares', { method: 'POST', body }));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && !Object.keys(fields).length ? <Notice>{error.message}</Notice> : null}
      {result ? (
        <Notice kind="ok">
          Recorded fare #{result.snapshot_id}. The raw payload is in MongoDB as {result.mongo_doc_id}.{' '}
          {result.alerts_triggered ? `${result.alerts_triggered} price alert${result.alerts_triggered === 1 ? '' : 's'} sent to watchers.` : 'No watchlist target was reached.'}
        </Notice>
      ) : null}
      <div className="row">
        <Field label="Route" htmlFor="f-route" error={fields.route_id}>
          <select id="f-route" value={f.route_id || meta.routes[0]?.route_id || ''} onChange={set('route_id')}>
            {meta.routes.map((r) => (
              <option key={r.route_id} value={r.route_id}>
                {r.origin_iata} to {r.dest_iata}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Airline" htmlFor="f-airline" error={fields.airline_iata}>
          <select id="f-airline" value={f.airline_iata || meta.airlines[0]?.iata_code || ''} onChange={set('airline_iata')}>
            {meta.airlines.map((a) => (
              <option key={a.iata_code} value={a.iata_code}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cabin class" htmlFor="f-cabin" error={fields.cabin_class}>
          <select id="f-cabin" value={f.cabin_class} onChange={set('cabin_class')}>
            {CABIN_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Fare (USD)" htmlFor="f-price" error={fields.price}>
          <input id="f-price" inputMode="decimal" value={f.price} onChange={set('price')} aria-invalid={Boolean(fields.price)} />
        </Field>
        <Field label="Flight date" htmlFor="f-date" error={fields.flight_date}>
          <input id="f-date" type="date" min={today()} value={f.flight_date} onChange={set('flight_date')} aria-invalid={Boolean(fields.flight_date)} />
        </Field>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Recording...' : 'Record fare'}
        </button>
      </div>
    </form>
  );
}

function AddRoute({ meta, onDone }) {
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const fields = error?.fields || {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api('/api/admin/routes', {
        method: 'POST',
        body: { origin_iata: origin || meta.airports[0]?.iata_code, dest_iata: dest || meta.airports[1]?.iata_code },
      });
      setDone(`Added route ${r.origin_iata} to ${r.dest_iata}.`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const options = meta.airports.map((a) => (
    <option key={a.iata_code} value={a.iata_code}>
      {a.iata_code} ({a.city})
    </option>
  ));
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && !Object.keys(fields).length ? <Notice>{error.message}</Notice> : null}
      {done ? <Notice kind="ok">{done}</Notice> : null}
      <div className="row">
        <Field label="From" htmlFor="r-origin" error={fields.origin_iata}>
          <select id="r-origin" value={origin || meta.airports[0]?.iata_code || ''} onChange={(e) => setOrigin(e.target.value)}>
            {options}
          </select>
        </Field>
        <Field label="To" htmlFor="r-dest" error={fields.dest_iata}>
          <select id="r-dest" value={dest || meta.airports[1]?.iata_code || ''} onChange={(e) => setDest(e.target.value)}>
            {options}
          </select>
        </Field>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Adding...' : 'Add route'}
        </button>
      </div>
    </form>
  );
}

function RawPayload() {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [doc, setDoc] = useState(null);

  async function lookup(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDoc(null);
    try {
      setDoc(await api(`/api/admin/raw/${encodeURIComponent(id.trim())}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={lookup} noValidate>
        <Field label="Fare number" htmlFor="raw-id" hint="The number shown when a fare is recorded">
          <input id="raw-id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <button className="btn" type="submit" disabled={busy || !id.trim()}>
          {busy ? 'Looking up...' : 'Show raw payload'}
        </button>
      </form>
      {error ? <Notice>{error.message}</Notice> : null}
      {doc ? (
        <>
          <p className="muted small">
            Fare #{doc.snapshot_id} ({doc.fare.airline_iata}, {doc.fare.cabin_class}, {money(doc.fare.price)}) points to MongoDB document {doc.fare.mongo_doc_id}.
          </p>
          <pre className="json">{JSON.stringify(doc.payload, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}

function MongoInsights() {
  const { data, error, loading } = useFetch('/api/admin/insights');
  return (
    <div className="stack">
      <p className="muted small">
        Computed live by MongoDB aggregation pipelines ($unwind, $group, $convert, $match) over the raw Amadeus documents.
      </p>
      <ErrorBlock error={error} />
      {loading && !data ? <Loading label="Running aggregations" /> : null}
      {data ? (
        <div className="grid-2">
          <div className="table-wrap">
            <table className="data">
              <caption className="muted small" style={{ textAlign: 'left', padding: '0 0 6px' }}>
                Average offered price per carrier
              </caption>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Carrier</th>
                  <th className="num">Offers</th>
                  <th className="num">Average</th>
                </tr>
              </thead>
              <tbody>
                {data.carrierAvg.map((r) => (
                  <tr key={`${r.route}-${r.carrier}`}>
                    <td className="code">{routeLabel(r.route)}</td>
                    <td>{r.carrier}</td>
                    <td className="num">{count(r.offers)}</td>
                    <td className="num">{money(r.avgTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack">
            <div className="table-wrap">
              <table className="data">
                <caption className="muted small" style={{ textAlign: 'left', padding: '0 0 6px' }}>
                  Nonstop vs connecting offers
                </caption>
                <thead>
                  <tr>
                    <th>Stops</th>
                    <th className="num">Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stops.map((r) => (
                    <tr key={r.stops}>
                      <td>{r.stops === 0 ? 'Nonstop' : `${r.stops} stop${r.stops === 1 ? '' : 's'}`}</td>
                      <td className="num">{count(r.offers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption className="muted small" style={{ textAlign: 'left', padding: '0 0 6px' }}>
                  Offers with 3 or fewer seats left
                </caption>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th className="num">Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowSeats.length ? (
                    data.lowSeats.map((r) => (
                      <tr key={r.route}>
                        <td className="code">{routeLabel(r.route)}</td>
                        <td className="num">{count(r.lowSeatOffers)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="muted">
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminPage() {
  const meta = useFetch('/api/meta');
  const stats = useFetch('/api/admin/stats');
  const users = useFetch('/api/admin/users');
  const [refresh, setRefresh] = useState({ busy: false, msg: null, error: null });

  async function refreshHeatmap() {
    setRefresh({ busy: true, msg: null, error: null });
    try {
      await api('/api/admin/refresh', { method: 'POST' });
      setRefresh({ busy: false, msg: 'Monthly prices refreshed.', error: null });
      stats.reload();
    } catch (err) {
      setRefresh({ busy: false, msg: null, error: err.message });
    }
  }

  const s = stats.data?.stats;
  const mongo = stats.data?.mongo;

  return (
    <>
      <div className="page-head">
        <h1>Admin</h1>
        <p className="lede">Record fares, add routes, refresh the monthly price table and review accounts. Only admins can see this page.</p>
      </div>

      <ErrorBlock error={stats.error || meta.error} />

      {s ? (
        <div className="facts">
          <div className="fact">
            <span className="fact-n">{count(s.customers)}</span>
            <span className="fact-l">customers ({count(s.admins)} admin{s.admins === 1 ? '' : 's'})</span>
          </div>
          <div className="fact">
            <span className="fact-n">{count(s.snapshots)}</span>
            <span className="fact-l">fares in PostgreSQL</span>
          </div>
          <div className="fact">
            <span className="fact-n">{count(s.alerts)}</span>
            <span className="fact-l">alerts sent</span>
          </div>
          <div className="fact">
            <span className="fact-n">{mongo?.ok ? count(mongo.documents) : 'Offline'}</span>
            <span className="fact-l">{mongo?.ok ? 'raw payloads in MongoDB' : 'MongoDB is not reachable'}</span>
          </div>
          <div className="fact">
            <span className="fact-n">{fmtDay(s.last_scrape)}</span>
            <span className="fact-l">last price check, {fmtTime(s.last_scrape)}</span>
          </div>
        </div>
      ) : stats.error ? null : (
        <Loading />
      )}

      {meta.data ? (
        <div className="grid-2">
          <Panel id="fare-title" title="Record a fare">
            <p className="muted small" style={{ marginBottom: 14 }}>
              Saves the raw offer to MongoDB, then the fare to PostgreSQL. Matching watchlists are alerted automatically.
            </p>
            <RecordFare meta={meta.data} onDone={stats.reload} />
          </Panel>
          <div className="stack">
            <Panel id="route-title" title="Add a route">
              <AddRoute meta={meta.data} onDone={meta.reload} />
            </Panel>
            <Panel id="heat-title" title="Monthly price table">
              <div className="stack">
                <p className="muted small">The dashboard heatmap reads a stored summary. Refresh it after recording many fares.</p>
                {refresh.msg ? <Notice kind="ok">{refresh.msg}</Notice> : null}
                {refresh.error ? <Notice>{refresh.error}</Notice> : null}
                <div>
                  <button type="button" className="btn btn-quiet" onClick={refreshHeatmap} disabled={refresh.busy}>
                    {refresh.busy ? 'Refreshing...' : 'Refresh monthly prices'}
                  </button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      <Panel id="mongo-title" title="Raw payload analytics (MongoDB aggregation)">
        <MongoInsights />
      </Panel>

      <Panel id="raw-title" title="Inspect a raw payload">
        <RawPayload />
      </Panel>

      <Panel id="users-title" title="Accounts">
        <ErrorBlock error={users.error} />
        {users.data ? (
          users.data.rows.length ? (
            <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.data.rows.map((u) => (
                      <tr key={u.user_id}>
                        <td>{u.email}</td>
                        <td>
                          <span className="tag">{u.role}</span>
                        </td>
                        <td className="muted">{fmtStamp(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty title="No accounts" />
          )
        ) : users.error ? null : (
          <Loading />
        )}
      </Panel>
    </>
  );
}
