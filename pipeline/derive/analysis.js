// Deterministic analysis. Every statement is generated from stored numbers by fixed
// rules, carries its evidence and sample size, and is labelled as calculated
// analysis — never as official fact. No language model is involved, so nothing can
// be invented; the trade-off is that the prose is plainer than a human analyst's.
import { COACH_ERAS } from '../config.js';
import { normalizePos, per90, percentileRank, similarity, round, ageOn, UNAVAILABLE } from './stats.js';
import { num } from '../lib/validate.js';

// Minimum minutes to be ranked: 40% of the matches played so far (180–900), so early-
// season rankings include regular players without letting cameo-sized samples in.
let MIN_MINUTES = 450;
export function setMinMinutes(gamesPlayed) { MIN_MINUTES = Math.max(180, Math.min(900, Math.round((gamesPlayed || 0) * 90 * 0.4))); return MIN_MINUTES; }
export const minMinutes = () => MIN_MINUTES;
const f2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const sign = (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

export function coachFor(dateIso) {
  if (!dateIso) return null;
  const d = dateIso.slice(0, 10);
  const era = COACH_ERAS.find((e) => d >= e.from && (!e.to || d <= e.to));
  return era ? era.coach : null;
}

// League pool from the provider's full player list (all 20 clubs, current season).
export function leaguePool(elements, teams) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  return elements.map((e) => {
    const pos = normalizePos(e.element_type);
    const minutes = num(e.minutes) || 0;
    const v = (k) => num(e[k]);
    const p9 = (k) => (v(k) === null ? null : round(per90(v(k), minutes), 3));
    return {
      id: num(e.id), code: String(e.code), name: [e.first_name, e.second_name].filter(Boolean).join(' '), web: e.web_name,
      teamId: num(e.team), team: teamById.get(num(e.team))?.name || null, pos, minutes, age: ageOn(e.birth_date),
      status: e.status, starts: v('starts'),
      totals: { goals: v('goals_scored'), assists: v('assists'), xg: v('expected_goals'), xa: v('expected_assists'), xgc: v('expected_goals_conceded'), gc: v('goals_conceded'), cbi: v('clearances_blocks_interceptions'), tackles: v('tackles'), recoveries: v('recoveries'), defcon: v('defensive_contribution'), saves: v('saves'), cs: v('clean_sheets') },
      f: minutes >= MIN_MINUTES ? {
        xg: p9('expected_goals'), xa: p9('expected_assists'), goals: p9('goals_scored'), assists: p9('assists'), threat: p9('threat'), creativity: p9('creativity'),
        tackles: p9('tackles'), cbi: p9('clearances_blocks_interceptions'), recoveries: p9('recoveries'), defcon: p9('defensive_contribution'),
        xgc: p9('expected_goals_conceded'), saves: p9('saves'), gc: p9('goals_conceded'),
      } : null,
    };
  }).filter((p) => p.pos);
}

export const FEATURE_LABELS = { xg: 'xG', xa: 'xA', goals: 'Goals', assists: 'Assists', threat: 'Threat index', creativity: 'Creativity index', tackles: 'Tackles', cbi: 'Clearances, blocks & interceptions', recoveries: 'Recoveries', defcon: 'Defensive contribution', xgc: 'xG conceded', saves: 'Saves', gc: 'Goals conceded' };

export const FEATURES = {
  FWD: ['xg', 'xa', 'goals', 'threat', 'creativity', 'recoveries', 'tackles'],
  MID: ['xg', 'xa', 'threat', 'creativity', 'recoveries', 'tackles', 'cbi'],
  DEF: ['cbi', 'tackles', 'recoveries', 'xa', 'xg', 'xgc', 'creativity'],
  GK: ['saves', 'xgc', 'gc', 'recoveries'],
};
const KEY_METRICS = {
  FWD: [['xg', 'xG per 90'], ['xa', 'xA per 90'], ['threat', 'Threat per 90']],
  MID: [['xa', 'xA per 90'], ['xg', 'xG per 90'], ['recoveries', 'Recoveries per 90'], ['tackles', 'Tackles per 90']],
  DEF: [['cbi', 'Clearances/blocks/interceptions per 90'], ['tackles', 'Tackles per 90'], ['recoveries', 'Recoveries per 90'], ['xa', 'xA per 90']],
  GK: [['saves', 'Saves per 90'], ['xgc', 'xG conceded per 90 (lower is better)']],
};

