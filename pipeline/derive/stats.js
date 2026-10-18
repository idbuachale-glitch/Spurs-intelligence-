// Pure statistical functions. Every derived figure is computed only from valid
// underlying values; anything that cannot be computed honestly is returned as null.
import { num } from '../lib/validate.js';

// Statistic dictionary shared with the website. `field` is the FPL field name.
// avail: which seasons/providers supply it (checked against real data at build time).
export const STATS = [
  // Appearance
  { key: 'minutes', field: 'minutes', label: 'Minutes', cat: 'appearance', pos: 'all' },
  { key: 'starts', field: 'starts', label: 'Starts', cat: 'appearance', pos: 'all' },
  // Attacking
  { key: 'goals', field: 'goals_scored', label: 'Goals', cat: 'attacking', pos: 'all', per90: true },
  { key: 'assists', field: 'assists', label: 'Assists', cat: 'attacking', pos: 'all', per90: true },
  { key: 'xg', field: 'expected_goals', label: 'Expected goals (xG)', cat: 'attacking', pos: 'all', per90: true, dp: 2 },
  { key: 'xa', field: 'expected_assists', label: 'Expected assists (xA)', cat: 'attacking', pos: 'all', per90: true, dp: 2 },
  { key: 'xgi', field: 'expected_goal_involvements', label: 'xG + xA', cat: 'attacking', pos: 'all', per90: true, dp: 2 },
  { key: 'penMissed', field: 'penalties_missed', label: 'Penalties missed', cat: 'attacking', pos: 'all' },
  { key: 'threat', field: 'threat', label: 'Threat index', cat: 'attacking', pos: 'all', per90: true, dp: 1, index: true },
  { key: 'creativity', field: 'creativity', label: 'Creativity index', cat: 'attacking', pos: 'all', per90: true, dp: 1, index: true },
  // Defensive
  { key: 'tackles', field: 'tackles', label: 'Tackles', cat: 'defensive', pos: 'outfield', per90: true },
  { key: 'cbi', field: 'clearances_blocks_interceptions', label: 'Clearances, blocks & interceptions', cat: 'defensive', pos: 'outfield', per90: true },
  { key: 'recoveries', field: 'recoveries', label: 'Ball recoveries', cat: 'defensive', pos: 'all', per90: true },
  { key: 'defcon', field: 'defensive_contribution', label: 'Defensive contribution (FPL)', cat: 'defensive', pos: 'outfield', per90: true },
  { key: 'xgc', field: 'expected_goals_conceded', label: 'xG conceded while on pitch', cat: 'defensive', pos: 'all', per90: true, dp: 2 },
  { key: 'gc', field: 'goals_conceded', label: 'Goals conceded while on pitch', cat: 'defensive', pos: 'all', per90: true },
  { key: 'cs', field: 'clean_sheets', label: 'Clean sheets (60+ min)', cat: 'defensive', pos: 'all' },
  { key: 'ownGoals', field: 'own_goals', label: 'Own goals', cat: 'defensive', pos: 'all' },
  // Discipline
  { key: 'yc', field: 'yellow_cards', label: 'Yellow cards', cat: 'discipline', pos: 'all' },
  { key: 'rc', field: 'red_cards', label: 'Red cards', cat: 'discipline', pos: 'all' },
  // Goalkeeping
  { key: 'saves', field: 'saves', label: 'Saves', cat: 'goalkeeping', pos: 'gk', per90: true },
  { key: 'penSaved', field: 'penalties_saved', label: 'Penalties saved', cat: 'goalkeeping', pos: 'gk' },
  // General
  { key: 'influence', field: 'influence', label: 'Influence index', cat: 'general', pos: 'all', dp: 1, index: true },
  { key: 'bps', field: 'bps', label: 'Bonus points system score', cat: 'general', pos: 'all', index: true },
  { key: 'bonus', field: 'bonus', label: 'FPL bonus points', cat: 'general', pos: 'all' },
  { key: 'points', field: 'total_points', label: 'FPL points', cat: 'general', pos: 'all' },
  // ---- Supplementary match detail (FPL Core Insights / FotMob). Definitions differ
  // from FPL's; e.g. "Tackles (FPL)" above and "Tackles attempted" here are not mixed.
  { key: 'shots', label: 'Shots', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'sot', label: 'Shots on target', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'xgot', label: 'xG on target (xGOT)', cat: 'attacking', pos: 'all', per90: true, dp: 2, src: 'fplcore' },
  { key: 'bigChancesMissed', label: 'Big chances missed', cat: 'attacking', pos: 'all', src: 'fplcore' },
  { key: 'chancesCreated', label: 'Chances created (key passes)', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'touchesBox', label: 'Touches in opposition box', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'dribbles', label: 'Successful take-ons', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'dribbleAtt', label: 'Take-ons attempted (derived)', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore', derivedAttempts: true },
  { key: 'dispossessed', label: 'Dispossessed', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'wasFouled', label: 'Fouls won', cat: 'attacking', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'offsides', label: 'Offsides', cat: 'attacking', pos: 'all', src: 'fplcore' },
  { key: 'touches', label: 'Touches', cat: 'passing', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'passesAcc', label: 'Accurate passes', cat: 'passing', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'passesAtt', label: 'Passes attempted (derived)', cat: 'passing', pos: 'all', per90: true, src: 'fplcore', derivedAttempts: true },
  { key: 'finalThirdPasses', label: 'Final-third passes', cat: 'passing', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'crossesAcc', label: 'Accurate crosses', cat: 'passing', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'longBallsAcc', label: 'Accurate long balls', cat: 'passing', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'tacklesAtt', label: 'Tackles attempted', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'tacklesWon', label: 'Tackles won', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'interceptions', label: 'Interceptions', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'blocks', label: 'Blocks', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'clearances', label: 'Clearances', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'duelsWon', label: 'Duels won', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'duelsLost', label: 'Duels lost', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'aerialWon', label: 'Aerial duels won', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'aerialAtt', label: 'Aerial duels contested (derived)', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore', derivedAttempts: true },
  { key: 'dribbledPast', label: 'Dribbled past', cat: 'defensive', pos: 'outfield', per90: true, src: 'fplcore' },
  { key: 'foulsCommitted', label: 'Fouls committed', cat: 'discipline', pos: 'all', per90: true, src: 'fplcore' },
  { key: 'gkSaves', label: 'Saves (FotMob)', cat: 'goalkeeping', pos: 'gk', per90: true, src: 'fplcore' },
  { key: 'xgotFaced', label: 'xGOT faced', cat: 'goalkeeping', pos: 'gk', per90: true, dp: 2, src: 'fplcore' },
  { key: 'goalsPrevented', label: 'Goals prevented (xGOT − goals)', cat: 'goalkeeping', pos: 'gk', dp: 2, src: 'fplcore' },
  { key: 'savesInBox', label: 'Saves inside box', cat: 'goalkeeping', pos: 'gk', src: 'fplcore' },
  { key: 'sweeperActions', label: 'Sweeper actions', cat: 'goalkeeping', pos: 'gk', per90: true, src: 'fplcore' },
  { key: 'highClaims', label: 'High claims', cat: 'goalkeeping', pos: 'gk', src: 'fplcore' },
];

// Success rates: numerator and attempts are summed over the same matches only.
export const RATES = [
  { key: 'takeOnPct', label: 'Take-on success %', num: 'dribbles', den: 'dribbleAtt', src: 'fplcore', cat: 'attacking',
    note: 'Attempts are derived from success counts; matches where every take-on failed cannot be counted, so this can overstate success.' },
  { key: 'passPct', label: 'Pass accuracy %', num: 'passesAcc', den: 'passesAtt', src: 'fplcore', cat: 'passing' },
  { key: 'tackleWinPct', label: 'Tackle success %', num: 'tacklesWon', den: 'tacklesAtt', src: 'fplcore', cat: 'defensive' },
  { key: 'aerialPct', label: 'Aerial duel success %', num: 'aerialWon', den: 'aerialAtt', src: 'fplcore', cat: 'defensive' },
  { key: 'duelPct', label: 'Duel success %', num: 'duelsWon', den: null, src: 'fplcore', cat: 'defensive' },
  { key: 'shotConversion', label: 'Shot conversion %', num: 'goals', den: 'shots', src: 'fplcore', cat: 'attacking' },
  { key: 'sotPct', label: 'Shots on target %', num: 'sot', den: 'shots', src: 'fplcore', cat: 'attacking' },
];

// What the free sources do NOT provide. Shown in the UI so gaps are never hidden.
export const UNAVAILABLE = {
  attacking: ['Shots', 'Shots on target', 'Shot conversion %', 'Key passes / chances created', 'Big chances', 'Touches in opposition box', 'Take-ons attempted / successful', 'Take-on success %', 'Dispossessed', 'Carries & progressive carries', 'Fouls won'],
  passing: ['Pass maps & pass combinations (passer → receiver)', 'Heat maps / touch locations', 'Progressive passes', 'Passes into final third / box', 'Through balls, crosses, long balls', 'Possession lost', 'Touches'],
  defensive: ['Tackles won %', 'Duels & aerial duels', 'Fouls committed', 'Pressures'],
  goalkeeping: ['Post-shot xG / goals prevented (PSxG)', 'Distribution & passing'],
  identity: ['Height', 'Preferred foot', 'Contract expiry'],
  team: ['Possession %', 'Pass accuracy', 'Shots', 'Big chances', 'Set-piece breakdown', 'First/second-half splits', 'Pressing intensity (PPDA)', 'Formation'],
};

export const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
export const POS_LABEL = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

export function normalizePos(p) {
  const s = String(p).toUpperCase();
  if (s === '1' || s === 'GK' || s === 'GKP') return 'GK';
  if (s === '2' || s === 'DEF') return 'DEF';
  if (s === '3' || s === 'MID') return 'MID';
  if (s === '4' || s === 'FWD') return 'FWD';
  return null; // e.g. FPL "AM"/manager types are ignored
}

const bool = (v) => v === true || v === 'True' || v === 'true' || v === 1;

// One FPL history row (API or archived CSV) -> internal player-match record.
export function playerMatch(row) {
  const rec = {
    fixture: num(row.fixture),
    round: num(row.round),
    kickoff: row.kickoff_time || null,
    home: bool(row.was_home),
    opponentTeamId: num(row.opponent_team),
    hs: num(row.team_h_score),
    as: num(row.team_a_score),
  };
  for (const s of STATS) rec[s.key] = s.field && s.field in row ? num(row[s.field]) : null;
  return rec;
}

export const round = (v, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

export function per90(total, minutes) {
  if (total === null || total === undefined || !minutes || minutes <= 0) return null;
  return (total / minutes) * 90;
}

export function pct(part, whole) {
  if (part === null || whole === null || !whole) return null;
  return (part / whole) * 100;
}

// Season totals for one player from match records. A statistic missing from some
// matches is summed only over matches that report it, and coverage is recorded so the
// per-90 uses the minutes of exactly those matches.
export function aggregate(matches) {
  const played = matches.filter((m) => (m.minutes || 0) > 0);
  const out = { apps: played.length, matches: matches.length, totals: {}, per90: {}, coverage: {} };
  for (const s of STATS) {
    const reported = played.filter((m) => m[s.key] !== null && m[s.key] !== undefined);
    if (!reported.length) { out.totals[s.key] = null; continue; }
    const total = reported.reduce((a, m) => a + m[s.key], 0);
    out.totals[s.key] = round(total, s.dp ?? 2);
    if (reported.length !== played.length) out.coverage[s.key] = { reported: reported.length, of: played.length };
    if (s.per90) {
      const mins = reported.reduce((a, m) => a + (m.minutes || 0), 0);
      out.per90[s.key] = round(per90(total, mins), 2);
    }
  }
  out.rates = {};
  for (const r of RATES) {
    const rows = played.filter((m) => m[r.num] !== null && m[r.num] !== undefined && (r.den ? m[r.den] !== null && m[r.den] !== undefined : m.duelsLost !== null && m.duelsLost !== undefined));
    const n = rows.reduce((a, m) => a + m[r.num], 0);
    const d = r.den ? rows.reduce((a, m) => a + m[r.den], 0) : rows.reduce((a, m) => a + m.duelsWon + m.duelsLost, 0);
    out.rates[r.key] = d > 0 ? { value: round(pct(n, d), 1), num: n, den: d, matches: rows.length } : null;
  }
  const starts = out.totals.starts;
  out.subApps = starts === null ? null : out.apps - starts;
  const g = out.totals.goals; const xg = out.totals.xg;
  out.derived = {
    // Compared only over the matches in which xG was recorded.
    goalsMinusXg: xg !== null ? round(played.filter((m) => m.xg !== null).reduce((a, m) => a + (m.goals || 0), 0) - xg, 2) : null,
    minsPerGoal: g ? Math.round((out.totals.minutes || 0) / g) : null,
    goalInvolvements: g !== null && out.totals.assists !== null ? g + out.totals.assists : null,
    // Estimate: shots on target faced ≈ saves + goals conceded (includes own goals).
    savePctEst: out.totals.saves > 0 && out.totals.gc !== null
      ? round(pct(out.totals.saves, out.totals.saves + out.totals.gc), 1) : null,
    // Pre-shot xG conceded minus goals conceded. Not post-shot xG.
    xgcMinusGc: out.totals.xgc !== null && out.totals.gc !== null && out.coverage.xgc === undefined ? round(out.totals.xgc - out.totals.gc, 2) : null,
  };
  return out;
}

export function resultOf(spurs, opp) {
  if (spurs === null || opp === null || spurs === undefined || opp === undefined) return null;
  return spurs > opp ? 'W' : spurs < opp ? 'L' : 'D';
}

// League table from fixture results (finished or provisionally finished).
// Order: points, goal difference, goals for, then head-to-head points, then name.
export function leagueTable(fixtures, teams) {
  const rows = new Map(teams.map((t) => [t.id, { teamId: t.id, team: t.name, short: t.short, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, form: [] }]));
  const done = fixtures.filter((f) => f.counted).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  for (const f of done) {
    const h = rows.get(f.homeId); const a = rows.get(f.awayId);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += f.hs; h.ga += f.as; a.gf += f.as; a.ga += f.hs;
    if (f.hs > f.as) { h.won++; a.lost++; h.points += 3; h.form.push('W'); a.form.push('L'); }
    else if (f.hs < f.as) { a.won++; h.lost++; a.points += 3; h.form.push('L'); a.form.push('W'); }
    else { h.drawn++; a.drawn++; h.points++; a.points++; h.form.push('D'); a.form.push('D'); }
  }
  const list = [...rows.values()].map((r) => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }));
  const h2h = (x, y) => {
    let px = 0; let py = 0;
    for (const f of done) {
      if (f.homeId === x.teamId && f.awayId === y.teamId) { px += f.hs > f.as ? 3 : f.hs === f.as ? 1 : 0; py += f.as > f.hs ? 3 : f.hs === f.as ? 1 : 0; }
      if (f.homeId === y.teamId && f.awayId === x.teamId) { py += f.hs > f.as ? 3 : f.hs === f.as ? 1 : 0; px += f.as > f.hs ? 3 : f.hs === f.as ? 1 : 0; }
    }
    return py - px;
  };
  list.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || h2h(x, y) || x.team.localeCompare(y.team));
  list.forEach((r, i) => { r.position = i + 1; });
  return list;
}

