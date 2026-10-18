// Small dependency-free SVG charts.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Multi-series line chart with smooth curves, a soft area under the first series,
// glowing lines and a headline readout of the latest values.
// `points` (optional): one entry per x position describing the match there —
// { title, sub, result, score, links: [[label, href]] }. With it, the chart becomes
// interactive: tap/hover a game to see every series' value for that game, step with
// the arrows, and expand to full screen.
export function lineChart({ series, labels, height = 230, yLabel = '', format = (v) => v.toFixed(1), readout = true, points = null, title = '' }) {
  const W = 640; const H = height; const pad = { l: 40, r: 16, t: 14, b: 34 };
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (!all.length || labels.length < 2) return '<div class="empty small">Not enough matches to chart yet.</div>';
  const max = Math.max(...all) * 1.12 || 1; const min = Math.min(0, ...all);
  const x = (i) => pad.l + (i / (labels.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const uid = Math.random().toString(36).slice(2, 8);
  let g = `<defs><filter id="gl${uid}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="ar${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${series[0].color}" stop-opacity="0.28"/><stop offset="1" stop-color="${series[0].color}" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 5" stroke-opacity="${i ? 0.8 : 1}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`;
  }
  const every = Math.ceil(labels.length / 8);
  labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${esc(l)}</text>`; });
  const smooth = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]; const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) return;
    const d = smooth(pts);
    if (si === 0 && !s.dash && pts.length > 1) g += `<path d="${d}L${pts[pts.length - 1][0]},${y(min)}L${pts[0][0]},${y(min)}Z" fill="url(#ar${uid})"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 6" opacity="0.8"' : `filter="url(#gl${uid})"`}/>`;
    s.values.forEach((v, i) => { if (v !== null && v !== undefined) g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === s.values.length - 1 ? 5 : 2.4}" fill="${s.color}" ${i === s.values.length - 1 ? `stroke="var(--bg)" stroke-width="2"` : 'opacity="0.7"'}><title>${esc(labels[i])}: ${esc(format(v))}</title></circle>`; });
  });
  const last = (s) => [...s.values].reverse().find((v) => v !== null && v !== undefined);
  const head = readout ? `<div class="readout">${series.filter((s) => !s.dash).map((s) => `<div style="border-color:${s.color}"><span>${esc(s.name)}, latest</span><strong>${last(s) === undefined ? '—' : esc(format(last(s)))}</strong></div>`).join('')}</div>` : '';
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  if (!points || points.length !== labels.length) return `<div class="chart">${head}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)}">${g}</svg>${legend}</div>`;
  // Interactive layer: a full-height tap target per game, a highlight line and enlarged dots.
  const step = labels.length > 1 ? (W - pad.l - pad.r) / (labels.length - 1) : W;
  const hits = labels.map((_, i) => `<rect class="hit" data-pt="${i}" x="${Math.max(0, x(i) - step / 2)}" y="0" width="${step}" height="${H}" fill="transparent"><title>${esc(points[i].title)}</title></rect>`).join('');
  const marks = labels.map((_, i) => `<g class="pt-mark${i === labels.length - 1 ? ' on' : ''}" data-mark="${i}">${series.filter((s) => !s.dash).map((s) => (s.values[i] === null || s.values[i] === undefined ? '' : `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="7" fill="${s.color}" stroke="var(--bg)" stroke-width="3"/>`)).join('')}</g>`).join('');
  const ref = series.find((s) => s.ref);
  const cards = points.map((pt, i) => {
    const rows = series.map((s) => { const v = s.values[i]; return `<div class="ic-row"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><strong>${v === null || v === undefined ? '—' : esc((s.fmt || format)(v))}</strong></div>`; }).join('');
    const main = series[0].values[i]; const rv = ref ? ref.values[i] : null;
    const delta = ref && main !== null && main !== undefined && rv !== null && rv !== undefined ? `<p class="ic-delta">${esc(format(Math.abs(main - rv)).replace(/%$/, ' percentage points'))} ${main >= rv ? 'above' : 'below'} the ${esc(ref.name.toLowerCase())}</p>` : '';
    const res = pt.result ? `<span class="ic-res ${pt.result === 'W' ? 'w' : pt.result === 'L' ? 'l' : 'd'}">${esc(pt.result)} ${esc(pt.score || '')}</span>` : '';
    return `<div class="ic-head"><div><strong>${esc(pt.title)}</strong><span>${esc(pt.sub || '')}</span></div>${res}</div><div class="ic-rows">${rows}</div>${delta}${(pt.links || []).length ? `<div class="ic-links">${pt.links.map(([l, h]) => `<a href="${esc(h)}">${esc(l)} →</a>`).join('')}</div>` : ''}`;
  });
  const xs = labels.map((_, i) => +x(i).toFixed(1));
  const lastI = labels.length - 1;
  return `<div class="chart ichart" data-sel="${lastI}" data-xs="${xs.join(',')}">${head}
    <div class="ichart-tools"><span class="small faint">Tap a game for details</span><button class="ic-btn" data-expand aria-label="Expand chart" title="Expand">⤢</button></div>
    <div class="ichart-title">${esc(title)}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel || title)}">${g}<line class="sel-line" x1="${xs[lastI]}" x2="${xs[lastI]}" y1="${pad.t}" y2="${H - pad.b}"/>${marks}${hits}</svg>${legend}
    <div class="ichart-card" aria-live="polite"><div class="ic-nav"><button class="ic-btn" data-step="-1" aria-label="Previous game">‹</button><span class="ic-count">${lastI + 1} / ${labels.length}</span><button class="ic-btn" data-step="1" aria-label="Next game">›</button></div><div class="ic-body">${cards[lastI]}</div></div>
    <template>${cards.map((c) => `<div>${c}</div>`).join('')}</template></div>`;
}

// Full screen: the chart is moved to <body> while open (a panel's glass effect would
// otherwise trap a fixed-position element), and put back in place when closed.
let holder = null;
function toggleExpand(c) {
  const on = !c.classList.contains('expanded');
  if (on) { holder = document.createComment('chart'); c.replaceWith(holder); document.body.appendChild(c); } else if (holder) { holder.replaceWith(c); holder = null; }
  c.classList.toggle('expanded', on); document.body.classList.toggle('chart-open', on);
  const b = c.querySelector('[data-expand]'); b.textContent = on ? '✕' : '⤢'; b.setAttribute('aria-label', on ? 'Close' : 'Expand chart');
}
// One delegated handler for every interactive chart on any page.
function selectPoint(chart, i) {
  const xs = chart.dataset.xs.split(',').map(Number);
  const n = xs.length; i = Math.max(0, Math.min(n - 1, i));
  chart.dataset.sel = i;
  const line = chart.querySelector('.sel-line'); line.setAttribute('x1', xs[i]); line.setAttribute('x2', xs[i]);
  chart.querySelectorAll('.pt-mark').forEach((m) => m.classList.toggle('on', Number(m.dataset.mark) === i));
  const tpl = chart.querySelector('template').content.children[i];
  chart.querySelector('.ic-body').innerHTML = tpl ? tpl.innerHTML : '';
  chart.querySelector('.ic-count').textContent = `${i + 1} / ${n}`;
}
if (typeof document !== 'undefined' && !window.__ichart) {
  window.__ichart = true;
  const pick = (e) => { const h = e.target.closest?.('.ichart rect.hit'); if (h) selectPoint(h.closest('.ichart'), Number(h.dataset.pt)); };
  document.addEventListener('click', (e) => {
    pick(e);
    const st = e.target.closest?.('.ichart [data-step]'); if (st) { const c = st.closest('.ichart'); selectPoint(c, Number(c.dataset.sel) + Number(st.dataset.step)); }
    const ex = e.target.closest?.('.ichart [data-expand]');
    if (ex) toggleExpand(ex.closest('.ichart'));
  });
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pick(e); });
  document.addEventListener('keydown', (e) => {
    const c = document.querySelector('.ichart.expanded') || e.target.closest?.('.ichart');
    if (!c) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { selectPoint(c, Number(c.dataset.sel) + (e.key === 'ArrowLeft' ? -1 : 1)); e.preventDefault(); }
    if (e.key === 'Escape' && c.classList.contains('expanded')) toggleExpand(c);
  });
  window.addEventListener('hashchange', () => { const c = document.querySelector('.ichart.expanded'); if (c) { c.remove(); holder = null; } document.body.classList.remove('chart-open'); });
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

