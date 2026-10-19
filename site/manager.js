// Manager mode: pick a formation, XI and tactics from the real Spurs squad and play the
// next real fixture minute by minute. Ratings come from each player's real per-90 figures
// against Premier League players in his position; the match engine starts from the site's
// own expected-goals forecast for the fixture and adjusts it for the manager's choices.
// It is a game: results are random draws, not predictions.
import { state, loadSeason, esc, fmtPlain, fmtDate, fmtTime } from './lib.js';

// ---------- Formations (x, y in % of the pitch; Spurs attack upwards) ----------
const D = ['DEF']; const M = ['MID']; const F = ['FWD']; const WB = ['DEF', 'MID']; const W = ['FWD', 'MID']; const AM = ['MID', 'FWD'];
const s = (label, pos, x, y) => ({ label, pos, x, y });
const back4 = [s('LB', D, 14, 72), s('CB', D, 37, 77), s('CB', D, 63, 77), s('RB', D, 86, 72)];
const back3 = [s('CB', D, 26, 76), s('CB', D, 50, 78), s('CB', D, 74, 76)];
export const FORMATIONS = {
  '4-3-3': { bias: [1, 1], slots: [s('GK', ['GK'], 50, 91), ...back4, s('CM', M, 28, 52), s('DM', M, 50, 59), s('CM', M, 72, 52), s('LW', W, 16, 26), s('ST', F, 50, 18), s('RW', W, 84, 26)] },
  '4-2-3-1': { bias: [0.98, 0.95], slots: [s('GK', ['GK'], 50, 91), ...back4, s('DM', M, 36, 60), s('DM', M, 64, 60), s('LW', W, 16, 36), s('AM', AM, 50, 40), s('RW', W, 84, 36), s('ST', F, 50, 17)] },
  '3-4-3': { bias: [1.08, 1.08], slots: [s('GK', ['GK'], 50, 91), ...back3, s('LWB', WB, 11, 50), s('CM', M, 37, 56), s('CM', M, 63, 56), s('RWB', WB, 89, 50), s('LW', W, 20, 25), s('ST', F, 50, 18), s('RW', W, 80, 25)] },
  '4-4-2': { bias: [0.97, 0.96], slots: [s('GK', ['GK'], 50, 91), ...back4, s('LM', W, 13, 49), s('CM', M, 37, 54), s('CM', M, 63, 54), s('RM', W, 87, 49), s('ST', F, 37, 20), s('ST', F, 63, 20)] },
  '3-5-2': { bias: [1.01, 0.98], slots: [s('GK', ['GK'], 50, 91), ...back3, s('LWB', WB, 10, 48), s('CM', M, 31, 54), s('DM', M, 50, 61), s('CM', M, 69, 54), s('RWB', WB, 90, 48), s('ST', F, 37, 20), s('ST', F, 63, 20)] },
  '5-3-2': { bias: [0.86, 0.82], slots: [s('GK', ['GK'], 50, 91), s('LWB', WB, 10, 66), ...back3, s('RWB', WB, 90, 66), s('CM', M, 28, 50), s('CM', M, 50, 55), s('CM', M, 72, 50), s('ST', F, 37, 20), s('ST', F, 63, 20)] },
};
const PRESS = { low: { label: 'Low block', f: 0.94, a: 0.97, tire: 0.6, poss: -6 }, mid: { label: 'Mid press', f: 1, a: 1, tire: 1, poss: 0 }, high: { label: 'High press', f: 1.08, a: 0.95, tire: 1.7, poss: 3 } };
const MENT = { def: { label: 'Defensive', f: 0.84, a: 0.8, poss: -4 }, bal: { label: 'Balanced', f: 1, a: 1, poss: 0 }, att: { label: 'Attacking', f: 1.16, a: 1.15, poss: 4 } };

// ---------- Ratings from real per-90 figures ----------
const ATT = ['xg', 'xa', 'threat', 'creativity'];
const DEFK = { GK: [['saves', 1], ['xgc', -1], ['gc', -1]], other: [['tackles', 1], ['cbi', 1], ['recoveries', 1], ['defcon', 1], ['xgc', -1]] };
const OVR = { GK: [['saves', 1], ['xgc', -1], ['gc', -1]], DEF: [['tackles', 1], ['cbi', 1], ['recoveries', 1], ['defcon', 1], ['xgc', -1], ['xa', 1], ['creativity', 1]],
  MID: [['xg', 1], ['xa', 1], ['creativity', 1], ['threat', 1], ['recoveries', 1], ['tackles', 1]], FWD: [['xg', 1], ['xa', 1], ['threat', 1], ['goals', 1], ['creativity', 1]] };

