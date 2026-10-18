// Strengths and weaknesses: each Spurs player compared with every Premier League player
// in the same position, per 90 minutes (or as a success rate), using FotMob match data
// for all league players (via FPL Core Insights) plus FPL/Opta xG and xA.
//
// Rules: only players with enough minutes count as peers; rates need a minimum number of
// attempts; "lower is better" stats are flipped so a high percentile always means good.
// Everything here is calculated analysis, not official fact.
import { num } from '../lib/validate.js';
import { normalizePos, round } from './stats.js';
import { playerRow, recordedColumns } from '../adapters/fplcore.js';

// key, label, kind ('p90' | 'rate'), positions, lowerIsBetter, strength phrase, weakness phrase
const METRICS = [
  ['xg', 'Expected goals (xG)', 'fpl', ['FWD', 'MID', 'DEF'], false, 'gets into good scoring positions', 'rarely gets into scoring positions'],
  ['xa', 'Expected assists (xA)', 'fpl', ['FWD', 'MID', 'DEF'], false, 'sets up good chances for others', 'creates few good chances for others'],
  ['shots', 'Shots', 'p90', ['FWD', 'MID'], false, 'shoots often', 'shoots rarely'],
  ['sot', 'Shots on target', 'p90', ['FWD'], false, 'tests the goalkeeper', 'struggles to hit the target'],
  ['touchesBox', 'Touches in the opposition box', 'p90', ['FWD', 'MID'], false, 'gets on the ball in the box', 'is seldom on the ball in the box'],
  ['chancesCreated', 'Chances created', 'p90', ['FWD', 'MID', 'DEF'], false, 'creates chances', 'creates few chances'],
  ['finalThirdPasses', 'Passes into the final third', 'p90', ['MID', 'DEF'], false, 'moves the ball forward into the final third', 'rarely moves the ball into the final third'],
  ['passPct', 'Pass accuracy', 'rate', ['FWD', 'MID', 'DEF'], false, 'keeps the ball with secure passing', 'gives the ball away with misplaced passes'],
  ['longBallsAcc', 'Accurate long balls', 'p90', ['MID', 'DEF'], false, 'switches play with accurate long passes', 'offers little long-range passing'],
  ['crossesAcc', 'Accurate crosses', 'p90', ['MID', 'DEF', 'FWD'], false, 'delivers accurate crosses', 'contributes few accurate crosses'],
  ['wasFouled', 'Fouls won', 'p90', ['FWD', 'MID'], false, 'draws fouls', 'draws few fouls'],
  ['dispossessed', 'Times dispossessed', 'p90', ['FWD', 'MID'], true, 'is hard to dispossess', 'is dispossessed often'],
  ['tacklesWon', 'Tackles won', 'p90', ['DEF', 'MID', 'FWD'], false, 'wins tackles', 'wins few tackles'],
  ['interceptions', 'Interceptions', 'p90', ['DEF', 'MID'], false, 'reads the game and intercepts', 'makes few interceptions'],
  ['recoveries', 'Ball recoveries', 'fpl', ['MID', 'DEF', 'FWD'], false, 'wins the ball back', 'wins the ball back rarely'],
  ['clearances', 'Clearances', 'p90', ['DEF'], false, 'clears danger from the box', 'makes few clearances'],
  ['blocks', 'Blocks', 'p90', ['DEF'], false, 'blocks shots and passes', 'blocks little'],
  ['aerialWon', 'Aerial duels won', 'p90', ['DEF', 'FWD'], false, 'wins headers', 'wins few headers'],
  ['aerialPct', 'Aerial duel success', 'rate', ['DEF', 'FWD', 'MID'], false, 'is strong in the air', 'loses aerial duels'],
  ['duelPct', 'Duel success', 'rate', ['DEF', 'MID', 'FWD'], false, 'wins his individual battles', 'loses more duels than his peers'],
  ['dribbledPast', 'Times dribbled past', 'p90', ['DEF', 'MID'], true, 'is hard to dribble past', 'gets dribbled past often'],
  ['foulsCommitted', 'Fouls committed', 'p90', ['DEF', 'MID', 'FWD'], true, 'defends without fouling', 'commits a lot of fouls'],
  ['goalsPrevented', 'Goals prevented (shot-stopping)', 'p90', ['GK'], false, 'saves more than the shots he faces suggest', 'concedes more than the shots he faces suggest'],
  ['savesInBox', 'Saves inside the box', 'p90', ['GK'], false, 'makes close-range saves', 'makes few close-range saves'],
  ['highClaims', 'High claims', 'p90', ['GK'], false, 'commands his area and claims crosses', 'rarely comes for crosses'],
  ['sweeperActions', 'Sweeper actions', 'p90', ['GK'], false, 'sweeps behind the defence', 'rarely leaves his line to sweep'],
  ['gkPassesAcc', 'Accurate passes (distribution)', 'p90', ['GK'], false, 'is heavily involved in build-up', 'is less involved in build-up'],
  ['gkLongBallsAcc', 'Accurate long balls (distribution)', 'p90', ['GK'], false, 'distributes accurately long', 'offers little accurate long distribution'],
];
const RATE_DEF = { groundDuelPct: ['groundDuelsWon_r', 'groundDuelAtt', 10], passPct: ['passesAcc', 'passesAtt', 30], aerialPct: ['aerialWon', 'aerialAtt', 6], duelPct: ['duelsWon', 'duelsTot', 12] };

