// Matchday Simulator: pick a formation, XI and tactics from the real Spurs squad and play the
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
// ---------- Tactics ----------
// Each option has a base effect on Spurs' chances (f) and the opponent's (a), plus
// matchup effects computed from the real opponent profile in planEffects().
const PRESS = { low: { label: 'Low block', f: 0.94, a: 0.95, tire: 0.6, poss: -6 }, mid: { label: 'Mid press', f: 1, a: 1, tire: 1, poss: 0 }, high: { label: 'High press', f: 1.04, a: 0.98, tire: 1.7, poss: 3 } };
const MENT = { def: { label: 'Defensive', f: 0.84, a: 0.8, poss: -4 }, bal: { label: 'Balanced', f: 1, a: 1, poss: 0 }, att: { label: 'Attacking', f: 1.16, a: 1.15, poss: 4 } };
const LINE = { deep: { label: 'Deep', f: 0.96, a: 0.95, poss: -3 }, std: { label: 'Standard', f: 1, a: 1, poss: 0 }, high: { label: 'High line', f: 1.04, a: 1.0, poss: 3 } };
const TEMPO = { patient: { label: 'Patient', f: 0.98, a: 0.95, poss: 6 }, normal: { label: 'Normal', f: 1, a: 1, poss: 0 }, direct: { label: 'Direct', f: 1.0, a: 1.04, poss: -6 } };
const WIDTH = { narrow: { label: 'Narrow', f: 1, a: 0.98, poss: 0 }, bal: { label: 'Balanced', f: 1, a: 1, poss: 0 }, wide: { label: 'Wide', f: 1, a: 1.02, poss: 0 } };
const SETP = { std: { label: 'Standard', f: 1, a: 1 }, focus: { label: 'Target set pieces', f: 1.0, a: 1.02 } };
export const TACTICS = [
  ['press', 'Pressing', PRESS, 'How high and hard Spurs close down when they lose the ball.'],
  ['ment', 'Mentality', MENT, 'How many players commit forward.'],
  ['line', 'Defensive line', LINE, 'Where the back line holds: high squeezes the pitch but leaves space behind.'],
  ['tempo', 'Tempo', TEMPO, 'Patient build-up keeps the ball; direct goes forward quickly.'],
  ['width', 'Width', WIDTH, 'Wide play brings crosses; narrow play goes through the middle.'],
  ['setp', 'Set pieces', SETP, 'Extra rehearsed routines and bodies in the box for corners and free kicks.'],
];
export const DEFAULT_PLAN = { press: 'mid', ment: 'bal', line: 'std', tempo: 'normal', width: 'bal', setp: 'std', mark: 'none' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Effects stack, but with diminishing returns so no plan swings a match unrealistically.
const damp = (x) => clamp(1 + (x - 1) * 0.6, 0.72, 1.3);

// Opponent profile from the site's scouting data: value v league average for each measure.
function oppProfile(preview) {
  const P = {}; for (const r of preview?.profile || []) P[r.key] = r;
  const rel = (k) => (P[k] && P[k].value !== null && P[k].leagueAvg ? (P[k].value - P[k].leagueAvg) / P[k].leagueAvg : 0);
  return { P, rel };
}
const pctTxt = (r) => `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`;
const ordn = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// The matchup: how each option fares against this particular opponent. Returns the
// multipliers and a plain-English reason for every option, so the page can explain itself.
function planEffects(plan, ctx) {
  const { P, rel } = ctx.opp;
  const name = ctx.f.opponent;
  const why = {}; let f = 1; let a = 1; let poss = 0; let tire = 1;
  const note = (dim, opt, text, df, da) => { (why[dim] ||= {})[opt] = { text, df, da }; if (plan[dim] === opt) { f *= df; a *= da; } };
  const fact = (k, label) => (P[k] ? `${label} ${P[k].unit === '%' ? `${fmtPlain(P[k].value, 1)}%` : fmtPlain(P[k].value, 2)} (${ordn(P[k].rank)} of ${P[k].of}; league ${P[k].unit === '%' ? `${fmtPlain(P[k].leagueAvg, 1)}%` : fmtPlain(P[k].leagueAvg, 2)})` : null);
  // Pressing v their passing security and how much they go long.
  const badPass = clamp(-rel('passPct') * 1.6, -0.06, 0.1); const longBall = clamp(rel('longBallPct'), -0.3, 0.3);
  for (const [k, o] of Object.entries(PRESS)) {
    let df = o.f; let da = o.a; let text = '';
    if (k === 'high') { df *= 1 + badPass - longBall * 0.1; da *= 1 - badPass * 0.5; text = P.passPct ? `${name} complete ${fmtPlain(P.passPct.value, 1)}% of passes (${ordn(P.passPct.rank)} of ${P.passPct.of}). ${badPass > 0.03 ? 'Pressing them should force mistakes high up.' : badPass < -0.02 ? 'They pass well, so the press is easier to play through.' : 'Pressing gives a normal return.'} Costs more energy late on.` : 'Costs more energy late on.'; }
    else if (k === 'low') { text = `Concedes territory${P.possession ? `; ${name} average ${fmtPlain(P.possession.value, 1)}% possession` : ''}. Safer, but Spurs create less.`; }
    else text = 'Balanced: neither extra risk nor extra reward.';
    note('press', k, text, df, da);
  }
  // Defensive line v their counter-attacking (low possession, long balls).
  const counter = clamp(-rel('possession') * 0.8 + longBall * 0.3, 0, 0.35);
  for (const [k, o] of Object.entries(LINE)) {
    let df = o.f; let da = o.a; let text = '';
    if (k === 'high') { da *= 1 + counter * 0.45; text = counter > 0.08 ? `${name} play on the break (${fmt1(P.possession)} possession), so a high line leaves space behind: their chances rise about ${Math.round(counter * 45)}%.` : `${name} rarely counter, so a high line is fairly safe and pins them in.`; }
    else if (k === 'deep') { da *= 1 - counter * 0.15; text = `Protects the space behind${counter > 0.08 ? ` against a counter-attacking side` : ''}, but Spurs win the ball back further from goal.`; }
    else text = 'The usual distance between the lines.';
    note('line', k, text, df, da);
  }
  // Tempo v their pressing: direct play beats a heavy press; patience suits a low block.
  const pressHeavy = clamp(-rel('ppda'), -0.3, 0.4); const sitDeep = clamp(-rel('fieldTilt'), 0, 0.5);
  for (const [k, o] of Object.entries(TEMPO)) {
    let df = o.f; let da = o.a; let text = '';
    if (k === 'direct') { df *= 1 + pressHeavy * 0.25 - sitDeep * 0.1; text = P.ppda ? `${name}'s pressing: ${fmtPlain(P.ppda.value, 1)} passes allowed per action (${ordn(P.ppda.rank)} most intense). ${pressHeavy > 0.05 ? 'Going long early skips their press.' : sitDeep > 0.1 ? 'They sit deep, so there is little space to run into.' : 'A normal return.'}` : 'Skips midfield; gives the ball back more often.'; }
    else if (k === 'patient') { df *= 1 + sitDeep * 0.08 - pressHeavy * 0.08; text = sitDeep > 0.1 ? `${name} sit deep (only ${fmt1(P.fieldTilt)} of the passing happens in their attacking half): patience moves them around until gaps open.` : 'Keeps the ball and limits their chances, with fewer shots for Spurs.'; }
    else text = 'Mixes short and long passing.';
    note('tempo', k, text, df, da);
  }
  // Width v their aerial strength; narrow v how many big chances they give up.
  const weakAir = clamp(-rel('aerialPct') * 1.5, -0.1, 0.12); const leaky = clamp(rel('bigChancesAgainst') * 0.3, -0.06, 0.08);
  for (const [k, o] of Object.entries(WIDTH)) {
    let df = o.f; let da = o.a; let text = '';
    if (k === 'wide') { df *= 1 + weakAir; text = P.aerialPct ? `${name} win ${fmtPlain(P.aerialPct.value, 1)}% of aerial duels (${ordn(P.aerialPct.rank)} of ${P.aerialPct.of}). ${weakAir > 0.03 ? 'Crosses should find heads.' : weakAir < -0.03 ? 'They are strong in the air; crosses are less likely to pay off.' : 'Crossing gives a normal return.'}` : 'More crosses into the box.'; }
    else if (k === 'narrow') { df *= 1 + leaky; text = P.bigChancesAgainst ? `${name} give up ${fmtPlain(P.bigChancesAgainst.value, 2)} big chances a game. ${leaky > 0.02 ? 'Combining through the middle should open them up.' : 'They are hard to play through centrally.'}` : 'Combinations through the middle.'; }
    else text = 'Uses the whole pitch.';
    note('width', k, text, df, da);
  }
  // Set pieces v how much set-piece xG they concede.
  const spWeak = clamp(rel('xgSetPlayAgainst') * 0.12 + 0.02, -0.03, 0.08);
  note('setp', 'focus', P.xgSetPlayAgainst ? `${name} concede ${fmtPlain(P.xgSetPlayAgainst.value, 2)} set-piece xG a game (${ordn(P.xgSetPlayAgainst.rank)} best of ${P.xgSetPlayAgainst.of}). ${spWeak > 0.03 ? 'A real chance to score from corners.' : 'They defend set pieces well.'}` : 'More danger from corners.', SETP.focus.f * (1 + spWeak), SETP.focus.a);
  note('setp', 'std', 'Normal set-piece preparation.', 1, 1);
  // Man-marking their most dangerous player.
  const dm = ctx.preview?.dangerMen?.[0];
  if (dm) {
    const tot = (ctx.preview.dangerMen || []).reduce((x, d) => x + (d.xg || 0) + (d.xa || 0), 0) || 1;
    const share = ((dm.xg || 0) + (dm.xa || 0)) / tot;
    note('mark', 'man', `${dm.name} produces ${Math.round(share * 100)}% of their top attackers' xG+xA. Man-marking him cuts their threat; it costs Spurs a little going forward.`, 0.97, 1 - 0.22 * share);
    note('mark', 'none', 'Zonal marking: everyone defends space.', 1, 1);
  }
  for (const [dim, T] of [['press', PRESS], ['ment', MENT], ['line', LINE], ['tempo', TEMPO], ['width', WIDTH]]) { poss += T[plan[dim]]?.poss || 0; }
  for (const [k, o] of Object.entries(MENT)) note('ment', k, k === 'att' ? 'More shots for both teams.' : k === 'def' ? 'Fewer chances at both ends.' : 'Normal risk.', o.f, o.a);
  tire = PRESS[plan.press].tire * (plan.line === 'high' ? 1.1 : 1);
  return { f: damp(f), a: damp(a), poss, tire, why, marked: plan.mark === 'man' && dm ? dm.name : null, dangerMan: dm || null };
}
const fmt1 = (r) => (r ? `${fmtPlain(r.value, 1)}%` : '');

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

// ---------- Natural roles ----------
// The data only gives broad positions (DEF/MID/FWD). These are the roles each player
// is known to play; a natural role gets the full rating, another role in his line 88%,
// and a different line 80%. Players not listed keep their broad position.
const ROLES = {
  Gray: ['RB', 'CM', 'DM'], 'Pedro Porro': ['RB'], Udogie: ['LB'], 'Van de Ven': ['CB', 'LB'], 'Van Hecke': ['CB'], Senesi: ['CB', 'LB'], Tosin: ['CB'], Davies: ['LB', 'CB'],
  Tonali: ['CM', 'DM'], Bentancur: ['CM', 'DM'], Gallagher: ['AM', 'CM', 'DM'], Bergvall: ['CM', 'AM'], Maddison: ['AM', 'CM'], Xavi: ['AM', 'LW'],
  Kudus: ['RW', 'AM', 'RWB'], Kulusevski: ['RW', 'AM'], Odobert: ['LW', 'RW'], Mudryk: ['LW'], 'Sávio': ['RW', 'LW'], Tel: ['LW', 'ST'], Solanke: ['ST'], Marmoush: ['ST', 'LW'],
};
const ROLE_OF = { LWB: 'LB', RWB: 'RB', LM: 'LW', RM: 'RW' };
const slotRole = (slot) => ROLE_OF[slot.label] || slot.label;
const naturalIn = (player, slot) => { const r = ROLES[player.name] || []; return r.includes(slot.label) || r.includes(slotRole(slot)); }; // e.g. a wing-back slot accepts natural wing-backs and full-backs

// Who may play where: a player with listed roles only in those roles; anyone else only
// in his broad line (defence, midfield, attack); goalkeepers only in goal. If injuries
// leave a position with nobody eligible, the broad line is allowed for that position.
const eligibleStrict = (p, slot) => {
  if ((p.pos === 'GK') !== slot.pos.includes('GK')) return false;
  return ROLES[p.name] ? naturalIn(p, slot) : slot.pos.includes(p.pos);
};
const eligibleFor = (slot, players) => { const strict = players.filter((p) => eligibleStrict(p, slot)); return strict.length ? strict : players.filter((p) => (p.pos === 'GK') === slot.pos.includes('GK') && (slot.pos.includes(p.pos) || p.pos !== 'GK')); };

// ---------- Team strength ----------
const fitPen = (player, slot) => {
  if (player.pos === 'GK' || slot.pos.includes('GK')) return player.pos === 'GK' && slot.pos.includes('GK') ? 1 : 0.3;
  if (naturalIn(player, slot)) return 1;
  const roles = ROLES[player.name];
  if (slot.pos.includes(player.pos)) return roles ? 0.85 : 0.93; // unknown exact role: small discount
  return roles ? 0.75 : 0.8;
};
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

// Best possible XI: an exact assignment (Hungarian method) maximising the total of each
// player's rating in his slot, with natural- and main-role bonuses. Only eligible players
// are considered for each slot.
function autoPick(slots, players, taken = new Set()) {
  const pool = players.filter((p) => !taken.has(p.id));
  const score = (p, sl) => p.r.ovr * fitPen(p, sl) + (naturalIn(p, sl) ? 4 : 0) + ((ROLES[p.name] || [])[0] === slotRole(sl) ? 2 : 0); // first listed role = main role
  const n = slots.length; const m = Math.max(pool.length, n);
  const BIG = 1e6;
  const elig = slots.map((sl) => new Set(eligibleFor(sl, pool).map((p) => p.id)));
  // cost[i][j]: slot i, player j (padded with dummy players that cost BIG)
  const cost = slots.map((sl, i) => Array.from({ length: m }, (_, j) => (j < pool.length && elig[i].has(pool[j].id) ? 200 - score(pool[j], sl) : BIG)));
  const u = new Array(n + 1).fill(0); const v = new Array(m + 1).fill(0); const pj = new Array(m + 1).fill(0); const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    pj[0] = i; let j0 = 0; const minv = new Array(m + 1).fill(Infinity); const usedC = new Array(m + 1).fill(false);
    do {
      usedC[j0] = true; const i0 = pj[j0]; let delta = Infinity; let j1 = 0;
      for (let j = 1; j <= m; j++) if (!usedC[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (usedC[j]) { u[pj[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (pj[j0] !== 0);
    do { const j1 = way[j0]; pj[j0] = pj[j1]; j0 = j1; } while (j0);
  }
  const out = slots.map(() => null);
  for (let j = 1; j <= m; j++) if (pj[j] && j - 1 < pool.length && cost[pj[j] - 1][j - 1] < BIG) out[pj[j] - 1] = pool[j - 1].id;
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
  const mf = await loadSeason(`matches/${f.id}.json`, state.season, { optional: true });
  const preview = mf?.preview || null;
  return { f, next, base, squad, avail, oppXi, baseStr: strength(baseXi), preview, opp: oppProfile(preview) };
}

function lambdas(ctx, xi, form, plan, extra = { f: 1, a: 1 }) {
  const st = strength(xi); const b = FORMATIONS[form].bias; const E = planEffects(plan, ctx);
  const ls = ctx.base.spurs * (st.att / ctx.baseStr.att) ** 1.6 * b[0] * E.f * extra.f;
  const lo = ctx.base.opp * (ctx.baseStr.def / st.def) ** 1.6 * b[1] * E.a * extra.a;
  return { ls: Math.max(0.15, ls), lo: Math.max(0.15, lo), st, E };
}

// ---------- View: team selection ----------
export async function managerView() {
  if (G) clearTimeout(G.timer);
  const ctx = await context();
  if (!ctx) return '<h1>Matchday Simulator</h1><div class="empty">There is no upcoming fixture to play right now.</div>';
  const saved = load();
  const form = saved.form && FORMATIONS[saved.form] ? saved.form : '4-3-3';
  let pick = Array.isArray(saved.xi) && saved.form === form ? saved.xi.map((id, i) => { const p = ctx.avail.find((q) => q.id === id); return p && eligibleFor(FORMATIONS[form].slots[i], ctx.avail).includes(p) ? id : null; }) : null;
  if (!pick || pick.length !== 11) pick = autoPick(FORMATIONS[form].slots, ctx.avail);
  const plan = { ...DEFAULT_PLAN }; for (const k of Object.keys(plan)) if (saved.plan?.[k]) plan[k] = saved.plan[k];
  G = { ctx, form, pick, plan, match: null };
  const f = ctx.f;
  const rec = saved.history || [];
  const wdl = ['W', 'D', 'L'].map((r) => rec.filter((h) => h.r === r).length);
  return `<div class="section-head"><h1>Matchday Simulator</h1><span class="label-analysis">Game · just for fun</span></div>
    <p class="lede">You're the manager. Pick the shape, the XI and the approach for Spurs' next real match, then play it minute by minute. Ratings come from each player's real stats this season; your choices change the odds.</p>
    <section class="panel mgr-fx"><div class="mgr-teams"><span>${crestImgCode(6)}<strong>Spurs</strong></span><span class="muted">${f.home ? 'v' : '@'}</span><span>${crestImgCode(state.meta.teamCodes?.[f.opponentTeamId])}<strong>${esc(f.opponent)}</strong></span></div>
      <p class="small muted" style="margin:6px 0 0">${esc(f.competition)} · ${esc(fmtDate(f.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${esc(fmtTime(f.kickoff))} Bahrain${rec.length ? ` · Your record: <strong>${wdl[0]}W ${wdl[1]}D ${wdl[2]}L</strong>` : ''}</p></section>
    <div class="mgr-grid section">
      <div>
        <div class="mgr-ctl"><label class="small muted">Formation</label><div class="seg" id="mg-form">${Object.keys(FORMATIONS).map((k) => `<button data-v="${k}" aria-pressed="${k === form}">${k}</button>`).join('')}</div></div>
        <div id="mg-tactics"></div>
        <div class="pitch" id="mg-pitch"></div>
        <div class="mgr-actions"><button class="btn ghost" id="mg-auto">Auto-pick best XI</button><button class="btn" id="mg-kick">Kick off ▶</button></div>
      </div>
      <div>
        <div class="panel" id="mg-odds"></div>
        <div class="panel section" id="mg-bench"></div>
        <p class="source">Ratings (56–96): each player's per-90 figures this season ranked against Premier League players in his position (FPL/Opta). Players with few minutes are rated from fewer games and pulled towards average. Players can only be picked in the roles they play; those whose exact role isn't known can play anywhere in their line at 93%. Injured, suspended and loaned-out players can't be picked. The match starts from the site's real forecast for this fixture (expected goals ${fmtPlain(ctx.base.spurs, 2)}–${fmtPlain(ctx.base.opp, 2)} with the strongest XI) and adjusts it for your choices.</p>
      </div>
    </div>
    <section class="section" id="mg-prep"></section>
    <div id="mg-sheet" class="mgr-sheet" hidden></div>`;
}

// ---------- Tactics controls ----------
function tacticsHtml(prefix) {
  const E = planEffects(G.plan, G.ctx);
  const rows = TACTICS.map(([dim, label, T, help]) => {
    const w = E.why[dim]?.[G.plan[dim]];
    return `<div class="mgr-ctl"><label class="small muted" title="${esc(help)}">${label}</label><div class="seg" data-dim="${dim}" id="${prefix}-${dim}">${Object.entries(T).map(([k, v]) => `<button data-v="${k}" aria-pressed="${k === G.plan[dim]}">${v.label}</button>`).join('')}</div>${w && prefix === 'mg' ? `<p class="tiny mg-why">${effTag(w)} ${esc(w.text)}</p>` : ''}</div>`;
  });
  if (E.dangerMan) {
    const w = E.why.mark?.[G.plan.mark];
    rows.push(`<div class="mgr-ctl"><label class="small muted">Marking</label><div class="seg" data-dim="mark" id="${prefix}-mark"><button data-v="none" aria-pressed="${G.plan.mark !== 'man'}">Zonal</button><button data-v="man" aria-pressed="${G.plan.mark === 'man'}">Man-mark ${esc(E.dangerMan.name)}</button></div>${w && prefix === 'mg' ? `<p class="tiny mg-why">${effTag(w)} ${esc(w.text)}</p>` : ''}</div>`);
  }
  return rows.join('');
}
// "+4% Spurs chances · −3% theirs" chip for an option's effect.
function effTag(w) {
  const pf = Math.round((w.df - 1) * 100); const pa = Math.round((w.da - 1) * 100);
  if (!pf && !pa) return '';
  return `<span class="mg-eff">${pf ? `<b class="${pf > 0 ? 'up' : 'down'}">${pf > 0 ? '+' : ''}${pf}% Spurs chances</b>` : ''}${pf && pa ? ' · ' : ''}${pa ? `<b class="${pa < 0 ? 'up' : 'down'}">${pa > 0 ? '+' : ''}${pa}% theirs</b>` : ''}</span>`;
}

// ---------- Match prep: what the data suggests ----------
const xPts = (ls, lo) => { const p = probs(ls, lo); return (3 * p.w + p.d) / 100; };
function bestPlans() {
  const dims = [['press', Object.keys(PRESS)], ['ment', Object.keys(MENT)], ['line', Object.keys(LINE)], ['tempo', Object.keys(TEMPO)], ['width', Object.keys(WIDTH)], ['setp', Object.keys(SETP)], ['mark', G.ctx.preview?.dangerMen?.length ? ['none', 'man'] : ['none']]];
  const combos = [{}];
  for (const [d, opts] of dims) { const next = []; for (const c of combos) for (const o of opts) next.push({ ...c, [d]: o }); combos.splice(0, combos.length, ...next); }
  // Each area's effect is independent, so read every option's multipliers once.
  const W = planEffects(DEFAULT_PLAN, G.ctx).why;
  const mult = (plan, key) => Object.keys(plan).reduce((acc, d) => acc * (W[d]?.[plan[d]]?.[key] ?? 1), 1);
  const results = [];
  for (const form of Object.keys(FORMATIONS)) {
    const slots = FORMATIONS[form].slots; const ids = autoPick(slots, G.ctx.avail);
    const xi = ids.map((id, i) => ({ player: G.ctx.avail.find((p) => p.id === id) || null, slot: slots[i] }));
    const base = lambdas(G.ctx, xi, form, DEFAULT_PLAN);
    for (const plan of combos) { const ls = Math.max(0.15, (base.ls / base.E.f) * damp(mult(plan, 'df'))); const lo = Math.max(0.15, (base.lo / base.E.a) * damp(mult(plan, 'da'))); results.push({ form, plan, ls, lo, xp: xPts(ls, lo) }); }
  }
  results.sort((a, b) => b.xp - a.xp);
  // Keep three genuinely different plans (different formation or at least two settings).
  const out = [];
  for (const r of results) { if (out.every((o) => o.form !== r.form || Object.keys(r.plan).filter((k) => r.plan[k] !== o.plan[k]).length >= 2)) out.push(r); if (out.length === 3) break; }
  return out;
}
const planLabel = (plan) => TACTICS.map(([dim, , T]) => T[plan[dim]].label).concat(plan.mark === 'man' && G.ctx.preview?.dangerMen?.[0] ? [`man-mark ${G.ctx.preview.dangerMen[0].name}`] : []).join(' · ');

function prepHtml() {
  const ctx = G.ctx; const { P } = ctx.opp; const name = ctx.f.opponent;
  if (!ctx.preview) return '<div class="banner info">Scouting data for this opponent is not available yet, so tactics use neutral effects.</div>';
  // One-at-a-time advice: best option in each area with everything else as you have it.
  const xi = xiFromPick(); const cur = lambdas(ctx, xi, G.form, G.plan); const curXp = xPts(cur.ls, cur.lo);
  const advice = [];
  for (const [dim, label, T] of [...TACTICS, ['mark', 'Marking', { none: { label: 'Zonal' }, man: { label: `Man-mark ${ctx.preview.dangerMen?.[0]?.name || ''}` } }]]) {
    if (dim === 'mark' && !ctx.preview.dangerMen?.length) continue;
    let best = null;
    for (const k of Object.keys(T)) { const r = lambdas(ctx, xi, G.form, { ...G.plan, [dim]: k }); const xp = xPts(r.ls, r.lo); if (!best || xp > best.xp + 1e-9) best = { k, xp }; }
    const w = planEffects({ ...G.plan, [dim]: best.k }, ctx).why[dim]?.[best.k];
    advice.push({ dim, label, opt: T[best.k].label, k: best.k, gain: best.xp - curXp, current: G.plan[dim] === best.k, text: w?.text || '' });
  }
  const plans = bestPlans(); G.plans = plans;
  const keyRows = [['possession', 'Possession'], ['passPct', 'Pass accuracy'], ['ppda', 'Pressing (lower = harder)'], ['fieldTilt', 'Territory (field tilt)'], ['xg', 'xG created'], ['xga', 'xG conceded'], ['bigChancesAgainst', 'Big chances conceded'], ['aerialPct', 'Aerial duels won'], ['xgSetPlayAgainst', 'Set-piece xG conceded'], ['longBallPct', 'Long-ball accuracy']]
    .filter(([k]) => P[k]).map(([k, l]) => { const r = P[k]; const pos = r.of ? 1 - (r.rank - 1) / (r.of - 1) : 0.5;
      return `<div class="mg-opp"><span>${l}</span><span class="v">${r.unit === '%' ? `${fmtPlain(r.value, 1)}%` : fmtPlain(r.value, 2)} <span class="faint tiny">lg ${r.unit === '%' ? `${fmtPlain(r.leagueAvg, 1)}%` : fmtPlain(r.leagueAvg, 2)}</span></span><span class="rk-chip">${ordn(r.rank)}</span><div class="mg-bar"><div style="width:${Math.round(pos * 100)}%"></div></div></div>`; }).join('');
  const dm = ctx.preview.dangerMen || [];
  return `<div class="section-head"><h2>Match prep: how Spurs should set up</h2><span class="label-analysis">From the data</span></div>
    <div class="grid two">
      <div class="panel"><h3 style="margin-top:0">${esc(name)} at a glance</h3><p class="tiny faint" style="margin:0 0 8px">Per match this season · rank among 20 clubs (1st = most, or best for "conceded")</p>${keyRows}
        ${dm.length ? `<h3>Danger men</h3>${dm.slice(0, 3).map((d) => `<div class="statrow"><span><strong>${esc(d.name)}</strong> <span class="faint tiny">${esc(d.pos)} · ${d.minutes} min</span></span><span class="v">${fmtPlain((d.xg || 0) + (d.xa || 0), 2)}<small>xG+xA</small></span></div>`).join('')}` : ''}</div>
      <div class="panel"><h3 style="margin-top:0">What the data suggests</h3><p class="tiny faint" style="margin:0 0 8px">Best option in each area, keeping the rest of your plan. Gain = extra expected points (3 for a win, 1 for a draw).</p>
        ${advice.map((a) => `<div class="mg-adv${a.current ? ' ok' : ''}"><div><strong>${esc(a.label)}: ${esc(a.opt)}</strong> ${a.current ? '<span class="mg-eff"><b class="up">✓ already set</b></span>' : `<span class="mg-eff"><b class="up">+${fmtPlain(a.gain, 2)} pts</b></span> <button class="btn ghost mg-apply" data-dim="${a.dim}" data-v="${a.k}">Use</button>`}</div><p class="tiny" style="margin:2px 0 0">${esc(a.text)}</p></div>`).join('')}</div>
    </div>
    <div class="panel section"><h3 style="margin-top:0">Best plans the model found</h3><p class="tiny faint" style="margin:0 0 8px">Every formation and tactic combination tried with the best available XI for each (${(Object.keys(FORMATIONS).length * 1458).toLocaleString()} plans).</p>
      ${plans.map((r, i) => { const pr = probs(r.ls, r.lo); return `<div class="mg-plan"><div><strong>${i + 1}. ${r.form}</strong> <span class="small muted">${esc(planLabel(r.plan))}</span></div><div class="small">Win ${pr.w}% · draw ${pr.d}% · lose ${pr.l}% · <strong>${fmtPlain(r.xp, 2)} pts</strong> · xG ${fmtPlain(r.ls, 2)}–${fmtPlain(r.lo, 2)}</div><button class="btn ghost mg-useplan" data-i="${i}">Use this plan</button></div>`; }).join('')}
      <p class="tiny faint">Your current set-up: ${fmtPlain(curXp, 2)} expected points.</p></div>
    ${ctx.preview.plan?.length ? `<div class="panel section"><h3 style="margin-top:0">Scout's notes</h3><ul class="small" style="margin:0;padding-left:18px">${ctx.preview.plan.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <p class="source">Tactic effects are rules of thumb, sized from ${esc(name)}'s real numbers against the league average (FotMob data via FPL Core Insights). They make the game respond to the opponent; they are not proven effects.</p>`;
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
    const warn = p && fitPen(p, sl) < 0.9;
    return `<button class="pslot${p ? '' : ' empty'}${warn ? ' oop' : ''}" data-slot="${i}" style="left:${sl.x}%;top:${sl.y}%"><span class="pr">${r ?? '+'}</span><span class="pn">${p ? esc(p.name) : sl.label}</span><span class="pl">${sl.label}${warn ? ' ⚠' : ''}</span></button>`;
  }).join('');
  const used = new Set(G.pick);
  const bench = G.ctx.avail.filter((p) => !used.has(p.id)).sort((a, b) => b.r.ovr - a.r.ovr);
  const out = G.ctx.squad.filter((p) => p.out);
  document.getElementById('mg-bench').innerHTML = `<h3 style="margin-top:0">Bench (${bench.length})</h3><div class="mg-list">${bench.map((p) => `<div class="mg-row"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} ${tag(p)}${p.r.few ? `<span class="faint tiny"> ${p.minutes} mins</span>` : ''}</span><strong>${p.r.ovr}</strong></div>`).join('')}</div>
    ${out.length ? `<h3>Unavailable (${out.length})</h3><div class="mg-list">${out.map((p) => `<div class="mg-row" style="opacity:.6"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} <span class="tiny" style="color:var(--loss)">${esc(p.news || p.statusLabel || 'Unavailable')}</span></span><strong>—</strong></div>`).join('')}</div>` : ''}`;
  document.getElementById('mg-tactics').innerHTML = tacticsHtml('mg');
  const { ls, lo, st } = lambdas(G.ctx, xi, G.form, G.plan);
  const pr = probs(ls, lo); const base = G.ctx.next;
  const bar = (v, max) => `<div class="mg-bar"><div style="width:${Math.min(100, (v / max) * 100)}%"></div></div>`;
  document.getElementById('mg-odds').innerHTML = `<h3 style="margin-top:0">Your odds</h3>
    <div class="mg-wdl"><div style="flex:${pr.w}" class="w">Win ${pr.w}%</div><div style="flex:${pr.d}" class="d">${pr.d}%</div><div style="flex:${pr.l}" class="l">${pr.l}%</div></div>
    ${base ? `<p class="tiny faint" style="margin:4px 0 10px">Site forecast with the usual XI: win ${Math.round(base.win)}% · draw ${Math.round(base.draw)}% · lose ${Math.round(base.loss)}%</p>` : ''}
    <div class="statlist"><div class="statrow"><span>Attack</span><span class="v">${Math.round(st.att)}</span></div>${bar(st.att, 110)}
    <div class="statrow"><span>Defence</span><span class="v">${Math.round(st.def)}</span></div>${bar(st.def, 110)}
    <div class="statrow"><span>Expected goals</span><span class="v">${fmtPlain(ls, 2)} – ${fmtPlain(lo, 2)}</span></div></div>`;
  document.getElementById('mg-kick').disabled = G.pick.some((id) => !id);
  save({ ...load(), form: G.form, xi: G.pick, plan: G.plan });
  clearTimeout(G.prepT); G.prepT = setTimeout(() => { const el = document.getElementById('mg-prep'); if (el) el.innerHTML = prepHtml(); }, 30);
}
const pitchLines = () => '<div class="pl-half"></div><div class="pl-circle"></div><div class="pl-box top"></div><div class="pl-box bottom"></div>';

function openPicker(i) {
  const sl = FORMATIONS[G.form].slots[i];
  const cur = G.pick[i];
  const list = eligibleFor(sl, G.ctx.avail).sort((a, b) => ratingIn(b, sl) - ratingIn(a, sl));
  const strict = G.ctx.avail.some((p) => eligibleStrict(p, sl));
  const outHere = G.ctx.squad.filter((p) => p.out && eligibleStrict(p, sl));
  const sheet = document.getElementById('mg-sheet');
  sheet.innerHTML = `<div class="mgr-sheet-in"><div class="section-head"><h3 style="margin:0">Pick for ${sl.label}</h3><button class="btn ghost" data-close>Close</button></div>
    ${strict ? `<p class="small muted" style="margin:0 0 8px">Only players who play ${sl.label} are shown.</p>` : `<p class="small" style="margin:0 0 8px;color:var(--warn)">Nobody available plays ${sl.label} naturally, so the whole ${{ DEF: 'defence', MID: 'midfield', FWD: 'attack' }[sl.pos[0]] || 'squad'} is shown.</p>`}<div class="mg-list">${list.map((p) => { const where = G.pick.indexOf(p.id); return `<button class="mg-row pick${p.id === cur ? ' on' : ''}" data-pid="${p.id}"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} ${tag(p)}${where >= 0 && p.id !== cur ? `<span class="faint tiny"> in XI (${FORMATIONS[G.form].slots[where].label})</span>` : ''}${naturalIn(p, sl) ? '<span class="tiny" style="color:var(--win)"> natural</span>' : fitPen(p, sl) < 0.9 ? '<span class="faint tiny"> out of position</span>' : ''}</span><strong>${ratingIn(p, sl)}</strong></button>`; }).join('')}
      ${outHere.length ? `<p class="small muted" style="margin:12px 0 6px">Can't play this match:</p>${outHere.map((p) => `<div class="mg-row" style="opacity:.55"><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)} <span class="tiny" style="color:var(--loss)">${esc(p.news || p.statusLabel || 'Unavailable')}</span></span><strong>—</strong></div>`).join('')}` : ''}</div></div>`;
  sheet.hidden = false;
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) { sheet.hidden = true; return; }
    const b = e.target.closest('[data-pid]'); if (!b) return;
    const pid = b.dataset.pid; const j = G.pick.indexOf(pid);
    if (j >= 0) { const prev = G.ctx.avail.find((q) => q.id === G.pick[i]); G.pick[j] = prev && eligibleFor(FORMATIONS[G.form].slots[j], G.ctx.avail).includes(prev) ? prev.id : null; } // swap when he can play there
    G.pick[i] = pid; sheet.hidden = true; drawSetup();
  };
}

export function managerAfter() {
  if (!G) return;
  drawSetup();
  const seg = (id, key, after) => document.getElementById(id).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; G[key] = b.dataset.v; document.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute('aria-pressed', x === b)); after?.(); drawSetup(); });
  seg('mg-form', 'form', () => { G.pick = autoPick(FORMATIONS[G.form].slots, G.ctx.avail); });
  document.getElementById('mg-tactics').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); const g = e.target.closest('[data-dim]'); if (!b || !g) return; G.plan[g.dataset.dim] = b.dataset.v; drawSetup(); });
  document.getElementById('mg-prep').addEventListener('click', (e) => {
    const a = e.target.closest('.mg-apply'); if (a) { G.plan[a.dataset.dim] = a.dataset.v; drawSetup(); return; }
    const u = e.target.closest('.mg-useplan'); if (u && G.plans?.[u.dataset.i]) { const r = G.plans[u.dataset.i]; G.form = r.form; G.plan = { ...r.plan }; G.pick = autoPick(FORMATIONS[G.form].slots, G.ctx.avail);
      document.querySelectorAll('#mg-form button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === G.form)); drawSetup(); document.getElementById('mg-pitch').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
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
  const E0 = planEffects(G.plan, G.ctx); const tire = E0.tire;
  for (const x of m.xi) if (!x.sentOff) { const played = m.min - x.on; if (played > 55) x.energy = Math.max(0.78, 1 - (played - 55) * 0.0035 * tire); }
  const oppShort = { f: 0.82 ** (11 - m.oppMen), a: 1 / 0.82 ** (11 - m.oppMen) };
  const { ls, lo } = lambdas(G.ctx, m.xi, G.form, G.plan, { f: oppShort.f, a: oppShort.a });
  // game state: trailing teams push
  const diff = m.score[0] - m.score[1]; const late = mm > 65 ? 1.2 : 1;
  const lS = ls * (diff < 0 ? 1.12 * late : diff > 0 ? 0.92 : 1); const lO = lo * (diff > 0 ? 1.12 * late : diff < 0 ? 0.92 : 1);
  const possBase = 54 + E0.poss + (ls - lo) * 6;
  m.st.poss.push(Math.max(30, Math.min(75, possBase + (rnd() - 0.5) * 16)));
  for (const [side, lam] of [[0, lS], [1, lO]]) {
    const pShot = lam / 0.115 / 90;
    if (rnd() < pShot) shot(side, stamp);
    if (rnd() < (side === 0 && G.plan.setp === 'focus' ? 6 : 5) / 90 / 2) { m.st.corners[side]++; }
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
  const marked = side === 1 ? planEffects(G.plan, G.ctx).marked : null; // a man-marked danger man shoots less
  const shooter = pickW(outfield, (x) => (Math.sqrt(Math.max(0, x.player.per90?.xg ?? { DEF: 0.04, MID: 0.12, FWD: 0.3 }[x.player.pos])) + 0.08) * (marked && x.player.name === marked ? 0.45 : 1));
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
  h.unshift({ at: new Date().toISOString(), match: G.ctx.f.id, opp: G.ctx.f.opponent, home: G.ctx.f.home, s: m.score, r, form: G.form, plan: { ...G.plan } });
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
  v.innerHTML = `<div class="section-head"><h1>Matchday Simulator</h1><span class="label-analysis">Game · just for fun</span></div>
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
      <p class="tiny faint" style="margin-top:8px">${esc(G.form)} · ${esc(planLabel(G.plan))} · subs left ${m.subsLeft}</p></div></div>
  <p class="source">A game. Each minute the engine draws shots from both teams' expected goals, which start from the site's real forecast and move with your XI, tactics, fatigue, cards and the score. Shooters and creators are weighted by their real xG and xA per 90.</p>`;
  bindMatch();
}

function manageHtml() {
  const m = G.match; const used = new Set(m.xi.map((x) => x.player?.id).concat(m.used));
  const bench = G.ctx.avail.filter((p) => !used.has(p.id)).sort((a, b) => b.r.ovr - a.r.ovr);
  return `<section class="panel section mgr-manage"><h3 style="margin-top:0">Team talk</h3>
    <div id="mg-tactics2">${tacticsHtml('mg2')}</div>
    <h3>Substitutions <span class="muted small">(${m.subsLeft} left)</span></h3>
    ${m.subsLeft ? `<p class="small muted" style="margin-top:0">Tap a player to take off, then one to bring on.</p>
    <div class="mgr-subs"><div class="mg-list" id="mg-off">${m.xi.map((x, i) => (x.player && !x.sentOff ? `<button class="mg-row pick${G.subOff === i ? ' on' : ''}" data-off="${i}"><span class="mg-pos ${x.player.pos}">${x.slot.label}</span><span>${esc(x.player.name)}${x.injured ? ' 🩹' : ''}${x.yc ? ' 🟨' : ''}</span><span class="mg-energy" title="Energy"><i style="width:${Math.round(x.energy * 100)}%"></i></span></button>` : '')).join('')}</div>
    <div class="mg-list" id="mg-on">${(G.subOff !== undefined ? eligibleFor(m.xi[G.subOff].slot, bench) : bench).map((p) => `<button class="mg-row pick" data-on="${p.id}" ${G.subOff === undefined ? 'disabled' : ''}><span class="mg-pos ${p.pos}">${p.pos}</span><span>${esc(p.name)}</span><strong>${G.subOff !== undefined ? ratingIn(p, m.xi[G.subOff].slot) : p.r.ovr}</strong></button>`).join('')}</div></div>` : '<p class="small muted">No substitutions left.</p>'}
    <button class="btn" id="mg-resume" style="margin-top:12px">▶ Resume match</button></section>`;
}

function bindMatch() {
  const m = G.match; const $ = (id) => document.getElementById(id);
  $('mg-pause')?.addEventListener('click', () => { m.paused = !m.paused; G.subOff = undefined; if (!m.paused) tick(); else { clearTimeout(G.timer); renderMatch(); } });
  $('mg-resume')?.addEventListener('click', () => { m.paused = false; G.subOff = undefined; tick(); });
  $('mg-speed')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; m.speed = b.dataset.sp === 'skip' ? 'skip' : Number(b.dataset.sp); if (!m.paused) tick(); else renderMatch(); });
  $('mg-tactics2')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); const g = e.target.closest('[data-dim]'); if (!b || !g || G.plan[g.dataset.dim] === b.dataset.v) return;
    G.plan[g.dataset.dim] = b.dataset.v;
    const lab = g.dataset.dim === 'mark' ? (b.dataset.v === 'man' ? `man-mark ${planEffects(G.plan, G.ctx).dangerMan?.name}` : 'zonal marking') : `${TACTICS.find((t) => t[0] === g.dataset.dim)[1].toLowerCase()}: ${TACTICS.find((t) => t[0] === g.dataset.dim)[2][b.dataset.v].label}`;
    push('tac', m.min, `Instruction from the touchline: ${esc(lab)}.`, 0); renderMatch();
  });
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