export function playerPercentiles(pool, code) {
  const p = pool.find((x) => x.code === String(code));
  if (!p || !p.f) return null;
  const peers = pool.filter((x) => x.pos === p.pos && x.f);
  const out = {};
  for (const k of FEATURES[p.pos]) out[k] = percentileRank(p.f[k], peers.map((x) => x.f[k]));
  return { pos: p.pos, peers: peers.length, minMinutes: MIN_MINUTES, values: p.f, percentiles: out };
}

export function scoutingSummary(p, pct) {
  if (!pct) return null;
  const lines = [];
  const lower = new Set(['xgc', 'gc']);
  for (const [k, label] of KEY_METRICS[pct.pos] || []) {
    const r = pct.percentiles[k];
    if (r === null || r === undefined) continue;
    const good = lower.has(k) ? 100 - r : r;
    if (good >= 80) lines.push(`ranks in the top ${100 - good || 1}% for ${label.toLowerCase()} (${f2(pct.values[k])})`);
    else if (good <= 20) lines.push(`ranks in the bottom ${good || 1}% for ${label.toLowerCase()} (${f2(pct.values[k])})`);
  }
  const t = p.season.totals;
  const parts = [];
  parts.push(`${p.web} has played ${t.minutes ?? 0} Premier League minutes for Spurs this season (${p.season.apps} appearances).`);
  if (lines.length) parts.push(`Among ${pct.peers} Premier League ${posWord(pct.pos)} with ${pct.minMinutes}+ minutes, he ${lines.join('; ')}.`);
  else parts.push(`Among ${pct.peers} Premier League ${posWord(pct.pos)} with ${pct.minMinutes}+ minutes, none of his key per-90 measures sits in the top or bottom fifth.`);
  const d = p.season.derived.goalsMinusXg;
  if (d !== null && Math.abs(d) >= 1) parts.push(`He has scored ${Math.abs(d).toFixed(1)} goals ${d > 0 ? 'more' : 'fewer'} than his xG suggests.`);
  return { text: parts.join(' '), label: 'Calculated summary from FPL/Opta figures — analysis, not official fact', basis: 'percentiles vs league position peers' };
}
const posWord = (pos) => ({ GK: 'goalkeepers', DEF: 'defenders', MID: 'midfielders', FWD: 'forwards' }[pos]);

// Team ranks across the league from the provider's season totals.
export function leagueTeamRanks(pool, table) {
  const played = new Map(table.map((r) => [r.teamId, r.played]));
  const teams = {};
  for (const p of pool) {
    const t = (teams[p.teamId] ||= { teamId: p.teamId, team: p.team, xg: 0, xa: 0, gkXgc: 0, gkMinutes: 0 });
    t.xg += p.totals.xg || 0;
    if (p.pos === 'GK') { t.gkXgc += p.totals.xgc || 0; t.gkMinutes += p.minutes; }
  }
  const rows = Object.values(teams).map((t) => {
    const n = played.get(t.teamId) || 0;
    return { ...t, played: n, xgPer: n ? round(t.xg / n, 2) : null, xgaPer: t.gkMinutes ? round((t.gkXgc / t.gkMinutes) * 90, 2) : null };
  });
  const rank = (k, asc) => {
    const sorted = rows.filter((r) => r[k] !== null).sort((a, b) => (asc ? a[k] - b[k] : b[k] - a[k]));
    sorted.forEach((r, i) => { r[`${k}Rank`] = i + 1; });
  };
  rank('xgPer', false); rank('xgaPer', true);
  return rows;
}

