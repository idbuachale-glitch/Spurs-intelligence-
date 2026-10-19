// Animated chance replays: every shot of a match redrawn in order on a full pitch, from the
// real shot positions (FotMob via FPL Core Insights). Spurs attack the top goal, the
// opponent the bottom one. The ball path is illustrative: the data gives where each shot
// was taken from and how it ended, not its exact flight.
import { esc, fmtPlain } from './lib.js';

const W = 340; const LEN = 105; const S = W / 68; const H = LEN * S; // metres -> px
const GOAL_L = (30.34 / 68) * W; const GOAL_R = (37.66 / 68) * W;

function place(sh) { // shot start in pitch pixels
  const top = sh.team === 'spurs';
  const x = ((top ? sh.y : 100 - sh.y) / 100) * W;
  const y = top ? sh.x * S : H - sh.x * S;
  return { x, y, top };
}
function target(sh, p, seed) { // where the ball ends, by outcome
  const gy = p.top ? -2 : H + 2; const mid = W / 2; const r = (seed % 100) / 100;
  if (sh.outcome === 'goal') return { x: GOAL_L + 6 + r * (GOAL_R - GOAL_L - 12), y: gy };
  if (sh.outcome === 'save') return { x: mid + (r - 0.5) * 18, y: p.top ? 6 : H - 6 };
  if (sh.outcome === 'block' || sh.outcome === 'blocked') return { x: p.x + (mid - p.x) * 0.25, y: p.y + (gy - p.y) * 0.22 };
  if (/post|bar|woodwork/i.test(sh.outcome || '')) return { x: r > 0.5 ? GOAL_R : GOAL_L, y: p.top ? 0 : H };
  return { x: r > 0.5 ? GOAL_R + 10 + r * 24 : GOAL_L - 10 - r * 24, y: gy }; // miss
}
const OUT = { goal: 'GOAL!', save: 'Saved', miss: 'Off target', block: 'Blocked', blocked: 'Blocked', post: 'Hit the woodwork' };

export function replayHtml(m) {
  const shots = (m.detail?.shots || []).filter((s) => s.x !== null && s.y !== null && s.minute !== null)
    .sort((a, b) => a.minute - b.minute || (a.added || 0) - (b.added || 0));
  if (shots.length < 2) return '';
  const f = m.fixture;
  const lines = `<rect x="0" y="0" width="${W}" height="${H}" rx="8" class="rp-grass"/>
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="rp-line"/><circle cx="${W / 2}" cy="${H / 2}" r="${9.15 * S}" class="rp-line" fill="none"/>
    ${[0, H].map((y0) => { const d = y0 ? -1 : 1; return `<rect x="${(13.84 / 68) * W}" y="${y0 ? H - 16.5 * S : 0}" width="${(40.32 / 68) * W}" height="${16.5 * S}" class="rp-line" fill="none"/>
      <rect x="${(24.84 / 68) * W}" y="${y0 ? H - 5.5 * S : 0}" width="${(18.32 / 68) * W}" height="${5.5 * S}" class="rp-line" fill="none"/>
      <rect x="${GOAL_L}" y="${y0 ? H : -5}" width="${GOAL_R - GOAL_L}" height="5" class="rp-goal"/><circle cx="${W / 2}" cy="${y0 + d * 11 * S}" r="1.5" fill="rgba(255,255,255,.5)"/>`; }).join('')}`;
  return `<section class="panel section replay" id="replay">
    <div class="section-head"><h2>Replay the chances</h2><div class="seg" id="rp-filter"><button data-f="all" aria-pressed="true">All</button><button data-f="spurs" aria-pressed="false">Spurs</button><button data-f="big" aria-pressed="false">Big chances</button></div></div>
    <div class="rp-board"><span class="rp-team">Spurs ↑</span><strong id="rp-score">0 – 0</strong><span class="rp-team">${esc(f.opponent)} ↓</span></div>
    <div class="rp-stage"><svg viewBox="-8 -10 ${W + 16} ${H + 20}" role="img" aria-label="Animated chance replay">${lines}
      <g id="rp-trail"></g><g id="rp-marks"></g>
      <circle id="rp-shooter" r="7" cx="-50" cy="-50" class="rp-shooter"/>
      <circle id="rp-ball" r="4" cx="-50" cy="-50" class="rp-ball"/>
      <text id="rp-name" x="-50" y="-50" class="rp-name"></text>
      <text id="rp-xg" x="-50" y="-50" class="rp-xg"></text>
    </svg><div class="rp-banner" id="rp-banner" hidden></div></div>
    <div class="rp-caption" id="rp-caption">Press play to watch every chance in order.</div>
    <div class="rp-ctrl"><button class="btn ghost" id="rp-prev" aria-label="Previous chance">⏮</button><button class="btn" id="rp-play">▶ Play</button><button class="btn ghost" id="rp-next" aria-label="Next chance">⏭</button><span class="small muted" id="rp-count"></span></div>
    <p class="source">Shot positions, outcomes and xG from FotMob (via FPL Core Insights). Ball paths are drawn for illustration; the data records where each shot was taken and how it ended. Spurs attack the top goal. Circle size = xG.</p>
  </section>`;
}