function percentileFn(pool) {
  const cache = new Map();
  return (pos, key, v) => {
    if (v === null || v === undefined) return null;
    const ck = `${pos}:${key}`;
    if (!cache.has(ck)) cache.set(ck, pool.filter((p) => p.pos === pos && p.per90 && p.per90[key] !== null && p.per90[key] !== undefined).map((p) => p.per90[key]).sort((a, b) => a - b));
    const arr = cache.get(ck); if (arr.length < 8) return null;
    let lo = 0; while (lo < arr.length && arr[lo] < v) lo++;
    let hi = lo; while (hi < arr.length && arr[hi] === v) hi++;
    return ((lo + (hi - lo) / 2) / arr.length) * 100;
  };
}
// Players short of the minutes threshold are rated from their season totals, pulled
// towards an average rating in proportion to how little they have played.
function rate(p, pct) {
  let per90 = p.per90; let shrink = 1;
  if (!per90 && p.totals && p.minutes >= 45) { per90 = Object.fromEntries(Object.entries(p.totals).map(([k, v]) => [k, v === null ? null : (v / p.minutes) * 90])); shrink = p.minutes / (p.minutes + 300); }
  if (!per90) return { ovr: 62, att: 50, def: 50, few: true };
  const avg = (list) => { const v = list.map(([k, dir]) => { const x = pct(p.pos, k, per90[k]); return x === null ? null : dir > 0 ? x : 100 - x; }).filter((x) => x !== null); const a = v.length ? v.reduce((x, y) => x + y, 0) / v.length : 50; return 50 + (a - 50) * shrink; };
  const o = avg(OVR[p.pos]);
  return { ovr: Math.round(56 + o * 0.4), att: p.pos === 'GK' ? 0 : avg(ATT.map((k) => [k, 1])), def: avg(p.pos === 'GK' ? DEFK.GK : DEFK.other), few: shrink < 1, per90 };
}

// ---------- Team strength ----------
const fitPen = (player, slot) => (slot.pos.includes(player.pos) ? 1 : player.pos === 'GK' || slot.pos.includes('GK') ? 0.3 : 0.8);
const W_ATT = { GK: 0, DEF: 0.35, MID: 0.8, FWD: 1 }; const W_DEF = { GK: 1.3, DEF: 1, MID: 0.6, FWD: 0.15 };
function strength(xi) { // xi: [{ player, slot, energy, sentOff }]
  let a = 0; let aw = 0; let d = 0; let dw = 0;
  for (const x of xi) {
    if (!x || !x.player || x.sentOff) continue;
    const pen = fitPen(x.player, x.slot) * (x.energy ?? 1);
    const pos = x.slot.pos.includes('GK') ? 'GK' : x.player.pos === 'GK' ? 'DEF' : x.player.pos;
    a += W_ATT[pos] * (20 + x.player.r.att * 0.8 + x.player.r.ovr * 0.4) * pen; aw += W_ATT[pos];
    d += W_DEF[pos] * (20 + x.player.r.def * 0.8 + x.player.r.ovr * 0.4) * pen; dw += W_DEF[pos];
  }
  const on = xi.filter((x) => x && x.player && !x.sentOff).length;
  const short = on < 11 ? 0.82 ** (11 - on) : 1; // playing a man down
  return { att: (aw ? a / aw : 0) * short, def: (dw ? d / dw : 0) * short };
}
const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
function probs(ls, lo) { let w = 0; let dr = 0; let l = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = pois(i, ls) * pois(j, lo); if (i > j) w += p; else if (i === j) dr += p; else l += p; } return { w: Math.round(w * 100), d: Math.round(dr * 100), l: Math.round(l * 100) }; }

function autoPick(slots, players, taken = new Set()) {
  const out = slots.map(() => null); const used = new Set(taken);
  const order = slots.map((sl, i) => i).sort((a, b) => (slots[a].pos.includes('GK') ? -1 : slots[b].pos.includes('GK') ? 1 : 0));
  for (const i of order) {
    const best = players.filter((p) => !used.has(p.id) && slots[i].pos.includes(p.pos)).sort((a, b) => b.r.ovr - a.r.ovr)[0]
      || players.filter((p) => !used.has(p.id) && p.pos !== 'GK').sort((a, b) => b.r.ovr - a.r.ovr)[0];
    if (best) { out[i] = best.id; used.add(best.id); }
  }
  return out;
}

// ---------- State ----------
const LS = 'si-manager-v1';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* private mode */ } };
let G = null; // game context for the current page

