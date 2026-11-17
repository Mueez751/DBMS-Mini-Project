'use client';

import { useState } from 'react';
import { Empty, ErrorBlock, Field, Loading, Notice, Panel } from '@/components/ui';
import { api, useFetch } from '@/lib/client';
import { CABIN_LABEL, CABIN_OPTIONS, money, routeLabel } from '@/lib/format';

function WatchRow({ row, onChanged }) {
  const [price, setPrice] = useState(String(row.target_price));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = Number(price) !== row.target_price;
  const atTarget = row.current_best != null && row.current_best <= row.target_price;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/watchlists/${row.watchlist_id}`, { method: 'PATCH', body: { target_price: price } });
      onChanged();
    } catch (err) {
      setError(err.fields?.target_price || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/watchlists/${row.watchlist_id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="code">{routeLabel(`${row.origin_iata} > ${row.dest_iata}`)}</td>
      <td>{CABIN_LABEL[row.cabin_class]}</td>
      <td>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
          <input
            aria-label={`Target price for ${row.origin_iata} to ${row.dest_iata}, ${CABIN_LABEL[row.cabin_class]}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: 110 }}
            aria-invalid={Boolean(error)}
          />
          {changed ? (
            <button type="button" className="btn btn-sm" onClick={save} disabled={busy}>
              Save
            </button>
          ) : null}
        </div>
        {error ? <span className="error-text">{error}</span> : null}
      </td>
      <td className="num">{row.current_best != null ? money(row.current_best) : '-'}</td>
      <td>{row.current_best == null ? <span className="tag">No fares yet</span> : atTarget ? <span className="tag tag-ok">At or below target</span> : <span className="tag">Waiting</span>}</td>
      <td className="num">{row.alert_count}</td>
      <td className="num">
        {confirming ? (
          <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy}>
              Delete watchlist
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

export default function WatchlistsPage() {
  const meta = useFetch('/api/meta');
  const list = useFetch('/api/watchlists');
  const [routeId, setRouteId] = useState('');
  const [cabin, setCabin] = useState('economy');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api('/api/watchlists', { method: 'POST', body: { route_id: routeId || meta.data?.routes[0]?.route_id, cabin_class: cabin, target_price: target } });
      setTarget('');
      setDone('Watchlist added. You will get an alert when a newly checked fare reaches your target.');
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fields = error?.fields || {};
  return (
    <>
      <div className="page-head">
        <h1>Watchlists</h1>
        <p className="lede">Set a target price for a route and cabin. Whenever a newly checked fare is at or below it, an alert appears on the Alerts page.</p>
      </div>

      <div className="grid-2">
        <Panel id="add-title" title="Add a watchlist">
          <form className="stack" onSubmit={add} noValidate>
            {error && !Object.keys(fields).length ? <Notice>{error.message}</Notice> : null}
            {done ? <Notice kind="ok">{done}</Notice> : null}
            <Field label="Route" htmlFor="w-route" error={fields.route_id}>
              <select id="w-route" value={routeId || meta.data?.routes[0]?.route_id || ''} onChange={(e) => setRouteId(e.target.value)} disabled={!meta.data}>
                {(meta.data?.routes || []).map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {r.origin_iata} to {r.dest_iata} ({r.origin_city} to {r.dest_city})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cabin class" htmlFor="w-cabin" error={fields.cabin_class}>
              <select id="w-cabin" value={cabin} onChange={(e) => setCabin(e.target.value)}>
                {CABIN_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Alert me at or below (USD)" htmlFor="w-target" error={fields.target_price} hint="For example 175 or 175.50">
              <input id="w-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={Boolean(fields.target_price)} />
            </Field>
            <div>
              <button className="btn" type="submit" disabled={busy || !meta.data}>
                {busy ? 'Adding...' : 'Add watchlist'}
              </button>
            </div>
          </form>
        </Panel>

        <Panel id="mine-title" title="Your watchlists">
          <ErrorBlock error={list.error} />
          {list.data ? (
            list.data.rows.length ? (
              <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th>Cabin</th>
                        <th>Target (USD)</th>
                        <th className="num">Best now</th>
                        <th>Status</th>
                        <th className="num">Alerts</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.rows.map((r) => (
                        <WatchRow key={`${r.watchlist_id}-${r.target_price}`} row={r} onChanged={list.reload} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Empty title="No watchlists yet">Add a route and a target price on the left to start getting alerts.</Empty>
            )
          ) : list.error ? null : (
            <Loading />
          )}
        </Panel>
      </div>
    </>
  );
}
