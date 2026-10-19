// Match and season forecasts (model v2).
//
// Team strength: each club gets an attack and a defence rating, built from
//  1. a long-term prior: last season's end-of-season Elo rating (promoted clubs get a
//     typical promoted-team rating), converted to attack/defence multipliers; and
//  2. this season's xG created and conceded per league match, with recent matches
//     weighted more (60-day half-life).
// The two are blended like a weighted average: the prior counts as PRIOR_MATCHES games,
// so it dominates after a few weeks and fades as real matches accumulate.
// Team news: a club missing players who produce much of its xG/xA (or its defensive work)
// is weakened for its next fixtures.
// Scores: Poisson goals with the Dixon–Coles correction for low scores (draws).
// Season: remaining fixtures played 10,000 times; each run draws slightly different team
// strengths to reflect how uncertain the ratings are. Fixed random seed per data state.
import { num } from '../lib/validate.js';
import { round } from './stats.js';

const HOME_ADV_PRIOR = 1.12;
export const PRIOR_MATCHES = 10;
const HALF_LIFE_DAYS = 60;
const SIMS = 10000;
const RHO = -0.08;            // Dixon–Coles low-score correlation
const ELO_PER_E = 800;        // Elo points per factor e in goal ratio (split between attack and defence)

// ---- Priors from last season's Elo ----
export function priorFromElo(teams, elo) {
  const vals = teams.map((t) => elo?.[t.code]).filter((v) => Number.isFinite(v));
  if (vals.length < 10) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  const promoted = sorted.slice(0, 3).reduce((a, b) => a + b, 0) / 3 - 25; // just below last season's bottom three
  const all = teams.map((t) => (Number.isFinite(elo?.[t.code]) ? elo[t.code] : promoted));
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const out = new Map();
  teams.forEach((t, i) => {
    const s = (all[i] - mean) / ELO_PER_E;
    out.set(t.id, { att: Math.exp(s), def: Math.exp(-s), elo: Math.round(all[i]), promoted: !Number.isFinite(elo?.[t.code]) });
  });
  return out;
}

// Kick-off time for each league match row (rows carry team codes; FPL fixtures carry ids).
function kickoffIndex(fplFixtures, teams) {
  const idByCode = new Map(teams.map((t) => [Number(t.code), t.id]));
  const ko = new Map(fplFixtures.map((f) => [`${num(f.team_h)}-${num(f.team_a)}`, f.kickoff_time]));
  return (m) => ko.get(`${idByCode.get(num(m.home_team))}-${idByCode.get(num(m.away_team))}`) || null;
}

// Ratings from league matches played before `asOf` (all of them when asOf is null).
export function ratings(leagueMatches, teams, { prior = null, fplFixtures = [], now = new Date(), asOf = null, absences = null } = {}) {
  const koOf = kickoffIndex(fplFixtures, teams);
  const seen = new Set(); const by = new Map(); let hx = 0; let ax = 0; let n = 0;
  const ref = asOf ? asOf.getTime() : now.getTime();
  for (const m of leagueMatches) {
    if (seen.has(m.match_id)) continue; seen.add(m.match_id);
    const h = num(m.home_expected_goals_xg); const a = num(m.away_expected_goals_xg);
    if (h === null || a === null) continue;
    const ko = koOf(m); const t = ko ? Date.parse(ko) : null;
    if (asOf && (t === null || t >= ref)) continue;
    const w = t === null ? 1 : 0.5 ** (Math.max(0, ref - t) / 86400e3 / HALF_LIFE_DAYS);
    hx += h; ax += a; n++;
    for (const [code, f, ag] of [[num(m.home_team), h, a], [num(m.away_team), a, h]]) {
      if (code === null) continue;
      const r = by.get(code) || { w: 0, xg: 0, xga: 0, n: 0 };
      r.w += w; r.xg += w * f; r.xga += w * ag; r.n++; by.set(code, r);
    }
  }
  const avg = n ? (hx + ax) / (2 * n) : 1.4;
  // Home advantage from the season's xG, pulled towards the long-run figure.
  const homeAdv = n ? Math.sqrt(((hx / n) / (ax / n) * n + HOME_ADV_PRIOR ** 2 * 60) / (n + 60)) : HOME_ADV_PRIOR;
  const out = new Map();
  for (const t of teams) {
    const r = by.get(Number(t.code)) || { w: 0, xg: 0, xga: 0, n: 0 };
    const p = prior?.get(t.id) || { att: 1, def: 1 };
    let att = (r.xg / avg + PRIOR_MATCHES * p.att) / (r.w + PRIOR_MATCHES);
    let def = (r.xga / avg + PRIOR_MATCHES * p.def) / (r.w + PRIOR_MATCHES);
    const ab = absences?.get(t.id) || null;
    const priorShare = PRIOR_MATCHES / (r.w + PRIOR_MATCHES);
    out.set(t.id, { att, def, baseAtt: att, baseDef: def, matches: r.n, effMatches: round(r.w, 1), priorShare: round(priorShare, 2), absence: ab,
      sd: 0.55 / Math.sqrt(r.w + PRIOR_MATCHES), elo: prior?.get(t.id)?.elo ?? null,
      xgPer: r.n ? round(r.xg / r.w, 2) : null, xgaPer: r.n ? round(r.xga / r.w, 2) : null });
    if (ab) { att *= ab.attMult; def *= ab.defMult; out.get(t.id).att = att; out.get(t.id).def = def; }
  }
  return { ratings: out, leagueAvg: avg, homeAdv, priorUsed: Boolean(prior), matches: n };
}

