// Season simulator and match probabilities.
// Model: each club gets an attack and a defence rating from its xG created and conceded
// per match (FotMob match data), shrunk towards the league average so a handful of games
// cannot produce extreme ratings. Goals in a match are Poisson-distributed around
// home attack x away defence (with a home advantage) and vice versa. The remaining
// fixtures are played out many times with a fixed random seed, so unchanged data gives
// unchanged output.
import { num } from '../lib/validate.js';
import { round } from './stats.js';

const HOME_ADV = 1.12;
const PRIOR_MATCHES = 6;   // shrinkage strength (in matches) towards league average
const SIMS = 10000;

export function ratings(leagueMatches, teams) {
  const seen = new Set(); const by = new Map();
  for (const m of leagueMatches) {
    if (seen.has(m.match_id)) continue; seen.add(m.match_id);
    const hx = num(m.home_expected_goals_xg); const ax = num(m.away_expected_goals_xg);
    if (hx === null || ax === null) continue;
    for (const [code, f, a] of [[num(m.home_team), hx, ax], [num(m.away_team), ax, hx]]) {
      if (code === null) continue;
      const t = by.get(code) || { n: 0, xg: 0, xga: 0 };
      t.n++; t.xg += f; t.xga += a; by.set(code, t);
    }
  }
  const all = [...by.values()];
  const games = all.reduce((s, t) => s + t.n, 0);
  const avg = games ? all.reduce((s, t) => s + t.xg, 0) / games : 1.4;
  const out = new Map();
  for (const t of teams) {
    const r = by.get(Number(t.code)) || { n: 0, xg: 0, xga: 0 };
    const att = (r.xg + PRIOR_MATCHES * avg) / (r.n + PRIOR_MATCHES) / avg;
    const def = (r.xga + PRIOR_MATCHES * avg) / (r.n + PRIOR_MATCHES) / avg;
    out.set(t.id, { att, def, matches: r.n, xgPer: r.n ? round(r.xg / r.n, 2) : null, xgaPer: r.n ? round(r.xga / r.n, 2) : null });
  }
  return { ratings: out, leagueAvg: avg };
}

export function expectedGoals(R, homeId, awayId, neutral = false) {
  const h = R.ratings.get(homeId); const a = R.ratings.get(awayId);
  if (!h || !a) return null;
  const adv = neutral ? 1 : HOME_ADV;
  return { home: R.leagueAvg * h.att * a.def * adv, away: (R.leagueAvg * a.att * h.def) / (neutral ? 1 : HOME_ADV) };
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

export function matchProbabilities(lh, la) {
  let w = 0; let d = 0; let l = 0; const scores = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = pois(i, lh) * pois(j, la);
    if (i > j) w += p; else if (i === j) d += p; else l += p;
    scores.push({ h: i, a: j, p });
  }
  const tot = w + d + l;
  scores.sort((x, y) => y.p - x.p);
  return { home: w / tot, draw: d / tot, away: l / tot, likelyScores: scores.slice(0, 5).map((s) => ({ ...s, p: round(s.p * 100, 1) })) };
}

// Deterministic PRNG (mulberry32) seeded from the fixture state.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisSample(l, r) { const L = Math.exp(-l); let k = 0; let p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }

export function simulateSeason({ table, fplFixtures, teams, R, spursId }) {
  const remaining = fplFixtures.filter((f) => !(f.finished || f.finished_provisional));
  const seedStr = `${remaining.length}-${table.map((r) => `${r.teamId}:${r.points}:${r.gd}`).join(',')}`;
  let seed = 0; for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const ids = teams.map((t) => t.id);
  const posCount = new Map(ids.map((id) => [id, new Array(ids.length).fill(0)]));
  const ptsSum = new Map(ids.map((id) => [id, 0]));
  const fx = remaining.map((f) => ({ h: num(f.team_h), a: num(f.team_a), xg: expectedGoals(R, num(f.team_h), num(f.team_a)) })).filter((f) => f.xg);
  const base = new Map(table.map((t) => [t.teamId, { pts: t.points, gd: t.gd, gf: t.gf }]));
  for (let s = 0; s < SIMS; s++) {
    const st = new Map([...base].map(([k, v]) => [k, { ...v }]));
    for (const f of fx) {
      const hg = poisSample(f.xg.home, r); const ag = poisSample(f.xg.away, r);
      const H = st.get(f.h); const A = st.get(f.a);
      H.gd += hg - ag; A.gd += ag - hg; H.gf += hg; A.gf += ag;
      if (hg > ag) H.pts += 3; else if (hg < ag) A.pts += 3; else { H.pts++; A.pts++; }
    }
    const order = ids.slice().sort((x, y) => st.get(y).pts - st.get(x).pts || st.get(y).gd - st.get(x).gd || st.get(y).gf - st.get(x).gf || r() - 0.5);
    order.forEach((id, i) => { posCount.get(id)[i]++; ptsSum.set(id, ptsSum.get(id) + st.get(id).pts); });
  }
  const n = ids.length;
  const summary = teams.map((t) => {
    const pc = posCount.get(t.id).map((c) => c / SIMS);
    const range = (a, b) => round(pc.slice(a - 1, b).reduce((x, y) => x + y, 0) * 100, 1);
    const cur = table.find((x) => x.teamId === t.id);
    return {
      teamId: t.id, team: t.name, short: t.short, points: cur?.points ?? 0, played: cur?.played ?? 0, position: cur?.position ?? null,
      expectedPoints: round(ptsSum.get(t.id) / SIMS, 1), positions: pc.map((p) => round(p * 100, 2)),
      title: range(1, 1), top4: range(1, 4), top6: range(1, 6), topHalf: range(1, n / 2), relegation: range(n - 2, n),
      attack: round(R.ratings.get(t.id)?.att ?? 1, 2), defence: round(R.ratings.get(t.id)?.def ?? 1, 2),
    };
  }).sort((a, b) => b.expectedPoints - a.expectedPoints);
  const spurs = summary.find((x) => x.teamId === spursId);
  return { sims: SIMS, remainingFixtures: fx.length, teams: summary, spurs, homeAdvantage: HOME_ADV, priorMatches: PRIOR_MATCHES, leagueAvgXg: round(R.leagueAvg, 2) };
}