// Cumulative xG by minute ("xG race"), drawn as steps.
export function xgRace(race, { opp = 'Opponent' } = {}) {
  if (!race || race.length < 2) return '<div class="empty small">No minute-by-minute xG for this match.</div>';
  const W = 640; const H = 220; const pad = { l: 36, r: 12, t: 12, b: 28 };
  const maxMin = Math.max(90, ...race.map((r) => r.minute));
  const maxXg = Math.max(0.5, ...race.map((r) => Math.max(r.spurs || 0, r.opp || 0))) * 1.1;
  const x = (m) => pad.l + (m / maxMin) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxXg) * (H - pad.t - pad.b);
  const step = (k) => { let d = `M${x(0)},${y(0)}`; let last = 0; for (const r of race) { const v = r[k] ?? last; d += `H${x(r.minute).toFixed(1)}V${y(v).toFixed(1)}`; last = v; } return `${d}H${x(maxMin)}`; };
  let g = '';
  for (const v of [0, maxXg / 2, maxXg]) g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 4"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  for (const m of [0, 15, 30, 45, 60, 75, 90]) g += `<text x="${x(m)}" y="${H - 8}" text-anchor="middle">${m}'</text>`;
  g += `<line x1="${x(45)}" x2="${x(45)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--line)"/>`;
  g += `<path d="${step('opp')}" fill="none" stroke="var(--loss)" stroke-width="2.4"/><path d="${step('spurs')}" fill="none" stroke="var(--cyan)" stroke-width="2.4"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative xG by minute">${g}</svg><div class="legend"><span><i style="background:var(--cyan)"></i>Spurs</span><span><i style="background:var(--loss)"></i>${esc(opp)}</span></div></div>`;
}