export function insights({ team, players, table, spursId, ranks, prevTeam }) {
  const out = [];
  const o = team.overall;
  const add = (x) => out.push({ type: 'calculated', ...x });
  if (!o.n) return out;
  if (o.xg !== null && o.gfWithXg !== null) {
    const d = o.gfWithXg - o.xg;
    add({ id: 'finishing', category: 'Finishing', title: d >= 0 ? 'Scoring at or above chance quality' : 'Scoring below chance quality',
      text: `Spurs have scored ${o.gfWithXg} Premier League goals from ${f2(o.xg)} xG (${sign(d)}).`,
      interpretation: Math.abs(d) < 1.5 ? 'The gap is small for this sample; finishing is roughly in line with the chances created.' : d > 0 ? 'Finishing is outperforming the chances; this tends to regress over a season.' : 'Finishing is underperforming the chances; if chance quality holds, goals would be expected to rise.',
      evidence: [{ label: 'Goals', value: o.gfWithXg }, { label: 'xG', value: f2(o.xg) }], sample: `${o.xgMatches} PL matches with xG` });
  }
  if (o.xga !== null && o.gaWithXga !== null) {
    const d = o.gaWithXga - o.xga;
    add({ id: 'defending', category: 'Defending', title: d <= 0 ? 'Conceding at or below chance quality' : 'Conceding more than chances faced suggest',
      text: `Spurs have conceded ${o.gaWithXga} from an estimated ${f2(o.xga)} xG against (${sign(d)}).`,
      interpretation: Math.abs(d) < 1.5 ? 'Goals conceded are close to the quality of chances allowed.' : d > 0 ? 'Opponents are finishing above expectation (or goalkeeping is below par).' : 'Goalkeeping or opponent finishing is keeping goals conceded below expectation.',
      evidence: [{ label: 'Goals against', value: o.gaWithXga }, { label: 'xG against (est.)', value: f2(o.xga) }], sample: `${o.n} PL matches`, note: 'xG against = xG conceded while on pitch for a player who completed the match.' });
  }
  const l5 = team.last5;
  if (l5.n >= 3 && o.n >= 6) {
    const a = l5.perMatch.xg.value; const b = o.perMatch.xg.value; const c = l5.perMatch.xga.value; const d = o.perMatch.xga.value;
    if (a !== null && b !== null && c !== null && d !== null) add({ id: 'trend', category: 'Trend', title: 'Last five matches vs season average',
      text: `Last ${l5.n}: ${f2(a)} xG and ${f2(c)} xG against per match, compared with ${f2(b)} and ${f2(d)} across the season.`,
      interpretation: a - c > b - d + 0.25 ? 'Underlying performance (xG difference) has improved recently.' : a - c < b - d - 0.25 ? 'Underlying performance (xG difference) has worsened recently.' : 'Underlying performance is broadly stable.',
      evidence: [{ label: 'xG diff, last 5', value: f2(a - c) }, { label: 'xG diff, season', value: f2(b - d) }], sample: `${l5.n} vs ${o.n} matches` });
  }
  const h = team.home; const aw = team.away;
  if (h.n >= 2 && aw.n >= 2) add({ id: 'venue', category: 'Home & away', title: 'Points per game by venue',
    text: `${(h.points / h.n).toFixed(2)} points per game at home (${h.n} matches) and ${(aw.points / aw.n).toFixed(2)} away (${aw.n}).`,
    evidence: [{ label: 'Home W-D-L', value: `${h.w}-${h.d}-${h.l}` }, { label: 'Away W-D-L', value: `${aw.w}-${aw.d}-${aw.l}` }], sample: `${o.n} PL matches` });
  const totXa = players.reduce((s, p) => s + (p.season.totals.xa || 0), 0);
  const topCreator = [...players].sort((a, b) => (b.season.totals.xa || 0) - (a.season.totals.xa || 0))[0];
  if (topCreator && totXa > 0.5) {
    const share = (topCreator.season.totals.xa / totXa) * 100;
    add({ id: 'creation', category: 'Chance creation', title: share >= 35 ? 'Creation depends heavily on one player' : 'Creation is spread across the squad',
      text: `${topCreator.web} accounts for ${share.toFixed(0)}% of the squad's ${f2(totXa)} expected assists.`,
      evidence: [{ label: `${topCreator.web} xA`, value: f2(topCreator.season.totals.xa) }], sample: `${o.n} PL matches` });
  }
  const me = ranks && ranks.find((r) => r.teamId === spursId);
  if (me && me.xgPerRank) add({ id: 'league-rank', category: 'League context', title: 'Chance quality versus the league',
    text: `Spurs rank ${ord(me.xgPerRank)} of 20 for xG created per match (${f2(me.xgPer)}) and ${ord(me.xgaPerRank)} for estimated xG conceded per 90 (${f2(me.xgaPer)}).`,
    evidence: [{ label: 'xG per match', value: f2(me.xgPer) }, { label: 'xG against per 90 (est.)', value: f2(me.xgaPer) }], sample: `${me.played} PL matches each`,
    note: 'League team totals are summed from player totals and include minutes for previous clubs for mid-season transfers; xG against estimated from goalkeepers.' });
  if (prevTeam && prevTeam.overall && prevTeam.overall.n >= 10 && o.n >= 5) {
    const p = prevTeam.overall;
    add({ id: 'yoy', category: 'Season comparison', title: 'Compared with last season',
      text: `${(o.points / o.n).toFixed(2)} points per game now vs ${(p.points / p.n).toFixed(2)} last season; ${f2(o.perMatch.xg.value)} xG per match vs ${f2(p.perMatch.xg.value)}; ${f2(o.perMatch.xga.value)} xG against vs ${f2(p.perMatch.xga.value)}.`,
      evidence: [{ label: 'Matches', value: `${o.n} vs ${p.n}` }], sample: `${o.n} and ${p.n} PL matches` });
  }
  const unavailable = players.filter((p) => p.current && ['i', 's', 'u', 'd'].includes(p.status));
  if (unavailable.length) add({ id: 'availability', category: 'Availability', title: `${unavailable.length} player${unavailable.length > 1 ? 's' : ''} flagged`,
    text: unavailable.map((p) => `${p.web}: ${p.statusLabel}${p.news ? ` — ${p.news}` : ''}`).join('; '), type: 'observed', evidence: [], sample: 'Latest FPL availability flags' });
  return out;
}
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function tactical({ allTeamMatches, team, players, season }) {
  // Era comparison across every stored season.
  const eras = {};
  for (const m of allTeamMatches) {
    const c = coachFor(m.kickoff);
    if (!c) continue;
    const e = (eras[c] ||= { coach: c, n: 0, pts: 0, gf: 0, ga: 0, xg: 0, xga: 0, xgN: 0, xgaN: 0, def: 0, defN: 0 });
    e.n++; e.pts += m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0; e.gf += m.gf ?? 0; e.ga += m.ga ?? 0;
    if (m.xg !== null) { e.xg += m.xg; e.xgN++; }
    if (m.xga !== null) { e.xga += m.xga; e.xgaN++; }
    if (m.tackles !== null && m.cbi !== null) { e.def += m.tackles + m.cbi; e.defN++; }
  }
  const eraRows = Object.values(eras).map((e) => ({
    coach: e.coach, matches: e.n, ppg: round(e.pts / e.n, 2), gfPer: round(e.gf / e.n, 2), gaPer: round(e.ga / e.n, 2),
    xgPer: e.xgN ? round(e.xg / e.xgN, 2) : null, xgaPer: e.xgaN ? round(e.xga / e.xgaN, 2) : null, defActionsPer: e.defN ? round(e.def / e.defN, 1) : null,
  }));
  const dz = allTeamMatches.filter((m) => coachFor(m.kickoff) === 'Roberto De Zerbi');
  const rolling = dz.map((m, i) => {
    const win = dz.slice(Math.max(0, i - 4), i + 1);
    const av = (k) => { const v = win.map((x) => x[k]).filter((x) => x !== null); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null; };
    return { matchId: m.matchId, kickoff: m.kickoff, opponent: m.opponentShort || m.opponent, xg: m.xg, xga: m.xga, xg5: av('xg'), xga5: av('xga'), gf: m.gf, ga: m.ga };
  });

  const byPos = {};
  for (const p of players) {
    const b = (byPos[p.pos] ||= { pos: p.pos, minutes: 0, xg: 0, xa: 0, tackles: 0, cbi: 0, recoveries: 0 });
    const t = p.season.totals;
    b.minutes += t.minutes || 0; b.xg += t.xg || 0; b.xa += t.xa || 0; b.tackles += t.tackles || 0; b.cbi += t.cbi || 0; b.recoveries += t.recoveries || 0;
  }
  const totalXgi = Object.values(byPos).reduce((s, b) => s + b.xg + b.xa, 0);
  const posShare = Object.values(byPos).map((b) => ({ ...b, xgiShare: totalXgi ? round(((b.xg + b.xa) / totalXgi) * 100, 1) : null, xg: round(b.xg, 2), xa: round(b.xa, 2) }));

  const roles = players.filter((p) => p.current && (p.season.totals.minutes || 0) >= 270).map((p) => {
    const q = p.season.per90; const tags = [];
    if (p.pos !== 'GK') {
      if ((q.xa ?? 0) >= 0.2) tags.push('Primary creator');
      if ((q.xg ?? 0) >= 0.35) tags.push('Box threat');
      if ((q.recoveries ?? 0) >= 6) tags.push('Ball-winner (recoveries)');
      if ((q.cbi ?? 0) >= 6) tags.push('Box defender (CBI)');
      if ((q.tackles ?? 0) >= 2.5) tags.push('Active tackler');
    } else if ((q.saves ?? 0) >= 3) tags.push('High save volume');
    return { playerId: p.id, name: p.web, pos: p.pos, minutes: p.season.totals.minutes, per90: q, tags };
  });

  const areas = [
    { area: 'Chance creation & attacking patterns', measurable: 'partial', evidence: 'Team and player xG / xA per match, share of chance quality by position group.', missing: 'Shot locations, key passes, final-third entries.' },
    { area: 'Finishing', measurable: 'yes', evidence: 'Goals vs xG for team and players.', missing: 'Shot counts, on-target %.' },
    { area: 'Defensive solidity', measurable: 'partial', evidence: 'Goals conceded vs estimated xG against, clean sheets.', missing: 'Shots conceded, counter-attacks conceded.' },
    { area: 'Defensive activity', measurable: 'partial', evidence: 'Tackles, clearances/blocks/interceptions and recoveries per match.', missing: 'Pressures, PPDA, duel success. High defensive-action counts can mean less possession, not better pressing.' },
    { area: 'Goalkeeping', measurable: 'partial', evidence: 'Saves, goals conceded vs pre-shot xG conceded.', missing: 'Post-shot xG, distribution, sweeping.' },
    { area: 'Selection & rotation', measurable: 'yes', evidence: 'Starts, minutes concentration, players used per match.', missing: '' },
    { area: 'Build-up structure & goalkeeper involvement', measurable: 'no', evidence: '', missing: 'Requires pass-level event data (not available free).' },
    { area: 'Press resistance & turnovers', measurable: 'no', evidence: '', missing: 'Requires possession/turnover event data.' },
    { area: 'Positional rotations, overloads, third-man combinations', measurable: 'no', evidence: '', missing: 'Requires tracking or detailed event sequences.' },
    { area: 'Width, depth & half-space occupation', measurable: 'no', evidence: '', missing: 'Requires positional/tracking data.' },
    { area: 'Pressing triggers & counter-pressing', measurable: 'no', evidence: '', missing: 'Requires pressure events or tracking data.' },
    { area: 'Defensive transitions', measurable: 'no', evidence: '', missing: 'Requires possession-sequence data.' },
    { area: 'Set pieces', measurable: 'no', evidence: '', missing: 'Goal/shot situation types are not in the free data.' },
    { area: 'In/out-of-possession formations', measurable: 'no', evidence: '', missing: 'Line-up formations are not in the free data.' },
  ];
  return { season, eras: eraRows, deZerbi: { matches: dz.length, rolling }, positionShare: posShare, roles, areas, unavailableTeamMetrics: UNAVAILABLE.team };
}