async function context() {
  const [ps, lp, sim, fx] = await Promise.all([loadSeason('players.json'), loadSeason('league-players.json'), loadSeason('simulation.json', state.season, { optional: true }), loadSeason('fixtures.json')]);
  const pool = lp.players.filter((p) => p.per90);
  const pct = percentileFn(pool);
  const byCode = new Map(lp.players.map((p) => [String(p.code), p]));
  const squad = ps.players.filter((p) => p.current && p.pos).map((p) => {
    const lpp = byCode.get(String(p.id));
    const x = { id: p.id, name: p.web, full: p.name, pos: p.pos, num: p.squadNumber, status: p.status, statusLabel: p.statusLabel, news: p.news, chance: p.chanceNext, per90: lpp?.per90 || null, totals: lpp?.totals || null, minutes: lpp?.minutes ?? 0 };
    x.r = rate(x, pct); if (!x.per90) x.per90 = x.r.per90 || null; x.out = ['i', 's', 'u', 'n'].includes(p.status);
    return x;
  });
  const next = sim?.next || null;
  const f = next ? fx.fixtures.find((z) => z.id === next.matchId) : fx.fixtures.find((z) => z.status === 'SCHEDULED' && z.opponentTeamId);
  if (!f) return null;
  const oppAll = lp.players.filter((p) => p.teamId === f.opponentTeamId).map((p) => { const x = { id: `o${p.id}`, name: p.web, pos: p.pos, per90: p.per90, totals: p.totals, minutes: p.minutes }; x.r = rate(x, pct); if (!x.per90) x.per90 = x.r.per90 || null; return x; });
  const oppXi = [];
  for (const [pos, n] of [['GK', 1], ['DEF', 4], ['MID', 4], ['FWD', 2]]) oppXi.push(...oppAll.filter((p) => p.pos === pos).sort((a, b) => b.minutes - a.minutes).slice(0, n));
  const base = next ? next.expectedGoals : { spurs: 1.4, opp: 1.3 };
  const avail = squad.filter((p) => !p.out);
  const baseXi = autoPick(FORMATIONS['4-3-3'].slots, avail).map((id, i) => ({ player: avail.find((p) => p.id === id), slot: FORMATIONS['4-3-3'].slots[i] }));
  return { f, next, base, squad, avail, oppXi, baseStr: strength(baseXi) };
}

function lambdas(ctx, xi, form, press, ment, extra = { f: 1, a: 1 }) {
  const st = strength(xi); const b = FORMATIONS[form].bias; const P = PRESS[press]; const Mt = MENT[ment];
  const ls = ctx.base.spurs * (st.att / ctx.baseStr.att) ** 1.6 * b[0] * P.f * Mt.f * extra.f;
  const lo = ctx.base.opp * (ctx.baseStr.def / st.def) ** 1.6 * b[1] * P.a * Mt.a * extra.a;
  return { ls: Math.max(0.15, ls), lo: Math.max(0.15, lo), st };
}

// ---------- View: team selection ----------
export async function managerView() {
  if (G) clearTimeout(G.timer);
  const ctx = await context();
  if (!ctx) return '<h1>Manager mode</h1><div class="empty">There is no upcoming fixture to play right now.</div>';
  const saved = load();
  const form = saved.form && FORMATIONS[saved.form] ? saved.form : '4-3-3';
  let pick = Array.isArray(saved.xi) && saved.form === form ? saved.xi.map((id) => (ctx.avail.some((p) => p.id === id) ? id : null)) : null;
  if (!pick || pick.length !== 11) pick = autoPick(FORMATIONS[form].slots, ctx.avail);
  G = { ctx, form, pick, press: saved.press || 'mid', ment: saved.ment || 'bal', match: null };
  const f = ctx.f;
  const rec = saved.history || [];
  const wdl = ['W', 'D', 'L'].map((r) => rec.filter((h) => h.r === r).length);
  return `<div class="section-head"><h1>Manager mode</h1><span class="label-analysis">Game · just for fun</span></div>
    <p class="lede">You're the manager. Pick the shape, the XI and the approach for Spurs' next real match, then play it minute by minute. Ratings come from each player's real stats this season; your choices change the odds.</p>
    <section class="panel mgr-fx"><div class="mgr-teams"><span>${crestImgCode(6)}<strong>Spurs</strong></span><span class="muted">${f.home ? 'v' : '@'}</span><span>${crestImgCode(state.meta.teamCodes?.[f.opponentTeamId])}<strong>${esc(f.opponent)}</strong></span></div>
      <p class="small muted" style="margin:6px 0 0">${esc(f.competition)} · ${esc(fmtDate(f.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${esc(fmtTime(f.kickoff))} Bahrain${rec.length ? ` · Your record: <strong>${wdl[0]}W ${wdl[1]}D ${wdl[2]}L</strong>` : ''}</p></section>
    <div class="mgr-grid section">
      <div>
        <div class="mgr-ctl"><label class="small muted">Formation</label><div class="seg" id="mg-form">${Object.keys(FORMATIONS).map((k) => `<button data-v="${k}" aria-pressed="${k === form}">${k}</button>`).join('')}</div></div>
        <div class="mgr-ctl"><label class="small muted">Pressing</label><div class="seg" id="mg-press">${Object.entries(PRESS).map(([k, v]) => `<button data-v="${k}" aria-pressed="${k === G.press}">${v.label}</button>`).join('')}</div></div>
        <div class="mgr-ctl"><label class="small muted">Mentality</label><div class="seg" id="mg-ment">${Object.entries(MENT).map(([k, v]) => `<button data-v="${k}" aria-pressed="${k === G.ment}">${v.label}</button>`).join('')}</div></div>
        <div class="pitch" id="mg-pitch"></div>
        <div class="mgr-actions"><button class="btn ghost" id="mg-auto">Auto-pick best XI</button><button class="btn" id="mg-kick">Kick off ▶</button></div>
      </div>
      <div>
        <div class="panel" id="mg-odds"></div>
        <div class="panel section" id="mg-bench"></div>
        <p class="source">Ratings (56–96): each player's per-90 figures this season ranked against Premier League players in his position (FPL/Opta). Players with few minutes are rated from fewer games and pulled towards average. Out-of-position players lose 20%. Injured, suspended and loaned-out players can't be picked. The match starts from the site's real forecast for this fixture (expected goals ${fmtPlain(ctx.base.spurs, 2)}–${fmtPlain(ctx.base.opp, 2)} with the strongest XI) and adjusts it for your choices.</p>
      </div>
    </div>
    <div id="mg-sheet" class="mgr-sheet" hidden></div>`;
}
const crestImgCode = (code) => (code ? `<img class="tcrest" src="https://resources.premierleague.com/premierleague/badges/70/t${code}.png" alt="" onerror="this.remove()">` : '');