// z-scored Euclidean similarity within a position group.
export function similarity(target, pool, features) {
  const stats = features.map((f) => {
    const vals = pool.map((p) => p.f[f]).filter((v) => v !== null);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1)) || 1;
    return { f, mean, sd };
  });
  const z = (p, s) => (p.f[s.f] === null ? null : (p.f[s.f] - s.mean) / s.sd);
  return pool
    .filter((p) => p.id !== target.id)
    .map((p) => {
      let d = 0; let n = 0;
      for (const s of stats) {
        const a = z(target, s); const b = z(p, s);
        if (a === null || b === null) continue;
        d += (a - b) ** 2; n++;
      }
      return n >= Math.ceil(features.length / 2) ? { ...p, distance: Math.sqrt(d / n) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

export function percentileRank(value, values) {
  if (value === null) return null;
  const v = values.filter((x) => x !== null);
  if (v.length < 5) return null;
  const below = v.filter((x) => x < value).length;
  const equal = v.filter((x) => x === value).length;
  return Math.round(((below + equal / 2) / v.length) * 100);
}

export function ageOn(birthDate, onDate = new Date()) {
  if (!birthDate || birthDate === 'None') return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  let age = onDate.getUTCFullYear() - b.getUTCFullYear();
  const m = onDate.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && onDate.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