export function squadPlanner({ players, pool, spursId, ranksByPos }) {
  const current = players.filter((p) => p.current);
  const groups = {};
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    const ps = current.filter((p) => p.pos === pos);
    const mins = ps.reduce((s, p) => s + (p.season.totals.minutes || 0), 0);
    groups[pos] = {
      count: ps.length,
      averageAge: ps.filter((p) => p.age !== null).length ? round(ps.filter((p) => p.age !== null).reduce((s, p) => s + p.age, 0) / ps.filter((p) => p.age !== null).length, 1) : null,
      depth: ps.map((p) => ({ playerId: p.id, name: p.web, age: p.age, minutes: p.season.totals.minutes || 0, share: mins ? round(((p.season.totals.minutes || 0) / mins) * 100, 1) : 0, status: p.status, statusLabel: p.statusLabel, news: p.news }))
        .sort((a, b) => b.minutes - a.minutes),
      leagueRank: ranksByPos[pos] || null,
    };
  }
  const weaknesses = Object.entries(groups).filter(([, g]) => g.leagueRank && g.leagueRank.rank >= 14)
    .map(([pos, g]) => ({ pos, metric: g.leagueRank.metric, rank: g.leagueRank.rank, value: g.leagueRank.value, text: `Spurs' ${posWord(pos)} rank ${ord(g.leagueRank.rank)} of 20 for ${g.leagueRank.metric}.` }));
  const thin = Object.entries(groups).filter(([pos, g]) => g.depth.filter((d) => d.status === 'a').length < { GK: 2, DEF: 6, MID: 5, FWD: 2 }[pos])
    .map(([pos, g]) => ({ pos, available: g.depth.filter((d) => d.status === 'a').length, text: `Only ${g.depth.filter((d) => d.status === 'a').length} ${posWord(pos)} currently flagged available.` }));

  const replacements = {};
  const replacementTargets = {};
  for (const p of current) {
    const me = pool.find((x) => x.code === p.id);
    if (!me || !me.f) continue;
    const feats = FEATURES[p.pos];
    const allPeers = pool.filter((x) => x.pos === p.pos && x.f);
    const peers = allPeers.filter((x) => x.teamId !== spursId);
    const sim = similarity(me, [me, ...peers], feats).slice(0, 5);
    const sd = Object.fromEntries(feats.map((k) => {
      const v = allPeers.map((x) => x.f[k]).filter((x) => x !== null);
      const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      return [k, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1];
    }));
    const pctOf = (k, v) => percentileRank(v, allPeers.map((x) => x.f[k]));
    const lowerBetter = new Set(['xgc', 'gc']);
    replacementTargets[p.id] = { name: p.web, per90: me.f, peers: allPeers.length };
    replacements[p.id] = sim.map((s) => {
      const diffs = feats.filter((k) => s.f[k] !== null && me.f[k] !== null).map((k) => ({ k, label: FEATURE_LABELS[k], them: round(s.f[k], 2), spurs: round(me.f[k], 2), z: Math.abs(s.f[k] - me.f[k]) / sd[k] }));
      const close = diffs.filter((d) => d.z <= 0.5).sort((a, b) => a.z - b.z).slice(0, 4);
      const apart = diffs.filter((d) => d.z > 0.9).sort((a, b) => b.z - a.z).slice(0, 2).map((d) => ({ ...d, higher: d.them > d.spurs }));
      const strengths = feats.map((k) => { const r = pctOf(k, s.f[k]); return { k, label: lowerBetter.has(k) ? `Low ${FEATURE_LABELS[k].toLowerCase()} (team, while on pitch)` : FEATURE_LABELS[k], value: round(s.f[k], 2), pct: r === null ? null : lowerBetter.has(k) ? 100 - r : r }; })
        .filter((x) => x.pct !== null && x.pct >= 75).sort((a, b) => b.pct - a.pct).slice(0, 3);
      const t = s.totals;
      return {
        name: s.name, web: s.web, team: s.team, age: s.age, minutes: s.minutes, starts: s.starts,
        similarity: round(Math.max(0, 100 - s.distance * 40), 0), per90: s.f,
        why: close.map(({ z, ...d }) => d), differs: apart.map(({ z, ...d }) => d), strengths,
        season: { goals: t.goals, assists: t.assists, xg: t.xg, xa: t.xa, cbi: t.cbi, tackles: t.tackles, recoveries: t.recoveries, saves: t.saves, cs: t.cs },
      };
    });
  }
  const away = (state) => players.filter((p) => p.membership === state).map((p) => ({ playerId: p.id, name: p.name, pos: p.pos, apps: p.seasonAll?.apps ?? p.season.apps, note: p.membershipNote }));
  const departures = away('left');
  const loans = away('loan');
  const unregistered = away('unregistered');
  return {
    groups, weaknesses, thin, replacements, replacementTargets, departures, loans, unregistered,
    notes: [
      'Replacement suggestions are statistical-similarity recommendations generated by this site, not reporting. Transfer fees, wages, contract dates and availability are not in the free data and are never estimated.',
      'Positions are the Premier League\'s four broad groups (GK/DEF/MID/FWD); detailed roles are not supplied.',
      `Pool: Premier League players only, with ${MIN_MINUTES}+ minutes this season.`,
    ],
  };
}