function xiFromPick() { const slots = FORMATIONS[G.form].slots; return G.pick.map((id, i) => ({ player: G.ctx.avail.find((p) => p.id === id) || null, slot: slots[i] })); }
const ratingIn = (p, slot) => Math.round(p.r.ovr * fitPen(p, slot));
const tag = (p) => (p.status === 'd' ? `<span class="mg-doubt" title="${esc(p.news || 'Doubtful')}">${p.chance ?? '?'}%</span>` : '');

function drawSetup() {
  const slots = FORMATIONS[G.form].slots; const xi = xiFromPick();
  document.getElementById('mg-pitch').innerHTML = pitchLines() + slots.map((sl, i) => {
    const p = xi[i].player;
    const r = p ? ratingIn(p, sl) : null;
    const warn = p && !sl.pos.includes(p.pos);
    return `<button class="pslot${p ? '' : ' empty'}${warn ? ' oop' : ''}" data-slot="${i}" style="left:${sl.x}%;top:${sl.y}%"><span class="pr">${r ?? '+'}</span><span class="pn">${p ? esc(p.name) : sl.label}</span><span class="pl">${sl.label}${warn ? ' ⚠' : ''}</span></button>`;
  }).join('');
  const used = new Set(G.pick);
  const bench = G.ctx.avail.filter((p) => !used.has(p.id)).sort((a, b) => b.r.ovr - a.r.ovr);
  const out = G.ctx.squad.filter((p) => p.out);
  document.getElementById('mg-bench').innerHTML = `<h3 style="margin-top:0">Bench (${bench.length})</h3><div class="mg-list">${bench.map((p) => `<div class="mg-row"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} ${tag(p)}${p.r.few ? `<span class="faint tiny"> ${p.minutes} mins</span>` : ''}</span><strong>${p.r.ovr}</strong></div>`).join('')}</div>
    ${out.length ? `<p class="small muted" style="margin:10px 0 0">Unavailable: ${out.map((p) => `${esc(p.name)} (${esc(p.statusLabel || 'out')})`).join(', ')}</p>` : ''}`;
  const { ls, lo, st } = lambdas(G.ctx, xi, G.form, G.press, G.ment);
  const pr = probs(ls, lo); const base = G.ctx.next;
  const bar = (v, max) => `<div class="mg-bar"><div style="width:${Math.min(100, (v / max) * 100)}%"></div></div>`;
  document.getElementById('mg-odds').innerHTML = `<h3 style="margin-top:0">Your odds</h3>
    <div class="mg-wdl"><div style="flex:${pr.w}" class="w">Win ${pr.w}%</div><div style="flex:${pr.d}" class="d">${pr.d}%</div><div style="flex:${pr.l}" class="l">${pr.l}%</div></div>
    ${base ? `<p class="tiny faint" style="margin:4px 0 10px">Site forecast with the usual XI: win ${Math.round(base.win)}% · draw ${Math.round(base.draw)}% · lose ${Math.round(base.loss)}%</p>` : ''}
    <div class="statlist"><div class="statrow"><span>Attack</span><span class="v">${Math.round(st.att)}</span></div>${bar(st.att, 110)}
    <div class="statrow"><span>Defence</span><span class="v">${Math.round(st.def)}</span></div>${bar(st.def, 110)}
    <div class="statrow"><span>Expected goals</span><span class="v">${fmtPlain(ls, 2)} – ${fmtPlain(lo, 2)}</span></div></div>`;
  document.getElementById('mg-kick').disabled = G.pick.some((id) => !id);
  save({ ...load(), form: G.form, xi: G.pick, press: G.press, ment: G.ment });
}
const pitchLines = () => '<div class="pl-half"></div><div class="pl-circle"></div><div class="pl-box top"></div><div class="pl-box bottom"></div>';