// Team news: share of a club's attacking output (xG+xA) and defensive work missing.
export function absencesFrom(elements, teams) {
  const out = new Map();
  for (const t of teams) {
    const squad = elements.filter((e) => num(e.team) === t.id && num(e.minutes) > 0);
    const tot = (k) => squad.reduce((a, e) => a + (num(e[k]) || 0), 0);
    const att = tot('expected_goals') + tot('expected_assists'); const dfn = tot('defensive_contribution') || tot('clearances_blocks_interceptions');
    const out_ = squad.filter((e) => ['i', 's'].includes(e.status) || (e.status === 'd' && (num(e.chance_of_playing_next_round) ?? 100) <= 25));
    const mAtt = att ? out_.reduce((a, e) => a + (num(e.expected_goals) || 0) + (num(e.expected_assists) || 0), 0) / att : 0;
    const mDef = dfn ? out_.reduce((a, e) => a + (num(e.defensive_contribution) || num(e.clearances_blocks_interceptions) || 0), 0) / dfn : 0;
    if (mAtt < 0.05 && mDef < 0.05) continue;
    // A replacement covers much of the gap, so only part of the missing share is lost.
    out.set(t.id, { attMult: 1 - Math.min(0.15, mAtt * 0.35), defMult: 1 + Math.min(0.12, mDef * 0.3), missingAttShare: round(mAtt, 2), missingDefShare: round(mDef, 2), players: out_.map((e) => e.web_name) });
  }
  return out;
}