// Attacking momentum per minute: bars above the line favour Spurs, below favour the opponent.
export function momentumChart(rows, { opp = 'Opponent' } = {}) {
  if (!rows || rows.length < 10) return '<div class="empty small">No momentum data for this match.</div>';
  const W = 640; const H = 170; const mid = H / 2 - 6; const pad = 10;
  const maxMin = Math.max(90, ...rows.map((r) => r.minute));
  const maxV = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const bw = (W - 2 * pad) / maxMin;
  let g = `<line x1="${pad}" x2="${W - pad}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>`;
  for (const r of rows) {
    const h = (Math.abs(r.value) / maxV) * (mid - 8);
    const xx = pad + (r.minute - 1) * bw;
    g += `<rect x="${xx.toFixed(1)}" y="${(r.value >= 0 ? mid - h : mid).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${r.value >= 0 ? 'var(--cyan)' : 'var(--loss)'}" opacity="0.85"><title>${r.minute}': ${r.value}</title></rect>`;
  }
  for (const m of [0, 45, 90]) g += `<text x="${pad + m * bw}" y="${H - 4}" text-anchor="middle">${m}'</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Attacking momentum">${g}</svg><div class="legend"><span><i style="background:var(--cyan)"></i>Spurs on top</span><span><i style="background:var(--loss)"></i>${esc(opp)} on top</span></div></div>`;
}

// ---------- Pitch graphics (vertical, attacking upwards) ----------
const PW = 340; const PH = 480;
function pitchBase(id, { half = false } = {}) {
  const h = half ? PH / 2 + 20 : PH;
  const lines = 'stroke="rgba(220,240,255,0.55)" stroke-width="1.4" fill="none"';
  let g = `<defs><radialGradient id="pg${id}" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#0f3a6b"/><stop offset="1" stop-color="#071a3a"/></radialGradient></defs>
    <rect x="0" y="0" width="${PW}" height="${h}" rx="10" fill="url(#pg${id})"/>`;
  for (let i = 0; i < 10; i++) g += `<rect x="12" y="${12 + i * 45.6}" width="${PW - 24}" height="22.8" fill="rgba(120,200,255,0.025)"/>`;
  g += `<rect x="12" y="12" width="${PW - 24}" height="${PH - 24}" ${lines}/><rect x="${PW / 2 - 80}" y="12" width="160" height="70" ${lines}/><rect x="${PW / 2 - 36}" y="12" width="72" height="24" ${lines}/>`;
  g += `<line x1="12" x2="${PW - 12}" y1="${PH / 2}" y2="${PH / 2}" stroke="rgba(220,240,255,0.55)" stroke-width="1.4"/><circle cx="${PW / 2}" cy="${PH / 2}" r="44" ${lines}/>`;
  g += `<rect x="${PW / 2 - 80}" y="${PH - 82}" width="160" height="70" ${lines}/><rect x="${PW / 2 - 36}" y="${PH - 36}" width="72" height="24" ${lines}/>`;
  return { g, h };
}