function openPicker(i) {
  const sl = FORMATIONS[G.form].slots[i];
  const cur = G.pick[i];
  const list = G.ctx.avail.slice().sort((a, b) => ratingIn(b, sl) - ratingIn(a, sl));
  const sheet = document.getElementById('mg-sheet');
  sheet.innerHTML = `<div class="mgr-sheet-in"><div class="section-head"><h3 style="margin:0">Pick for ${sl.label}</h3><button class="btn ghost" data-close>Close</button></div>
    <div class="mg-list">${list.map((p) => { const where = G.pick.indexOf(p.id); return `<button class="mg-row pick${p.id === cur ? ' on' : ''}" data-pid="${p.id}"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} ${tag(p)}${where >= 0 && p.id !== cur ? `<span class="faint tiny"> in XI (${FORMATIONS[G.form].slots[where].label}) · swap</span>` : ''}${!sl.pos.includes(p.pos) ? '<span class="faint tiny"> out of position</span>' : ''}</span><strong>${ratingIn(p, sl)}</strong></button>`; }).join('')}</div></div>`;
  sheet.hidden = false;
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) { sheet.hidden = true; return; }
    const b = e.target.closest('[data-pid]'); if (!b) return;
    const pid = b.dataset.pid; const j = G.pick.indexOf(pid);
    if (j >= 0) G.pick[j] = G.pick[i]; // swap positions
    G.pick[i] = pid; sheet.hidden = true; drawSetup();
  };
}

export function managerAfter() {
  if (!G) return;
  drawSetup();
  const seg = (id, key, after) => document.getElementById(id).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; G[key] = b.dataset.v; document.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute('aria-pressed', x === b)); after?.(); drawSetup(); });
  seg('mg-form', 'form', () => { G.pick = autoPick(FORMATIONS[G.form].slots, G.ctx.avail); });
  seg('mg-press', 'press'); seg('mg-ment', 'ment');
  document.getElementById('mg-pitch').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) openPicker(Number(b.dataset.slot)); });
  document.getElementById('mg-auto').addEventListener('click', () => { G.pick = autoPick(FORMATIONS[G.form].slots, G.ctx.avail); drawSetup(); });
  document.getElementById('mg-kick').addEventListener('click', startMatch);
}

// ---------- Match engine ----------
const rnd = Math.random;
const pickW = (items, w) => { const t = items.reduce((a, x) => a + Math.max(0.0001, w(x)), 0); let r = rnd() * t; for (const x of items) { r -= Math.max(0.0001, w(x)); if (r <= 0) return x; } return items[items.length - 1]; };
const shotXg = () => Math.min(0.78, Math.max(0.02, -Math.log(1 - rnd()) * 0.115));

function startMatch() {
  const slots = FORMATIONS[G.form].slots;
  const xi = G.pick.map((id, i) => ({ player: G.ctx.avail.find((p) => p.id === id), slot: slots[i], energy: 1, on: 0, yc: 0, sentOff: false, g: 0, a: 0, sh: 0, rating: 6.4 }));
  const opp = G.ctx.oppXi.map((p) => ({ player: p, slot: { pos: [p.pos] }, energy: 1, yc: 0, sentOff: false, g: 0, a: 0, rating: 6.4 }));
  G.match = { min: 0, added: [1 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 5)], half: 1, score: [0, 0], xi, opp, used: [], subsLeft: 5, events: [], gone: [],
    st: { shots: [0, 0], sot: [0, 0], xg: [0, 0], yc: [0, 0], corners: [0, 0], poss: [] }, speed: 1, paused: false, done: false, oppMen: 11, tilt: 0 };
  renderMatch(); tick();
}

function tick() {
  const m = G.match; clearTimeout(G.timer);
  if (m.done || m.paused || !location.hash.startsWith('#/manager')) return; // stop if the page was left
  if (m.speed === 'skip') { while (!m.done && !m.paused) step(); renderMatch(); return; }
  step(); renderMatch();
  if (!m.done && !m.paused) G.timer = setTimeout(tick, 900 / m.speed);
}

function step() {
  const m = G.match; m.min++;
  const endHalf = m.half === 1 ? 45 + m.added[0] : 90 + m.added[1];
  const mm = m.half === 1 ? Math.min(m.min, 45) : Math.min(m.min, 90);
  const stamp = m.min > (m.half === 1 ? 45 : 90) ? `${m.half === 1 ? 45 : 90}+${m.min - (m.half === 1 ? 45 : 90)}` : String(m.min);
  // fatigue
  const tire = PRESS[G.press].tire;
  for (const x of m.xi) if (!x.sentOff) { const played = m.min - x.on; if (played > 55) x.energy = Math.max(0.78, 1 - (played - 55) * 0.0035 * tire); }
  const oppShort = { f: 0.82 ** (11 - m.oppMen), a: 1 / 0.82 ** (11 - m.oppMen) };
  const { ls, lo } = lambdas(G.ctx, m.xi, G.form, G.press, G.ment, { f: oppShort.f, a: oppShort.a });
  // game state: trailing teams push
  const diff = m.score[0] - m.score[1]; const late = mm > 65 ? 1.2 : 1;
  const lS = ls * (diff < 0 ? 1.12 * late : diff > 0 ? 0.92 : 1); const lO = lo * (diff > 0 ? 1.12 * late : diff < 0 ? 0.92 : 1);
  const possBase = 54 + PRESS[G.press].poss + MENT[G.ment].poss + (ls - lo) * 6;
  m.st.poss.push(Math.max(30, Math.min(75, possBase + (rnd() - 0.5) * 16)));
  for (const [side, lam] of [[0, lS], [1, lO]]) {
    const pShot = lam / 0.115 / 90;
    if (rnd() < pShot) shot(side, stamp);
    if (rnd() < 5 / 90 / 2) { m.st.corners[side]++; }
  }
  // cards and injuries
  for (const side of [0, 1]) if (rnd() < 1.9 / 90) card(side, stamp);
  if (rnd() < 0.12 / 90) injury(stamp);
  if (m.min === endHalf) {
    if (m.half === 1) { m.half = 2; m.min = 45; push('ht', 'HT', `Half-time: Spurs ${m.score[0]}–${m.score[1]} ${G.ctx.f.opponent}. Make changes or carry on.`); m.paused = true; }
    else { m.done = true; push('ft', 'FT', `Full-time: Spurs ${m.score[0]}–${m.score[1]} ${G.ctx.f.opponent}.`); finish(); }
  }
}