// ov: confirmed line-up multipliers for this fixture ({ home: {attMult, defMult}, away: {...} });
// when present they replace the injury estimate for both sides.
export function expectedGoals(R, homeId, awayId, neutral = false, ov = null) {
  const h = R.ratings.get(homeId); const a = R.ratings.get(awayId);
  if (!h || !a) return null;
  const adv = neutral ? 1 : (R.homeAdv || HOME_ADV_PRIOR);
  const hA = ov ? h.baseAtt * ov.home.attMult : h.att; const hD = ov ? h.baseDef * ov.home.defMult : h.def;
  const aA = ov ? a.baseAtt * ov.away.attMult : a.att; const aD = ov ? a.baseDef * ov.away.defMult : a.def;
  return { home: R.leagueAvg * hA * aD * adv, away: (R.leagueAvg * aA * hD) / adv };
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
const tau = (i, j, lh, la) => (i === 0 && j === 0 ? 1 - lh * la * RHO : i === 0 && j === 1 ? 1 + lh * RHO : i === 1 && j === 0 ? 1 + la * RHO : i === 1 && j === 1 ? 1 - RHO : 1);

// Full scoreline grid (0–7 goals each) with the Dixon–Coles correction.
export function scoreGrid(lh, la, max = 7) {
  const g = []; let tot = 0;
  for (let i = 0; i <= max; i++) { g.push([]); for (let j = 0; j <= max; j++) { const p = Math.max(0, pois(i, lh) * pois(j, la) * tau(i, j, lh, la)); g[i].push(p); tot += p; } }
  return g.map((r) => r.map((p) => p / tot));
}

export function matchProbabilities(lh, la) {
  const g = scoreGrid(lh, la);
  let w = 0; let d = 0; let l = 0; const scores = []; let over25 = 0; let btts = 0;
  g.forEach((r, i) => r.forEach((p, j) => { if (i > j) w += p; else if (i === j) d += p; else l += p; scores.push({ h: i, a: j, p }); if (i + j > 2) over25 += p; if (i > 0 && j > 0) btts += p; }));
  scores.sort((x, y) => y.p - x.p);
  return { home: w, draw: d, away: l, over25, btts, likelyScores: scores.slice(0, 5).map((s) => ({ ...s, p: round(s.p * 100, 1) })), grid: g.slice(0, 6).map((r) => r.slice(0, 6).map((p) => round(p * 100, 1))) };
}

// Deterministic PRNG (mulberry32) seeded from the fixture state.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisSample(l, r) { const L = Math.exp(-l); let k = 0; let p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
function gauss(r) { const u = 1 - r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// Dixon–Coles score sampling by rejection: draw independent Poisson goals, keep with prob tau/tauMax.
function sampleScore(lh, la, r) {
  const tmax = Math.max(1, 1 - lh * la * RHO, 1 + lh * RHO, 1 + la * RHO, 1 - RHO);
  for (let k = 0; k < 20; k++) { const i = poisSample(lh, r); const j = poisSample(la, r); if (r() * tmax <= tau(i, j, lh, la)) return [i, j]; }
  return [poisSample(lh, r), poisSample(la, r)];
}

export function simulateSeason({ table, fplFixtures, teams, R, spursId, now = new Date(), overrides = new Map() }) {
  const remaining = fplFixtures.filter((f) => !(f.finished || f.finished_provisional));
  const seedStr = `${remaining.length}-${table.map((r) => `${r.teamId}:${r.points}:${r.gd}`).join(',')}`;
  let seed = 0; for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const ids = teams.map((t) => t.id);
  const posCount = new Map(ids.map((id) => [id, new Array(ids.length).fill(0)]));
  const ptsSum = new Map(ids.map((id) => [id, 0]));
  const soon = now.getTime() + 14 * 86400e3; // team news applies to the next fortnight
  const fx = remaining.map((f) => ({ h: num(f.team_h), a: num(f.team_a), news: f.kickoff_time && Date.parse(f.kickoff_time) < soon, ov: overrides.get(`${num(f.team_h)}-${num(f.team_a)}`) || null })).filter((f) => R.ratings.has(f.h) && R.ratings.has(f.a));
  const base = new Map(table.map((t) => [t.teamId, { pts: t.points, gd: t.gd, gf: t.gf }]));
  const adv = R.homeAdv || HOME_ADV_PRIOR;
  for (let s = 0; s < SIMS; s++) {
    // This run's team strengths: the ratings plus a random error of the right size.
    const str = new Map(ids.map((id) => { const q = R.ratings.get(id); const ea = Math.exp(q.sd * gauss(r)); const ed = Math.exp(q.sd * gauss(r)); return [id, { att: q.baseAtt * ea, def: q.baseDef * ed, attN: q.att * ea, defN: q.def * ed }]; }));
    const st = new Map([...base].map(([k, v]) => [k, { ...v }]));
    for (const f of fx) {
      const H = str.get(f.h); const A = str.get(f.a);
      let lh; let la;
      if (f.ov) { lh = R.leagueAvg * H.att * f.ov.home.attMult * A.def * f.ov.away.defMult * adv; la = (R.leagueAvg * A.att * f.ov.away.attMult * H.def * f.ov.home.defMult) / adv; }
      else { lh = R.leagueAvg * (f.news ? H.attN : H.att) * (f.news ? A.defN : A.def) * adv; la = (R.leagueAvg * (f.news ? A.attN : A.att) * (f.news ? H.defN : H.def)) / adv; }
      const [hg, ag] = sampleScore(lh, la, r);
      const SH = st.get(f.h); const SA = st.get(f.a);
      SH.gd += hg - ag; SA.gd += ag - hg; SH.gf += hg; SA.gf += ag;
      if (hg > ag) SH.pts += 3; else if (hg < ag) SA.pts += 3; else { SH.pts++; SA.pts++; }
    }
    const order = ids.slice().sort((x, y) => st.get(y).pts - st.get(x).pts || st.get(y).gd - st.get(x).gd || st.get(y).gf - st.get(x).gf || r() - 0.5);
    order.forEach((id, i) => { posCount.get(id)[i]++; ptsSum.set(id, ptsSum.get(id) + st.get(id).pts); });
  }
  const n = ids.length;
  const summary = teams.map((t) => {
    const pc = posCount.get(t.id).map((c) => c / SIMS);
    const range = (a, b) => round(pc.slice(a - 1, b).reduce((x, y) => x + y, 0) * 100, 1);
    const cur = table.find((x) => x.teamId === t.id); const q = R.ratings.get(t.id);
    return {
      teamId: t.id, team: t.name, short: t.short, points: cur?.points ?? 0, played: cur?.played ?? 0, position: cur?.position ?? null,
      expectedPoints: round(ptsSum.get(t.id) / SIMS, 1), positions: pc.map((p) => round(p * 100, 2)),
      title: range(1, 1), top4: range(1, 4), top6: range(1, 6), topHalf: range(1, n / 2), relegation: range(n - 2, n),
      attack: round(q?.baseAtt ?? 1, 2), defence: round(q?.baseDef ?? 1, 2), elo: q?.elo ?? null, priorShare: q?.priorShare ?? null,
      absence: q?.absence ? { players: q.absence.players, attLoss: round((1 - q.absence.attMult) * 100, 0), defLoss: round((q.absence.defMult - 1) * 100, 0) } : null,
    };
  }).sort((a, b) => b.expectedPoints - a.expectedPoints);
  const spurs = summary.find((x) => x.teamId === spursId);
  return { sims: SIMS, remainingFixtures: fx.length, teams: summary, spurs, homeAdvantage: round(adv, 3), priorMatches: PRIOR_MATCHES, leagueAvgXg: round(R.leagueAvg, 2), priorUsed: R.priorUsed };
}

// Backtest: forecast every finished league match using only the matches before it, and
// score the forecasts against what happened.
export function backtest({ leagueMatches, teams, prior, fplFixtures }) {
  const koOf = kickoffIndex(fplFixtures, teams);
  const idByCode = new Map(teams.map((t) => [Number(t.code), t.id]));
  const seen = new Set(); const rows = [];
  for (const m of leagueMatches) {
    if (seen.has(m.match_id)) continue; seen.add(m.match_id);
    const ko = koOf(m); const hs = num(m.home_score); const as = num(m.away_score);
    if (!ko || hs === null || as === null) continue;
    rows.push({ m, ko, hs, as, h: idByCode.get(num(m.home_team)), a: idByCode.get(num(m.away_team)) });
  }
  rows.sort((x, y) => x.ko.localeCompare(y.ko));
  const cache = new Map(); let hits = 0; let brier = 0; let base = 0; let exact = 0; let n = 0; let ll = 0;
  const outcomes = rows.map((x) => (x.hs > x.as ? 'H' : x.hs < x.as ? 'A' : 'D'));
  const rate = { H: outcomes.filter((o) => o === 'H').length / (outcomes.length || 1), D: outcomes.filter((o) => o === 'D').length / (outcomes.length || 1), A: outcomes.filter((o) => o === 'A').length / (outcomes.length || 1) };
  const list = [];
  for (const x of rows) {
    const day = x.ko.slice(0, 10);
    if (!cache.has(day)) cache.set(day, ratings(leagueMatches, teams, { prior, fplFixtures, asOf: new Date(`${day}T00:00:00Z`) }));
    const R = cache.get(day); const xg = expectedGoals(R, x.h, x.a); if (!xg) continue;
    const p = matchProbabilities(xg.home, xg.away);
    const o = x.hs > x.as ? 'H' : x.hs < x.as ? 'A' : 'D';
    const P = { H: p.home, D: p.draw, A: p.away };
    const fav = Object.entries(P).sort((a, b) => b[1] - a[1])[0][0];
    if (fav === o) hits++;
    brier += ['H', 'D', 'A'].reduce((s, k) => s + ((k === o ? 1 : 0) - P[k]) ** 2, 0);
    base += ['H', 'D', 'A'].reduce((s, k) => s + ((k === o ? 1 : 0) - rate[k]) ** 2, 0);
    ll += -Math.log(Math.max(1e-6, P[o]));
    if (p.likelyScores[0].h === x.hs && p.likelyScores[0].a === x.as) exact++;
    n++;
    list.push({ home: x.h, away: x.a, kickoff: x.ko, score: [x.hs, x.as], p: { H: round(P.H * 100, 0), D: round(P.D * 100, 0), A: round(P.A * 100, 0) }, fav, outcome: o, top: `${p.likelyScores[0].h}–${p.likelyScores[0].a}` });
  }
  if (!n) return null;
  return { matches: n, homeRight: round(rate.H * 100, 1), favouriteRight: round((hits / n) * 100, 1), brier: round(brier / n, 3), baselineBrier: round(base / n, 3), skill: round((1 - brier / base) * 100, 1), exactScore: round((exact / n) * 100, 1), logLoss: round(ll / n, 3), recent: list.slice(-10).reverse() };
}