export function bindReplay(m) {
  const root = document.getElementById('replay'); if (!root) return;
  const all = (m.detail?.shots || []).filter((s) => s.x !== null && s.y !== null && s.minute !== null)
    .sort((a, b) => a.minute - b.minute || (a.added || 0) - (b.added || 0));
  let list = all; let i = -1; let playing = false; let timer = null; let raf = null;
  const $ = (id) => document.getElementById(id);
  const ball = $('rp-ball'); const shooter = $('rp-shooter'); const nm = $('rp-name'); const xgT = $('rp-xg'); const banner = $('rp-banner');
  const set = (el, a) => { for (const [k, v] of Object.entries(a)) el.setAttribute(k, v); };
  const scoreAt = (k) => { let s = 0; let o = 0; for (const x of all.slice(0, all.indexOf(list[k]) + 1)) if (x.outcome === 'goal') { if (x.team === 'spurs') s++; else o++; } return [s, o]; };
  const marks = () => { $('rp-marks').innerHTML = list.slice(0, i).map((sh) => { const p = place(sh); const r = 2.5 + Math.sqrt(sh.xg || 0.01) * 11; return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" class="rp-mark ${sh.team}${sh.outcome === 'goal' ? ' goal' : ''}"/>`; }).join(''); };
  const show = (k, animate = true) => {
    cancelAnimationFrame(raf); clearTimeout(timer); banner.hidden = true;
    i = Math.max(0, Math.min(list.length - 1, k)); const sh = list[i];
    marks();
    const p = place(sh); const t = target(sh, p, Math.round((sh.xg || 0) * 10000) + i * 37);
    set(shooter, { cx: p.x, cy: p.y, class: `rp-shooter ${sh.team}` });
    set(nm, { x: Math.min(W - 4, Math.max(4, p.x)), y: p.y + (p.top ? 18 : -12), 'text-anchor': p.x < 60 ? 'start' : p.x > W - 60 ? 'end' : 'middle' }); nm.textContent = sh.player || '';
    set(xgT, { x: p.x, y: p.y + (p.top ? -12 : 22), 'text-anchor': 'middle' }); xgT.textContent = `xG ${fmtPlain(sh.xg, 2)}`;
    const [s, o] = scoreAt(i - 1 < 0 ? -1 : i - 1); $('rp-score').textContent = `${s} – ${o}`;
    const min = `${sh.minute}${sh.added ? `+${sh.added}` : ''}′`;
    $('rp-caption').innerHTML = `<strong>${min}</strong> ${sh.player ? `${esc(sh.player)} (${sh.team === 'spurs' ? 'Spurs' : esc(m.fixture.opponent)})` : `${sh.team === 'spurs' ? 'Spurs' : esc(m.fixture.opponent)} shot (player not recorded)`} · ${esc((sh.situation || '').replace(/-/g, ' '))}${sh.bodyPart ? ` · ${esc(sh.bodyPart.replace(/-/g, ' '))}` : ''} · <span class="rp-out ${sh.outcome}">${esc(OUT[sh.outcome] || sh.outcome || '')}</span>`;
    $('rp-count').textContent = `${i + 1} / ${list.length}`;
    const finish = () => {
      set(ball, { cx: t.x, cy: t.y });
      const [s2, o2] = scoreAt(i); $('rp-score').textContent = `${s2} – ${o2}`;
      if (sh.outcome === 'goal') { banner.textContent = `GOAL! ${sh.player || (sh.team === 'spurs' ? 'Spurs' : m.fixture.opponent)}`; banner.className = `rp-banner ${sh.team}`; banner.hidden = false; }
      if (playing) timer = setTimeout(() => { if (i < list.length - 1) show(i + 1); else stop(); }, sh.outcome === 'goal' ? 2200 : 1100);
    };
    if (!animate) { finish(); return; }
    set(ball, { cx: p.x, cy: p.y });
    const t0 = performance.now(); const dur = 650 + Math.hypot(t.x - p.x, t.y - p.y) * 1.2;
    const step = (now) => { const k2 = Math.min(1, (now - t0) / dur); const e = 1 - (1 - k2) ** 3; set(ball, { cx: p.x + (t.x - p.x) * e, cy: p.y + (t.y - p.y) * e - Math.sin(Math.PI * e) * 14 }); if (k2 < 1) raf = requestAnimationFrame(step); else finish(); };
    timer = setTimeout(() => { raf = requestAnimationFrame(step); }, 450);
  };
  const stop = () => { playing = false; $('rp-play').textContent = '▶ Play'; clearTimeout(timer); };
  $('rp-play').addEventListener('click', () => { if (playing) { stop(); return; } playing = true; $('rp-play').textContent = '⏸ Pause'; show(i >= list.length - 1 ? 0 : i + 1); });
  $('rp-next').addEventListener('click', () => { stop(); show(i + 1); });
  $('rp-prev').addEventListener('click', () => { stop(); show(i - 1); });
  $('rp-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    root.querySelectorAll('#rp-filter button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    list = b.dataset.f === 'spurs' ? all.filter((s) => s.team === 'spurs') : b.dataset.f === 'big' ? all.filter((s) => (s.xg || 0) >= 0.2 || s.outcome === 'goal') : all;
    stop(); i = -1; $('rp-marks').innerHTML = ''; set(ball, { cx: -50, cy: -50 }); set(shooter, { cx: -50, cy: -50 }); nm.textContent = ''; xgT.textContent = ''; banner.hidden = true;
    $('rp-caption').textContent = `${list.length} chance${list.length === 1 ? '' : 's'}. Press play.`; $('rp-count').textContent = '';
  });
}