function push(type, minute, text, side = null) { G.match.events.unshift({ type, minute, text, side }); }
const onPitch = (list) => list.filter((x) => !x.sentOff && x.player);
function shot(side, stamp) {
  const m = G.match; const team = side === 0 ? m.xi : m.opp;
  const outfield = onPitch(team).filter((x) => x.player.pos !== 'GK');
  const shooter = pickW(outfield, (x) => Math.sqrt(Math.max(0, x.player.per90?.xg ?? { DEF: 0.04, MID: 0.12, FWD: 0.3 }[x.player.pos])) + 0.08);
  const xg = shotXg(); m.st.shots[side]++; m.st.xg[side] += xg; if (side === 0) shooter.sh++;
  const goal = rnd() < xg; const onT = goal || rnd() < 0.3 + xg * 0.4;
  if (onT) m.st.sot[side]++;
  const nm = esc(shooter.player.name); const tn = side === 0 ? 'Spurs' : esc(G.ctx.f.opponent);
  if (goal) {
    m.score[side]++; shooter.g++; shooter.rating += 1.1;
    let ast = null;
    if (rnd() < 0.72) { const others = outfield.filter((x) => x !== shooter); if (others.length) { ast = pickW(others, (x) => Math.sqrt(Math.max(0, x.player.per90?.xa ?? 0.05)) + 0.06); ast.a++; ast.rating += 0.7; } }
    push('goal', stamp, `GOAL! ${nm} scores for ${tn}${ast ? `, set up by ${esc(ast.player.name)}` : ''}. ${xg > 0.35 ? 'A big chance taken.' : xg < 0.06 ? 'What a strike from distance!' : 'Finished well.'} (${m.score[0]}–${m.score[1]})`, side);
    for (const x of onPitch(side === 0 ? m.opp : m.xi)) if (x.player.pos === 'GK' || x.player.pos === 'DEF') x.rating -= 0.25;
  } else if (xg > 0.3) {
    push('chance', stamp, onT ? `Big chance! ${nm}'s effort is saved.` : `Big chance! ${nm} should score but it goes wide.`, side);
    if (onT) { const gk = onPitch(side === 0 ? m.opp : m.xi).find((x) => x.player.pos === 'GK'); if (gk) gk.rating += 0.35; }
  } else if (onT && rnd() < 0.5) push('shot', stamp, `${nm} tests the keeper.`, side);
}
function card(side, stamp) {
  const m = G.match; const team = onPitch(side === 0 ? m.xi : m.opp).filter((x) => x.player.pos !== 'GK');
  if (!team.length) return;
  const p = pickW(team, (x) => (x.player.per90?.tackles ?? 1) + (x.player.pos === 'DEF' ? 0.6 : x.player.pos === 'MID' ? 0.5 : 0.2));
  p.yc++; m.st.yc[side]++; p.rating -= 0.3;
  if (p.yc === 2) { p.sentOff = true; p.rating -= 1; push('red', stamp, `Second yellow! ${esc(p.player.name)} is sent off. ${side === 0 ? 'Spurs are down to ten.' : `${esc(G.ctx.f.opponent)} are down to ten.`}`, side); if (side === 1) m.oppMen--; }
  else push('yellow', stamp, `Yellow card for ${esc(p.player.name)}.`, side);
}
function injury(stamp) {
  const m = G.match; const p = pickW(onPitch(m.xi), () => 1);
  p.injured = true; p.energy = 0.55;
  push('injury', stamp, `${esc(p.player.name)} is down injured and struggling. Pause to make a substitution.`, 0);
  if (m.subsLeft > 0) m.paused = true;
}

