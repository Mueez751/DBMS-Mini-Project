'use client';

import { useMemo, useRef, useState } from 'react';

// A small, dependency-free line chart. Colours are CSS variables (--series-1, --series-2),
// validated for colour-blind separation and contrast in light and dark mode.
// Hover or touch shows a crosshair + tooltip; a table view is offered under the chart.

const W = 720;
const H = 300;
const M = { top: 16, right: 100, bottom: 34, left: 54 };

function niceTicks(min, max, n = 5) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / (n - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

export default function LineChart({ points, series, formatValue, formatTick, formatX, label }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);

  const geo = useMemo(() => {
    if (!points.length) return null;
    const times = points.map((p) => Date.parse(`${p.x}T00:00:00Z`));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    const all = points.flatMap((p) => p.values).filter((v) => v != null);
    const ticks = niceTicks(Math.min(...all), Math.max(...all));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    const sx = (t) => M.left + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW);
    const sy = (v) => M.top + innerH - ((v - lo) / (hi - lo)) * innerH;
    const xs = times.map(sx);
    const xTickIdx = [...new Set([0, Math.round((points.length - 1) / 4), Math.round((points.length - 1) / 2), Math.round(((points.length - 1) * 3) / 4), points.length - 1])];
    return { xs, sy, ticks, innerW, xTickIdx };
  }, [points]);

  if (!geo) return null;
  const { xs, sy, ticks, xTickIdx } = geo;

  // direct labels at the line ends, nudged apart so they never overlap
  const ends = series
    .map((s, si) => {
      let last = -1;
      points.forEach((p, i) => {
        if (p.values[si] != null) last = i;
      });
      return last < 0 ? null : { si, name: s.name, x: xs[last], y: sy(points[last].values[si]) };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i;
    });
    setHover(best);
  }

  const hp = hover != null ? points[hover] : null;
  const tipLeft = hover != null ? (xs[hover] / W) * 100 : 0;

  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.name} className="legend-item">
            <i className="swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart-frame" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchMove={(e) => onMove(e.touches[0])} onTouchEnd={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="grid" />
              <text x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="central" className="axis-text">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={xs[i]} y={H - 10} textAnchor="middle" className="axis-text">
              {formatX(points[i].x)}
            </text>
          ))}
          {series.map((s, si) => {
            const d = points
              .map((p, i) => (p.values[si] == null ? null : `${i && points[i - 1].values[si] != null ? 'L' : 'M'}${xs[i].toFixed(1)},${sy(p.values[si]).toFixed(1)}`))
              .filter(Boolean)
              .join(' ');
            return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinecap="round" strokeLinejoin="round" />;
          })}
          {series.map((s, si) =>
            s.dots
              ? points.map((p, i) =>
                  p.values[si] == null ? null : <circle key={`${s.name}${i}`} cx={xs[i]} cy={sy(p.values[si])} r="4" fill={s.color} className="dot" />
                )
              : null
          )}
          {hover != null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={M.top} y2={H - M.bottom} className="crosshair" />
              {series.map((s, si) =>
                hp.values[si] == null ? null : <circle key={s.name} cx={xs[hover]} cy={sy(hp.values[si])} r="5" fill={s.color} className="dot" />
              )}
            </g>
          )}
          {ends.map((e) => (
            <text key={e.si} x={e.x + 10} y={e.y} dominantBaseline="central" className="end-label">
              {e.name}
            </text>
          ))}
        </svg>
        {hp && (
          <div className="chart-tip" style={{ left: `${tipLeft}%`, transform: tipLeft > 70 ? 'translateX(-105%)' : 'translateX(8%)' }} role="status">
            <strong>{formatX(hp.x)}</strong>
            {series.map((s, si) => (
              <span key={s.name}>
                <i className="swatch" style={{ background: s.color }} />
                {s.name}: {hp.values[si] == null ? '-' : formatValue(hp.values[si])}
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>View the numbers as a table</summary>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                {series.map((s) => (
                  <th key={s.name} className="num">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.x}>
                  <td>{formatX(p.x)}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="num">
                      {v == null ? '-' : formatValue(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