// Aggregate every league player's match rows into per-player totals.
export function fotmobPool(rows, elementsById) {
  const byMatch = new Map();
  for (const r of rows) { if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []); byMatch.get(r.match_id).push(r); }
  const seen = new Set(); const pool = new Map();
  for (const [, mrows] of byMatch) {
    const rec = recordedColumns(mrows);
    for (const r of mrows) {
      const k = `${r.match_id}:${r.player_id}`; if (seen.has(k)) continue; seen.add(k);
      const row = playerRow(r, true, rec);
      if (!row.elementId || !row.minutes) continue;
      const e = elementsById.get(row.elementId); const pos = e ? normalizePos(e.element_type) : null;
      if (!pos) continue;
      const p = pool.get(row.elementId) || { elementId: row.elementId, pos, minutes: 0, sums: {}, mins: {} };
      p.minutes += row.minutes;
      const add = (key, v) => { if (v === null || v === undefined) return; p.sums[key] = (p.sums[key] || 0) + v; p.mins[key] = (p.mins[key] || 0) + row.minutes; };
      for (const [key] of METRICS) if (!['fpl', 'rate'].includes(METRICS.find((m) => m[0] === key)[2])) add(key, row[key]);
      if (row.passesAcc !== null && row.passesAtt !== null) { add('passesAcc', row.passesAcc); add('passesAtt', row.passesAtt); }
      if (row.aerialWon !== null && row.aerialAtt !== null) { add('aerialWon_r', row.aerialWon); add('aerialAtt', row.aerialAtt); }
      if (row.duelsWon !== null && row.duelsLost !== null) { add('duelsWon', row.duelsWon); add('duelsTot', row.duelsWon + row.duelsLost); }
      for (const k of PROXY_P90) if (!METRICS.some((m) => m[0] === k)) add(k, row[k]);
      if (row.groundDuelsWon !== null && row.groundDuelAtt !== null) { add('groundDuelsWon_r', row.groundDuelsWon); add('groundDuelAtt', row.groundDuelAtt); }
      pool.set(row.elementId, p);
    }
  }
  return pool;
}

function valueOf(p, key, kind) {
  if (kind === 'rate') {
    const [n, d, minAtt] = RATE_DEF[key];
    const num_ = key === 'aerialPct' ? p.sums.aerialWon_r : p.sums[n]; const den = p.sums[d];
    return den >= minAtt ? (num_ / den) * 100 : null;
  }
  const m = p.mins[key];
  return m && m >= 90 ? (p.sums[key] / m) * 90 : null;
}

const pctRank = (v, arr) => { const below = arr.filter((x) => x < v).length; const eq = arr.filter((x) => x === v).length; return Math.round(((below + eq / 2) / arr.length) * 100); };

export function strengthsProfile({ player, fotPool, fplPct, minMinutes }) {
  const pos = player.pos; const me = fotPool.get(player.elementId);
  const peers = [...fotPool.values()].filter((x) => x.pos === pos && x.minutes >= minMinutes);
  const out = [];
  for (const [key, label, kind, positions, lower, good, bad] of METRICS) {
    if (!positions.includes(pos)) continue;
    let value = null; let pct = null; let avg = null; let n = 0;
    if (kind === 'fpl') {
      if (!fplPct?.percentiles || fplPct.percentiles[key] === undefined || fplPct.percentiles[key] === null) continue;
      value = fplPct.values[key]; pct = fplPct.percentiles[key]; n = fplPct.peers;
    } else {
      if (!me || me.minutes < minMinutes) continue;
      value = valueOf(me, key, kind); if (value === null) continue;
      const vals = peers.map((x) => valueOf(x, key, kind)).filter((v) => v !== null);
      if (vals.length < 8) continue;
      pct = pctRank(value, vals); avg = vals.reduce((a, b) => a + b, 0) / vals.length; n = vals.length;
    }
    const score = lower ? 100 - pct : pct;
    out.push({ key, label, kind: kind === 'rate' ? 'rate' : 'p90', lowerIsBetter: lower, value: round(value, kind === 'rate' ? 1 : 2), leagueAvg: avg === null ? null : round(avg, kind === 'rate' ? 1 : 2), score, peers: n, good, bad, source: kind === 'fpl' ? 'FPL (Opta)' : 'FotMob via FPL Core Insights' });
  }
  if (!out.length) return { pos, minutes: me?.minutes ?? null, minMinutes, metrics: [], strengths: [], weaknesses: [], text: null, label: LABEL };
  const strengths = out.filter((m) => m.score >= 70).sort((a, b) => b.score - a.score).slice(0, 5);
  const weaknesses = out.filter((m) => m.score <= 30).sort((a, b) => a.score - b.score).slice(0, 5);
  const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const posWord = { GK: 'goalkeepers', DEF: 'defenders', MID: 'midfielders', FWD: 'forwards' }[pos];
  const parts = [];
  if (strengths.length) parts.push(`Compared with Premier League ${posWord}, ${player.web} ${list(strengths.slice(0, 3).map((m) => m.good))}.`);
  if (weaknesses.length) parts.push(`${strengths.length ? 'On the other hand, he' : `Compared with Premier League ${posWord}, ${player.web}`} ${list(weaknesses.slice(0, 3).map((m) => m.bad))}.`);
  if (!strengths.length && !weaknesses.length) parts.push(`Compared with Premier League ${posWord}, ${player.web} is close to average across the board, with no stat clearly above or below his peers.`);
  return { pos, posWord, minutes: me?.minutes ?? null, minMinutes, metrics: out.sort((a, b) => b.score - a.score), strengths, weaknesses, text: parts.join(' '), label: LABEL };
}
const LABEL = 'Calculated from match data, comparing per-90 figures and success rates with every Premier League player in the same position. Analysis, not official fact.';