export function positionRanks(pool, spursId) {
  const metric = { GK: ['xgcMinusGcPer', 'goals prevented vs pre-shot xG per 90', false], DEF: ['xgcPer', 'xG conceded per 90 while on pitch', true], MID: ['xgiPer', 'xG + xA per 90', false], FWD: ['xgPer', 'xG per 90', false] };
  const out = {};
  for (const pos of Object.keys(metric)) {
    const [key, label, asc] = metric[pos];
    const byTeam = {};
    for (const p of pool.filter((x) => x.pos === pos)) {
      const t = (byTeam[p.teamId] ||= { teamId: p.teamId, minutes: 0, xg: 0, xa: 0, xgc: 0, gc: 0 });
      t.minutes += p.minutes; t.xg += p.totals.xg || 0; t.xa += p.totals.xa || 0; t.xgc += p.totals.xgc || 0; t.gc += p.totals.gc || 0;
    }
    const rows = Object.values(byTeam).filter((t) => t.minutes > 0).map((t) => ({
      teamId: t.teamId, xgPer: (t.xg / t.minutes) * 90, xgiPer: ((t.xg + t.xa) / t.minutes) * 90, xgcPer: (t.xgc / t.minutes) * 90, xgcMinusGcPer: ((t.xgc - t.gc) / t.minutes) * 90,
    })).sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]));
    const i = rows.findIndex((r) => r.teamId === spursId);
    if (i >= 0) out[pos] = { rank: i + 1, of: rows.length, metric: label, value: round(rows[i][key], 2) };
  }
  return out;
}

