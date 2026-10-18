// Small dependency-free SVG charts.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Multi-series line chart. series: [{ name, color, values: [number|null], dash? }], labels: [string]
export function lineChart({ series, labels, height = 220, yLabel = '', format = (v) => v.toFixed(1) }) {
  const W = 640; const H = height; const pad = { l: 38, r: 12, t: 12, b: 34 };
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (!all.length || labels.length < 2) return '<div class="empty small">Not enough matches to chart yet.</div>';
  const max = Math.max(...all) * 1.1 || 1; const min = Math.min(0, ...all);
  const x = (i) => pad.l + (i / (labels.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const ticks = 4;
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="${i ? '2 4' : ''}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`;
  }
  const every = Math.ceil(labels.length / 10);
  labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${esc(l)}</text>`; });
  for (const s of series) {
    let d = ''; let pen = false;
    s.values.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 5"' : ''}/>`;
    s.values.forEach((v, i) => { if (v !== null && v !== undefined && !s.dash) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${esc(labels[i])}: ${esc(format(v))}</title></circle>`; });
  }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)}">${g}</svg>
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div></div>`;
}

// Paired horizontal bars, e.g. Spurs vs opponent.
export function pairBars(rows, { left = 'Spurs', right = 'Opponent' } = {}) {
  const fmt = (v, dp) => (v === null || v === undefined ? '—' : Number(v).toFixed(dp ?? 0));
  return `<div class="pairs">${rows.map((r) => {
    const a = r.a ?? 0; const b = r.b ?? 0; const t = a + b || 1;
    return `<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:.88rem"><strong class="num" style="font-size:1.05rem">${fmt(r.a, r.dp)}${r.unit || ''}</strong><span class="muted">${esc(r.label)}</span><strong class="num" style="font-size:1.05rem">${fmt(r.b, r.dp)}${r.unit || ''}</strong></div>
      <div style="display:flex;gap:3px;height:7px;margin-top:4px"><div style="flex:${a / t};background:var(--cyan);border-radius:4px"></div><div style="flex:${b / t};background:var(--faint);border-radius:4px"></div></div></div>`;
  }).join('')}<div class="legend"><span><i style="background:var(--cyan)"></i>${esc(left)}</span><span><i style="background:var(--faint)"></i>${esc(right)}</span></div></div>`;
}

// Half-pitch shot map. Source coordinates: x = metres from goal line, y = 0–100 across.
export function shotMap(shots, { title = 'Shot map' } = {}) {
  if (!shots.length) return '<div class="empty small">No shot locations recorded.</div>';
  const W = 340; const L = 52.5; const scale = W / 68; const H = L * scale;
  const px = (s) => (s.y / 100) * W; const py = (s) => s.x * scale;
  const box = `<rect x="${(13.84 / 68) * W}" y="0" width="${(40.32 / 68) * W}" height="${16.5 * scale}" fill="none" stroke="var(--line)"/>
    <rect x="${(24.84 / 68) * W}" y="0" width="${(18.32 / 68) * W}" height="${5.5 * scale}" fill="none" stroke="var(--line)"/>
    <circle cx="${W / 2}" cy="${11 * scale}" r="1.6" fill="var(--line)"/>
    <path d="M ${W / 2 - 9.15 * scale * 0.8} ${16.5 * scale} A ${9.15 * scale} ${9.15 * scale} 0 0 0 ${W / 2 + 9.15 * scale * 0.8} ${16.5 * scale}" fill="none" stroke="var(--line)"/>
    <rect x="${(30.34 / 68) * W}" y="-4" width="${(7.32 / 68) * W}" height="4" fill="var(--muted)"/>`;
  const dots = shots.filter((s) => s.x !== null && s.y !== null).map((s) => {
    const r = 3 + Math.sqrt(s.xg || 0.01) * 14;
    const goal = s.outcome === 'goal';
    return `<circle cx="${px(s).toFixed(1)}" cy="${py(s).toFixed(1)}" r="${r.toFixed(1)}" fill="${goal ? 'var(--cyan)' : 'transparent'}" stroke="${goal ? 'var(--cyan)' : 'var(--muted)'}" stroke-width="1.4" fill-opacity="${goal ? 0.85 : 0}">
      <title>${esc(s.player || 'Unknown')} ${s.minute ?? ''}' — ${esc(s.outcome)} (${esc(s.situation)}), xG ${s.xg ?? '—'}</title></circle>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 -6 ${W} ${H + 8}" role="img" aria-label="${esc(title)}"><rect x="0" y="0" width="${W}" height="${H}" fill="var(--bg-2)" rx="6"/>${box}${dots}</svg>
    <div class="legend"><span><i style="background:var(--cyan);height:10px;width:10px;border-radius:50%"></i>Goal</span><span><i style="border:1.4px solid var(--muted);height:10px;width:10px;border-radius:50%;background:none"></i>No goal</span><span>Circle size = xG</span></div></div>`;
}

export function barList(items, { max = null, format = (v) => v } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value || 0), 0.0001);
  return items.map((i) => `<div class="pbar"><span>${i.href ? `<a href="${i.href}">${esc(i.label)}</a>` : esc(i.label)}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, ((i.value || 0) / m) * 100))}%"></div></div><span class="num r" style="text-align:right">${esc(format(i.value))}</span></div>`).join('');
}