function finish() {
  const m = G.match; const r = m.score[0] > m.score[1] ? 'W' : m.score[0] < m.score[1] ? 'L' : 'D';
  for (const x of m.xi.concat(m.gone)) { if (!x.player) continue; x.rating += (r === 'W' ? 0.4 : r === 'L' ? -0.4 : 0) + (rnd() - 0.5) * 0.6; if (x.player.pos !== 'GK' && x.player.pos !== 'FWD' && m.score[1] === 0) x.rating += 0.5; x.rating = Math.max(4.5, Math.min(10, x.rating)); }
  const st = load(); const h = st.history || [];
  h.unshift({ at: new Date().toISOString(), match: G.ctx.f.id, opp: G.ctx.f.opponent, home: G.ctx.f.home, s: m.score, r, form: G.form, press: G.press, ment: G.ment });
  save({ ...st, history: h.slice(0, 50) });
}

// ---------- Match view ----------
function renderMatch() {
  const m = G.match; const f = G.ctx.f; const v = document.getElementById('view');
  const clock = m.done ? 'FT' : m.half === 1 && m.min > 45 ? `45+${m.min - 45}′` : m.half === 2 && m.min > 90 ? `90+${m.min - 90}′` : m.paused && m.min === 45 ? 'HT' : `${m.min}′`;
  const poss = m.st.poss.length ? Math.round(m.st.poss.reduce((a, b) => a + b, 0) / m.st.poss.length) : 50;
  const row = (l, a, b, dp = 0) => `<div class="mg-st"><strong>${typeof a === 'number' ? a.toFixed(dp) : a}</strong><span>${l}</span><strong>${typeof b === 'number' ? b.toFixed(dp) : b}</strong></div>`;
  const L = f.home ? ['Spurs', f.opponent] : [f.opponent, 'Spurs']; const sc = f.home ? m.score : [m.score[1], m.score[0]];
  const ico = { goal: '⚽', chance: '❗', shot: '🎯', yellow: '🟨', red: '🟥', injury: '🩹', sub: '🔁', ht: '⏸', ft: '🏁', tac: '📋' };
  const all = m.xi.concat(m.gone || []).filter((x) => x.player);
  const motm = m.done ? all.slice().sort((a, b) => b.rating - a.rating)[0] : null;
  const real = m.done && G.ctx.f.score ? G.ctx.f.score : null;
  v.innerHTML = `<div class="section-head"><h1>Manager mode</h1><span class="label-analysis">Game · just for fun</span></div>
  <section class="panel mgr-score"><div class="mgr-sb"><span>${esc(L[0])}</span><strong>${sc[0]} – ${sc[1]}</strong><span>${esc(L[1])}</span></div><div class="mgr-clock">${clock}${!m.done && !m.paused ? ' <span class="live-pill">LIVE</span>' : ''}</div>
    <div class="mgr-ctrl">${m.done ? '<button class="btn" id="mg-again">Play again</button><a class="btn ghost" href="#/manager" id="mg-new">Change team</a>' : `<button class="btn ghost" id="mg-pause">${m.paused ? '▶ Resume' : '⏸ Pause & manage'}</button><div class="seg" id="mg-speed">${[1, 3, 'skip'].map((sp) => `<button data-sp="${sp}" aria-pressed="${m.speed === sp}">${sp === 'skip' ? 'Skip to end' : `${sp}×`}</button>`).join('')}</div>`}</div></section>
  ${m.paused && !m.done ? manageHtml() : ''}
  ${m.done ? `<section class="panel section"><h2 style="margin-top:0">${{ W: 'Victory!', D: 'A draw', L: 'Defeat' }[m.score[0] > m.score[1] ? 'W' : m.score[0] < m.score[1] ? 'L' : 'D']}</h2>
    ${motm ? `<p>Player of the match: <strong>${esc(motm.player.name)}</strong> (${motm.rating.toFixed(1)})</p>` : ''}
    ${real ? `<p class="small muted">The real match finished Spurs ${real.spurs}–${real.opp} ${esc(f.opponent)}.</p>` : `<p class="small muted">The real match is on ${esc(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'short' }))} at ${esc(fmtTime(f.kickoff))}. Come back after to compare.</p>`}
    <div class="table-wrap"><table><thead><tr><th>Player</th><th class="r">Rating</th><th class="r">G</th><th class="r">A</th><th class="r">Shots</th></tr></thead><tbody>${all.slice().sort((a, b) => b.rating - a.rating).map((x) => `<tr><td>${esc(x.player.name)}${x.sentOff ? ' 🟥' : x.yc ? ' 🟨' : ''}${x.on ? ` <span class="faint tiny">(on ${x.on}′)</span>` : ''}</td><td class="r"><strong>${x.rating.toFixed(1)}</strong></td><td class="r">${x.g || ''}</td><td class="r">${x.a || ''}</td><td class="r">${x.sh || ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
  <div class="mgr-grid section"><div class="panel"><h3 style="margin-top:0">Commentary</h3><div class="mg-feed">${m.events.map((e) => `<div class="mg-ev ${e.type}${e.side === 1 ? ' opp' : ''}"><span class="mg-min">${e.minute}${/^\d/.test(e.minute) ? '′' : ''}</span><span>${ico[e.type] || '·'} ${e.text}</span></div>`).join('') || '<p class="small muted">Kick-off…</p>'}</div></div>
    <div class="panel"><h3 style="margin-top:0">Match stats</h3>
      <div class="mg-st head"><strong>Spurs</strong><span></span><strong>${esc(f.opponent)}</strong></div>
      ${row('Possession %', poss, 100 - poss)}${row('Shots', m.st.shots[0], m.st.shots[1])}${row('On target', m.st.sot[0], m.st.sot[1])}${row('xG', m.st.xg[0], m.st.xg[1], 2)}${row('Corners', m.st.corners[0], m.st.corners[1])}${row('Yellow cards', m.st.yc[0], m.st.yc[1])}
      <p class="tiny faint" style="margin-top:8px">${esc(G.form)} · ${esc(PRESS[G.press].label)} · ${esc(MENT[G.ment].label)} · subs left ${m.subsLeft}</p></div></div>
  <p class="source">A game. Each minute the engine draws shots from both teams' expected goals, which start from the site's real forecast and move with your XI, tactics, fatigue, cards and the score. Shooters and creators are weighted by their real xG and xA per 90.</p>`;
  bindMatch();
}

function manageHtml() {
  const m = G.match; const used = new Set(m.xi.map((x) => x.player?.id).concat(m.used));
  const bench = G.ctx.avail.filter((p) => !used.has(p.id)).sort((a, b) => b.r.ovr - a.r.ovr);
  return `<section class="panel section mgr-manage"><h3 style="margin-top:0">Team talk</h3>
    <div class="mgr-ctl"><label class="small muted">Pressing</label><div class="seg" id="mg-press2">${Object.entries(PRESS).map(([k, v]) => `<button data-v="${k}" aria-pressed="${k === G.press}">${v.label}</button>`).join('')}</div></div>
    <div class="mgr-ctl"><label class="small muted">Mentality</label><div class="seg" id="mg-ment2">${Object.entries(MENT).map(([k, v]) => `<button data-v="${k}" aria-pressed="${k === G.ment}">${v.label}</button>`).join('')}</div></div>
    <h3>Substitutions <span class="muted small">(${m.subsLeft} left)</span></h3>
    ${m.subsLeft ? `<p class="small muted" style="margin-top:0">Tap a player to take off, then one to bring on.</p>
    <div class="mgr-subs"><div class="mg-list" id="mg-off">${m.xi.map((x, i) => (x.player && !x.sentOff ? `<button class="mg-row pick${G.subOff === i ? ' on' : ''}" data-off="${i}"><span class="mg-pos ${x.player.pos}">${x.slot.label}</span><span>${esc(x.player.name)}${x.injured ? ' 🩹' : ''}${x.yc ? ' 🟨' : ''}</span><span class="mg-energy" title="Energy"><i style="width:${Math.round(x.energy * 100)}%"></i></span></button>` : '')).join('')}</div>
    <div class="mg-list" id="mg-on">${bench.map((p) => `<button class="mg-row pick" data-on="${p.id}" ${G.subOff === undefined ? 'disabled' : ''}><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)}</span><strong>${G.subOff !== undefined ? ratingIn(p, m.xi[G.subOff].slot) : p.r.ovr}</strong></button>`).join('')}</div></div>` : '<p class="small muted">No substitutions left.</p>'}
    <button class="btn" id="mg-resume" style="margin-top:12px">▶ Resume match</button></section>`;
}

function bindMatch() {
  const m = G.match; const $ = (id) => document.getElementById(id);
  $('mg-pause')?.addEventListener('click', () => { m.paused = !m.paused; G.subOff = undefined; if (!m.paused) tick(); else { clearTimeout(G.timer); renderMatch(); } });
  $('mg-resume')?.addEventListener('click', () => { m.paused = false; G.subOff = undefined; tick(); });
  $('mg-speed')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; m.speed = b.dataset.sp === 'skip' ? 'skip' : Number(b.dataset.sp); if (!m.paused) tick(); else renderMatch(); });
  const tac = (id, key) => $(id)?.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b || G[key] === b.dataset.v) return; G[key] = b.dataset.v; push('tac', m.min, `Instruction from the touchline: ${key === 'press' ? PRESS[G.press].label : MENT[G.ment].label}.`, 0); renderMatch(); });
  tac('mg-press2', 'press'); tac('mg-ment2', 'ment');
  $('mg-off')?.addEventListener('click', (e) => { const b = e.target.closest('[data-off]'); if (!b) return; G.subOff = Number(b.dataset.off); renderMatch(); });
  $('mg-on')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-on]'); if (!b || G.subOff === undefined) return;
    const x = m.xi[G.subOff]; const p = G.ctx.avail.find((q) => q.id === b.dataset.on);
    m.used.push(x.player.id); m.gone.push(x);
    push('sub', m.min, `Substitution: ${esc(p.name)} replaces ${esc(x.player.name)}.`, 0);
    m.xi[G.subOff] = { player: p, slot: x.slot, energy: 1, on: m.min, yc: 0, sentOff: false, g: 0, a: 0, sh: 0, rating: 6.3 };
    m.subsLeft--; G.subOff = undefined; renderMatch();
  });
  $('mg-again')?.addEventListener('click', () => startMatch());
}
