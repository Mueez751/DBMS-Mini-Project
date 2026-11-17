'use client';

import Link from 'next/link';
import { Empty, ErrorBlock, Loading, Panel } from '@/components/ui';
import { useFetch } from '@/lib/client';
import { CABIN_LABEL, fmtDate, fmtStamp, money, routeLabel } from '@/lib/format';

export default function AlertsPage() {
  const { data, error } = useFetch('/api/alerts');

  return (
    <>
      <div className="page-head">
        <h1>Alerts</h1>
        <p className="lede">Each alert is a fare that reached the target price on one of your watchlists. The newest are first.</p>
      </div>

      <Panel id="alerts-title" title="Price alerts">
        <ErrorBlock error={error} />
        {data ? (
          data.rows.length ? (
            <div className="panel-body flush" style={{ margin: '-18px -20px' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Found</th>
                      <th>Route</th>
                      <th>Airline</th>
                      <th>Cabin</th>
                      <th>Flies on</th>
                      <th className="num">Fare</th>
                      <th className="num">Your target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((a) => (
                      <tr key={a.alert_id}>
                        <td className="muted">{fmtStamp(a.triggered_at)}</td>
                        <td className="code">{routeLabel(a.route)}</td>
                        <td>{a.airline}</td>
                        <td>{CABIN_LABEL[a.cabin_class]}</td>
                        <td>{fmtDate(a.flight_date)}</td>
                        <td className="num">
                          <strong>{money(a.fare)}</strong>
                        </td>
                        <td className="num">{money(a.target_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty title="No alerts yet">
              <span>
                Alerts appear when a newly checked fare reaches a target price. <Link href="/watchlists">Set a watchlist</Link> to get started.
              </span>
            </Empty>
          )
        ) : error ? null : (
          <Loading />
        )}
      </Panel>
    </>
  );
}