export function article({ season, generatedAt, team, insightsList, tacticalData, sources }) {
  const o = team.overall;
  const lines = [];
  lines.push(`# Tottenham under De Zerbi: what the numbers say (${season})`, '');
  lines.push(`*Data cut-off: ${generatedAt.slice(0, 16).replace('T', ' ')} UTC. Premier League matches only (${o.n}). Figures from the Fantasy Premier League API (Opta-derived xG/xA). Analysis is calculated by rule from those figures and is not official.*`, '');
  lines.push('## Headline numbers', '');
  lines.push(`| | Value |`, `|---|---|`, `| Record (W-D-L) | ${o.w}-${o.d}-${o.l} |`, `| Goals for / against | ${o.gf} / ${o.ga} |`, `| xG for / against (est.) | ${f2(o.xg)} / ${f2(o.xga)} |`, `| Clean sheets | ${o.cleanSheets} |`, '');
  if (tacticalData.eras.length) {
    lines.push('## Coach comparison', '', '| Coach | PL matches | Pts/game | xG/game | xGA/game |', '|---|---|---|---|---|');
    for (const e of tacticalData.eras) lines.push(`| ${e.coach} | ${e.matches} | ${f2(e.ppg)} | ${f2(e.xgPer)} | ${f2(e.xgaPer)} |`);
    lines.push('', '*Earlier coaches cover stored seasons only; xG available from 2022-23.*', '');
  }
  lines.push('## Findings', '');
  for (const i of insightsList) {
    lines.push(`**${i.title}.** ${i.text}${i.interpretation ? ` *Interpretation: ${i.interpretation}*` : ''} _(Sample: ${i.sample}.)_`, '');
  }
  lines.push('## What this data cannot show', '', `Build-up structure, pressing, rotations, set-piece routines and formations need event or tracking data that is not freely available, so they are not assessed here.`, '');
  lines.push('## Sources', '');
  for (const s of sources) lines.push(`- ${s}`);
  return lines.join('\n');
}
