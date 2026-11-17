'use client';

import { useMemo } from 'react';
import { fmtMonth, money, money0, routeLabel } from '@/lib/format';

// One-hue sequential ramp (blue 100 -> 650), light = cheaper, dark = dearer.
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
const WHITE_TEXT_FROM = 7; // white text on #2a78d6 and darker (>= 4.5:1), near-black on the lighter steps

export default function Heatmap({ rows }) {
  const model = useMemo(() => {
    const months = [...new Set(rows.map((r) => r.month))].sort();
    const routes = [...new Set(rows.map((r) => r.route))];
    const byKey = new Map(rows.map((r) => [`${r.route}|${r.month}`, r]));
    const scale = new Map(
      routes.map((route) => {
        const vals = rows.filter((r) => r.route === route).map((r) => r.avg_price);
        return [route, { min: Math.min(...vals), max: Math.max(...vals) }];
      })
    );
    return { months, routes, byKey, scale };
  }, [rows]);

  return (
    <div>
      <div className="table-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th scope="col">Route</th>
              {model.months.map((m) => (
                <th key={m} scope="col" className="num">
                  {fmtMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.routes.map((route) => {
              const { min, max } = model.scale.get(route);
              return (
                <tr key={route}>
                  <th scope="row">{routeLabel(route)}</th>
                  {model.months.map((m) => {
                    const cell = model.byKey.get(`${route}|${m}`);
                    if (!cell) return <td key={m} className="heat-empty">-</td>;
                    const t = max === min ? 0.5 : (cell.avg_price - min) / (max - min);
                    const idx = Math.round(t * (RAMP.length - 1));
                    return (
                      <td
                        key={m}
                        style={{ background: RAMP[idx], color: idx >= WHITE_TEXT_FROM ? '#ffffff' : '#0b0b0b' }}
                        title={`${routeLabel(route)}, ${fmtMonth(m)}: average ${money(cell.avg_price)} (lowest ${money(cell.min_price)}, highest ${money(cell.max_price)}, ${cell.observations} observations)`}
                      >
                        {money0(cell.avg_price)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Cheaper month</span>
        <span className="heat-ramp">
          {RAMP.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
        <span>Dearer month</span>
        <span className="muted">Shading compares months within each route, not across routes.</span>
      </div>
    </div>
  );
}