// Measured: Spurs shots by zone, shaded by xG.
export function shotZonePitch(zones) {
  const entries = Object.entries(zones || {});
  if (!entries.length) return '<div class="empty small">No shot locations yet.</div>';
  const { g: base } = pitchBase('z');
  const maxXg = Math.max(...entries.map(([, z]) => z.xg), 0.01);
  const bx = PW / 2 - 80; const bw = 160; const top = 12;
  const rects = {
    'six-left': [bx, top, 44, 24], 'six-centre': [PW / 2 - 36, top, 72, 24], 'six-right': [PW / 2 + 36, top, 44, 24],
    'box-left': [bx, top + 24, 52, 46], 'box-centre': [bx + 52, top + 24, 56, 46], 'box-right': [bx + 108, top + 24, 52, 46],
    'outside-left': [12, top + 70, bx - 12 + 20, 90], 'outside-centre': [bx + 20, top + 70, bw - 40, 90], 'outside-right': [bx + bw - 20, top + 70, PW - 12 - (bx + bw - 20), 90],
  };
  let g = '';
  for (const [k, [rx, ry, rw, rh]] of Object.entries(rects)) {
    const z = zones[k];
    const a = z ? 0.12 + 0.7 * (z.xg / maxXg) : 0.03;
    g += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgba(60,232,255,${a.toFixed(2)})" stroke="rgba(60,232,255,0.35)"><title>${k.replace('-', ' ')}: ${z ? `${z.shots} shots, ${z.goals} goals, ${z.xg} xG` : 'no shots'}</title></rect>`;
    if (z && rh >= 40) g += `<text x="${rx + rw / 2}" y="${ry + rh / 2}" text-anchor="middle" fill="#fff" style="font:600 13px var(--display)">${z.xg.toFixed(1)}</text><text x="${rx + rw / 2}" y="${ry + rh / 2 + 15}" text-anchor="middle" fill="rgba(234,242,255,0.75)" style="font-size:10px">${z.shots} sh · ${z.goals} g</text>`;
  }
  return `<div class="pitch-wrap"><svg viewBox="0 0 ${PW} 200" role="img" aria-label="Shots by zone">${base}${g}</svg></div>`;
}

