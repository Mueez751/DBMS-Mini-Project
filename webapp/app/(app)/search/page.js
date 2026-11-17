'use client';

import { useEffect, useMemo, useState } from 'react';
import LineChart from '@/components/LineChart';
import { Empty, ErrorBlock, Field, Loading, Panel, Segmented } from '@/components/ui';
import { qs, useDebounced, useFetch } from '@/lib/client';
import { CABIN_LABEL, CABIN_OPTIONS, count, fmtDate, fmtShortDate, fmtStamp, money, money0 } from '@/lib/format';

const SORTS = [
  { value: 'price_asc', label: 'Lowest price first' },
  { value: 'price_desc', label: 'Highest price first' },
  { value: 'date_asc', label: 'Earliest flight first' },
  { value: 'scraped_desc', label: 'Recently checked first' },
];
const PAGE_SIZE = 10;

export default function SearchPage() {
  const meta = useFetch('/api/meta');
  const [routeId, setRouteId] = useState('');
  const [cabin, setCabin] = useState('economy');
  const [airline, setAirline] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('price_asc');
  const [page, setPage] = useState(1);
  const [trendDays, setTrendDays] = useState(30);
  const [finder, setFinder] = useState('');

  const maxPriceD = useDebounced(maxPrice, 400);
  const finderD = useDebounced(finder.trim(), 300);

  // Pick the route from ?route= (the dashboard links here), otherwise the first route.
  useEffect(() => {
    if (!meta.data || routeId) return;
    const wanted = new URLSearchParams(window.location.search).get('route');
    const found = meta.data.routes.find((r) => String(r.route_id) === wanted);
    setRouteId(String((found || meta.data.routes[0])?.route_id ?? ''));
  }, [meta.data, routeId]);

  // Any filter change goes back to page 1.
  const filter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const route = meta.data?.routes.find((r) => String(r.route_id) === routeId);

  const faresUrl = routeId
    ? `/api/fares?${qs({ route_id: routeId, cabin, airline, max_price: maxPriceD, from, to, sort, page, page_size: PAGE_SIZE })}`
    : null;
  const cheapestUrl = routeId ? `/api/cheapest?${qs({ route_id: routeId, cabin, days: 45, limit: 8 })}` : null;
  const trendUrl = routeId ? `/api/trend?${qs({ route_id: routeId, cabin, days: trendDays })}` : null;
  const finderUrl = finderD.length >= 2 ? `/api/airports?${qs({ q: finderD })}` : null;

  const fares = useFetch(faresUrl);
  const cheapest = useFetch(cheapestUrl);
  const trend = useFetch(trendUrl);
  const found = useFetch(finderUrl);

  const points = useMemo(
    () => (trend.data?.rows || []).map((r) => ({ x: r.obs_date, values: [r.avg_price, r.moving_avg_7d] })),
    [trend.data]
  );
  const maxCheap = Math.max(1, ...(cheapest.data?.rows || []).map((r) => r.min_price));
  const total = fares.data?.total ?? 0;
  const firstShown = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(page * PAGE_SIZE, total);
  const fieldErrors = fares.error?.fields || {};

  return (
    <>
      <div className="page-head">
        <h1>Search fares</h1>
        <p className="lede">Pick a route to see the cheapest days to fly, how its price has moved, and every current fare.</p>
      </div>

      <Panel id="filters-title" title="Route and filters">
        <div className="stack">
          <div className="row row-start">
            <Field label="Route" htmlFor="route" error={null} hint="Choose from the tracked routes">
              <select id="route" value={routeId} onChange={(e) => filter(setRouteId)(e.target.value)} disabled={!meta.data}>
                {(meta.data?.routes || []).map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {r.origin_iata} to {r.dest_iata} ({r.origin_city} to {r.dest_city})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Find a route by city or airport" htmlFor="finder" hint="Try Dubai, London or DEL">
              <input id="finder" type="search" value={finder} onChange={(e) => setFinder(e.target.value)} placeholder="City or airport code" maxLength={40} />
            </Field>
          </div>

          {finderUrl ? (
            found.data?.routes?.length ? (
              <div className="chips" aria-label="Matching routes">
                {found.data.routes.map((r) => (
                  <button
                    key={r.route_id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      filter(setRouteId)(String(r.route_id));
                      setFinder('');
                    }}
                  >
                    <span className="code">
                      {r.origin_iata} &rarr; {r.dest_iata}
                    </span>{' '}
                    {r.origin_city} to {r.dest_city}
                  </button>
                ))}
              </div>
            ) : found.data ? (
              <p className="muted small">No route matches &quot;{finderD}&quot;.</p>
            ) : null
          ) : null}

          <div className="row">
            <div className="field">
              <label>Cabin class</label>
              <Segmented label="Cabin class" value={cabin} onChange={filter(setCabin)} options={CABIN_OPTIONS} />
            </div>
            <Field label="Airline" htmlFor="airline">
              <select id="airline" value={airline} onChange={(e) => filter(setAirline)(e.target.value)}>
                <option value="">Any airline</option>
                {(meta.data?.airlines || []).map((a) => (
                  <option key={a.iata_code} value={a.iata_code}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Highest price (USD)" htmlFor="max" error={fieldErrors.max_price}>
              <input id="max" inputMode="decimal" value={maxPrice} onChange={(e) => filter(setMaxPrice)(e.target.value)} placeholder="No limit" aria-invalid={Boolean(fieldErrors.max_price)} />
            </Field>
            <Field label="Flying from" htmlFor="from" error={fieldErrors.from}>
              <input id="from" type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
            </Field>
            <Field label="Flying until" htmlFor="to" error={fieldErrors.to}>
              <input id="to" type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
            </Field>
          </div>
        </div>
      </Panel>

      <ErrorBlock error={meta.error} />

      {route ? (
        <div className="route-title">
          <span className="big">
            {route.origin_iata} &rarr; {route.dest_iata}
          </span>
          <span className="muted">
            {route.origin_city} to {route.dest_city}, {CABIN_LABEL[cabin].toLowerCase()}
          </span>
        </div>
      ) : null}

      <div className="grid-2">
        <Panel id="cheap-title" title="Cheapest days to fly">
          {cheapest.error ? <ErrorBlock error={cheapest.error} /> : null}
          {cheapest.data ? (
            cheapest.data.rows.length ? (
              <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Airline</th>
                        <th className="num">Lowest</th>
                        <th aria-label="Compared with the highest of these days" />
                      </tr>
                    </thead>
                    <tbody>
                      {cheapest.data.rows.map((r) => (
                        <tr key={r.flight_date}>
                          <td>{fmtDate(r.flight_date)}</td>
                          <td>{r.cheapest_airline}</td>
                          <td className="num">{money(r.min_price)}</td>
                          <td className="bar-cell">
                            <div className="bar" style={{ width: `${(r.min_price / maxCheap) * 100}%` }} title={`Average that day: ${money(r.avg_price)}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Empty title="No upcoming fares">Nothing recorded for this route and cabin in the next 45 days.</Empty>
            )
          ) : (
            <Loading />
          )}
        </Panel>

        <Panel
          id="trend-title"
          title="How the price has moved"
          actions={
            <Segmented
              label="Period"
              value={trendDays}
              onChange={setTrendDays}
              options={[
                { value: 7, label: '7 days' },
                { value: 14, label: '14 days' },
                { value: 30, label: '30 days' },
              ]}
            />
          }
        >
          {trend.error ? <ErrorBlock error={trend.error} /> : null}
          {trend.data ? (
            points.length > 1 ? (
              <LineChart
                points={points}
                series={[
                  { name: 'Daily average', color: 'var(--series-1)', width: 1.75, dots: true },
                  { name: '7-day average', color: 'var(--series-2)', width: 3 },
                ]}
                formatValue={money}
                formatTick={money0}
                formatX={fmtShortDate}
                label={`Average ${CABIN_LABEL[cabin].toLowerCase()} fare per day over the last ${trendDays} days, with a 7-day moving average`}
              />
            ) : (
              <Empty title="Not enough history yet">At least two days of price checks are needed to draw a trend.</Empty>
            )
          ) : (
            <Loading />
          )}
        </Panel>
      </div>

      <Panel
        id="fares-title"
        title="Fares on sale now"
        actions={
          <select aria-label="Sort fares" value={sort} onChange={(e) => filter(setSort)(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        }
      >
        {fares.error && !Object.keys(fieldErrors).length ? <ErrorBlock error={fares.error} /> : null}
        {fares.data ? (
          fares.data.rows.length ? (
            <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Flies on</th>
                      <th>Airline</th>
                      <th>Cabin</th>
                      <th className="num">Fare</th>
                      <th>Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fares.data.rows.map((r) => (
                      <tr key={r.snapshot_id}>
                        <td>{fmtDate(r.flight_date)}</td>
                        <td>{r.airline}</td>
                        <td>{CABIN_LABEL[r.cabin_class]}</td>
                        <td className="num">{money(r.price)}</td>
                        <td className="muted">{fmtStamp(r.scraped_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <span className="muted small">
                  Showing {count(firstShown)} to {count(lastShown)} of {count(total)} fares
                </span>
                <span className="row">
                  <button type="button" className="btn btn-quiet btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" disabled={lastShown >= total} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <Empty title="No fares match these filters">Widen the price limit or date range, or choose another airline.</Empty>
          )
        ) : fares.error ? null : (
          <Loading />
        )}
      </Panel>
    </>
  );
}