// ---------- Progression & pressing: closest free measures ----------
// Exact progressive passes, carries and pressures need every touch's pitch location
// (paid event data). These are the nearest measures the free data records, each shown
// with the player's per-90 value and his percentile among league players in his position.
// Every figure is labelled an estimate in the UI.
export const PROXY_GROUPS = [
  { id: 'progPasses', title: 'Progressive passes', exact: 'Passes that move the ball at least 10 m towards goal (or into the box).',
    why: 'Passes into the final third are the closest recorded measure: most progressive passes end there. Accurate long balls add switches and line-breaking balls from deep; chances created are the final forward pass.',
    items: [['finalThirdPasses', 'Passes into the final third', 'p90', true], ['longBallsAcc', 'Accurate long balls', 'p90'], ['chancesCreated', 'Chances created', 'p90']] },
  { id: 'carries', title: 'Carries & progressive carries', exact: 'Times the player runs with the ball, and carries of 10 m+ towards goal.',
    why: 'Touches in the opposition box show how often he arrives in the box with the ball; fouls won are mostly drawn while carrying. Take-ons would be the best measure, but the source stopped recording them per player this season.',
    items: [['touchesBox', 'Touches in the opposition box', 'p90', true], ['wasFouled', 'Fouls won', 'p90'], ['touches', 'Touches (involvement)', 'p90']] },
  { id: 'pressing', title: 'Pressures & pressure success', exact: 'Times the player closes down an opponent on the ball, and how often his team wins it back within 5 seconds.',
    why: 'High-intensity running and sprints measure pressing volume (pressing is run at high speed). Ball-winning actions and ground duel success measure the outcome: winning the ball back.',
    items: [['hiDist', 'High-intensity distance (m)', 'p90', true], ['sprints', 'Sprints', 'p90'], ['ballWins', 'Ball-winning actions', 'p90', true], ['groundDuelPct', 'Ground duel success %', 'rate']] },
];
const PROXY_P90 = [...new Set(PROXY_GROUPS.flatMap((g) => g.items.filter((i) => i[2] === 'p90').map((i) => i[0])))];

export function proxyPanel({ player, fotPool, minMinutes }) {
  if (player.pos === 'GK') return null;
  const me = fotPool.get(player.elementId);
  const peers = [...fotPool.values()].filter((x) => x.pos === player.pos && x.minutes >= minMinutes);
  const groups = PROXY_GROUPS.map((g) => ({
    id: g.id, title: g.title, exact: g.exact, why: g.why,
    items: g.items.map(([key, label, kind, headline]) => {
      const value = me ? valueOf(me, key, kind) : null;
      const vals = peers.map((x) => valueOf(x, key, kind)).filter((v) => v !== null);
      const enough = me && me.minutes >= minMinutes && vals.length >= 8;
      return { key, label, kind, headline: !!headline, value: value === null ? null : round(value, kind === 'rate' ? 1 : key === 'hiDist' ? 0 : 2),
        pct: value !== null && enough ? pctRank(value, vals) : null, leagueAvg: vals.length >= 8 ? round(vals.reduce((a, b) => a + b, 0) / vals.length, kind === 'rate' ? 1 : key === 'hiDist' ? 0 : 2) : null, peers: vals.length };
    }),
  }));
  return { pos: player.pos, minutes: me?.minutes ?? null, minMinutes, groups, source: 'FotMob match data via FPL Core Insights (Premier League only)',
    label: 'Estimates: closest measures the free data records, not the exact statistics. Percentile = share of Premier League players in the same position he is ahead of.' };
}