// Illustrative concept boards. Positions are drawn by hand to explain an idea and are
// never presented as measured Tottenham positions.
export function conceptPitch(kind) {
  const { g: base } = pitchBase(kind);
  const dot = (x, y, fill, label = '') => `<circle cx="${x}" cy="${y}" r="11" fill="${fill}" stroke="#04102a" stroke-width="2"/>${label ? `<text x="${x}" y="${y + 4}" text-anchor="middle" style="font:600 10px var(--display)" fill="#04102a">${label}</text>` : ''}`;
  const arrow = (x1, y1, x2, y2, color = '#3ce8ff', dash = '6 6') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.4" stroke-dasharray="${dash}" marker-end="url(#ah-${kind})"/>`;
  const defs = `<defs><marker id="ah-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3ce8ff"/></marker></defs>`;
  const spurs = '#eaf2ff'; const opp = '#ef5f74'; const free = '#3ce8ff';
  let g = '';
  if (kind === 'buildup') {
    g += dot(170, 440, spurs, 'GK') + dot(110, 405, spurs, 'CB') + dot(230, 405, spurs, 'CB') + dot(140, 345, spurs, 'DM') + dot(200, 345, spurs, 'DM');
    g += dot(130, 395, opp) + dot(210, 395, opp) + dot(170, 360, opp);
    g += dot(85, 280, free) + dot(255, 280, free) + dot(170, 250, free) + dot(60, 190, spurs) + dot(280, 190, spurs) + dot(170, 160, spurs);
    g += arrow(170, 428, 205, 360, '#3ce8ff', '0') + arrow(110, 393, 88, 296) + arrow(230, 393, 252, 296) + arrow(200, 333, 172, 266);
  } else {
    g += dot(110, 330, spurs, 'CB') + dot(170, 345, spurs, 'CB') + dot(230, 330, spurs, 'CB') + dot(145, 270, spurs, 'DM') + dot(195, 270, spurs, 'DM');
    g += dot(40, 140, free, 'W') + dot(105, 125, free) + dot(170, 110, free, 'ST') + dot(235, 125, free) + dot(300, 140, free, 'W');
    g += `<rect x="90" y="250" width="160" height="110" rx="8" fill="none" stroke="#d9c25b" stroke-dasharray="5 5"/><text x="170" y="378" text-anchor="middle" fill="#d9c25b" style="font-size:11px">rest defence (3+2)</text>`;
    g += `<text x="170" y="92" text-anchor="middle" fill="#3ce8ff" style="font-size:11px">five attacking lanes</text>`;
  }
  return `<div class="pitch-wrap"><svg viewBox="0 0 ${PW} ${PH}" role="img" aria-label="Illustrative tactical diagram">${defs}${base}${g}</svg></div>`;
}

// Radar (spider) chart of percentiles 0–100. axes: [{ label, a, b? }]
export function radar(axes, { aName = 'Player', bName = null } = {}) {
  const ax = axes.filter((x) => x.a !== null && x.a !== undefined || (x.b !== null && x.b !== undefined));
  if (ax.length < 3) return '<div class="empty small">Not enough minutes for a radar yet.</div>';
  const S = 320; const c = S / 2; const R = 112; const n = ax.length;
  const pt = (i, v) => { const ang = -Math.PI / 2 + (i / n) * Math.PI * 2; const r = (Math.max(0, Math.min(100, v ?? 0)) / 100) * R; return [c + Math.cos(ang) * r, c + Math.sin(ang) * r]; };
  let g = '';
  for (const lvl of [25, 50, 75, 100]) g += `<polygon points="${ax.map((_, i) => pt(i, lvl).join(',')).join(' ')}" fill="none" stroke="var(--line)" ${lvl === 50 ? 'stroke-dasharray="3 4" stroke="var(--faint)"' : ''}/>`;
  ax.forEach((a, i) => {
    const [x, y] = pt(i, 100); g += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="var(--line)"/>`;
    const [lx, ly] = pt(i, 128);
    g += `<text x="${lx}" y="${ly}" text-anchor="${Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'}" dominant-baseline="middle" style="font-size:10.5px;fill:var(--muted)">${esc(a.label)}</text>`;
  });
  const shape = (key, color, fillOp) => {
    const pts = ax.map((a, i) => pt(i, a[key]).join(',')).join(' ');
    return `<polygon points="${pts}" fill="${color}" fill-opacity="${fillOp}" stroke="${color}" stroke-width="2.2"/>` + ax.map((a, i) => { const [x, y] = pt(i, a[key]); return a[key] === null || a[key] === undefined ? '' : `<circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${esc(a.label)}: ${a[key]}th percentile</title></circle>`; }).join('');
  };
  if (bName) g += shape('b', 'var(--draw)', 0.18);
  g += shape('a', 'var(--cyan)', 0.22);
  return `<div class="chart" style="max-width:420px;margin:0 auto"><svg viewBox="-95 -14 ${S + 190} ${S + 28}" role="img" aria-label="Radar chart">${g}</svg>
    <div class="legend" style="justify-content:center"><span><i style="background:var(--cyan)"></i>${esc(aName)}</span>${bName ? `<span><i style="background:var(--draw)"></i>${esc(bName)}</span>` : ''}<span><i style="background:var(--faint)"></i>dashed ring = league average (50th)</span></div></div>`;
}
