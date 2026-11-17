'use client';

import Link from 'next/link';
import { useState } from 'react';
import Heatmap from '@/components/Heatmap';
import { ErrorBlock, Loading, Panel, Segmented } from '@/components/ui';
import { useFetch } from '@/lib/client';
import { CABIN_OPTIONS, count, fmtDay, fmtShortDate, fmtTime, money, money0, routeLabel } from '@/lib/format';

export default function DashboardPage() {
  const { data, error, loading } = useFetch('/api/dashboard');
  const [cabin, setCabin] = useState('economy');
  const heat = useFetch(`/api/heatmap?cabin=${cabin}`);

  return (
    <>
      <div className="page-head">
        <h1>Fares right now</h1>
        <p className="lede">The cheapest upcoming economy fare on each route, compared with that route&apos;s average. Select a row to see its price history.</p>
      </div>

      <ErrorBlock error={error} />
      {loading && !data ? <Loading label="Loading fares" /> : null}

      {data ? (
        <>
          <div className="board" role="table" aria-label="Cheapest economy fare per route">
            <div className="board-head" role="row">
              <span role="columnheader">Route</span>
              <span role="columnheader" className="hide-sm">Airline</span>
              <span role="columnheader" className="hide-sm">Flies on</span>
              <span role="columnheader" className="num">Fare</span>
              <span role="columnheader" className="num hide-sm">Against average</span>
            </div>
            {data.board.length === 0 ? <p className="board-empty">No upcoming fares yet. An admin can record one from the Admin page.</p> : null}
            {data.board.map((r, i) => (
              <Link key={r.route_id} href={`/search?route=${r.route_id}`} className="board-row" role="row" style={{ '--i': i }}>
                <span role="cell" className="board-route">
                  {r.origin_iata} &rarr; {r.dest_iata}
                  <span className="board-city">{r.dest_city}</span>
                </span>
                <span role="cell" className="hide-sm">{r.airline}</span>
                <span role="cell" className="hide-sm">{fmtShortDate(r.flight_date)}</span>
                <span role="cell" className="board-price">{money0(r.price)}</span>
                <span role="cell" className="board-delta hide-sm">
                  <b>{Math.abs(r.pct_below_avg)}%</b> {r.pct_below_avg >= 0 ? 'below' : 'above'} average
                </span>
              </Link>
            ))}
          </div>

          <div className="facts">
            <div className="fact">
              <span className="fact-n">{count(data.kpi.routes)}</span>
              <span className="fact-l">routes tracked</span>
            </div>
            <div className="fact">
              <span className="fact-n">{count(data.kpi.observations)}</span>
              <span className="fact-l">fare observations</span>
            </div>
            <div className="fact">
              <span className="fact-n">{count(data.kpi.airlines)}</span>
              <span className="fact-l">airlines</span>
            </div>
            <div className="fact">
              <span className="fact-n">{fmtDay(data.kpi.last_scrape)}</span>
              <span className="fact-l">last price check, {fmtTime(data.kpi.last_scrape)}</span>
            </div>
            <div className="fact">
              <Link href="/watchlists">
                <span className="fact-n">{count(data.kpi.my_watchlists)}</span>
                <span className="fact-l">of your watchlists</span>
              </Link>
            </div>
            <div className="fact">
              <Link href="/alerts">
                <span className="fact-n">{count(data.kpi.my_alerts)}</span>
                <span className="fact-l">alerts for you</span>
              </Link>
            </div>
          </div>

          <Panel id="heat-title" title="Which month is cheapest?" actions={<Segmented label="Cabin class" value={cabin} onChange={setCabin} options={CABIN_OPTIONS} />}>
            {heat.error ? <ErrorBlock error={heat.error} /> : null}
            {heat.data ? (
              heat.data.rows.length ? (
                <Heatmap rows={heat.data.rows} />
              ) : (
                <p className="muted">No fares recorded for this cabin yet.</p>
              )
            ) : (
              <Loading label="Loading monthly prices" />
            )}
          </Panel>

          <Panel id="routes-title" title="Every route at a glance">
            <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>Cities</th>
                      <th className="num">Observations</th>
                      <th className="num">Average</th>
                      <th className="num">Lowest</th>
                      <th className="num">Highest</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview.map((r) => (
                      <tr key={r.route_id}>
                        <td className="code">{routeLabel(r.route)}</td>
                        <td>
                          {r.origin_city} to {r.dest_city}
                        </td>
                        <td className="num">{count(r.observations)}</td>
                        <td className="num">{money(r.avg_price)}</td>
                        <td className="num">{money(r.min_price)}</td>
                        <td className="num">{money(r.max_price)}</td>
                        <td className="num">
                          <Link href={`/search?route=${r.route_id}`}>Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </>
      ) : null}
    </>
  );
}
