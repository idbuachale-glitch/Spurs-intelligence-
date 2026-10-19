// Weekly report: a Monday-to-Sunday round-up (Bahrain time) of Spurs' results, standout
// performers, league position, team news and the coming week's fixtures. Rebuilt on every
// run from the stored data, so past weeks stay available and corrections flow through.
import { num } from '../lib/validate.js';
import { leagueTable, round } from './stats.js';

const TZ_OFFSET = 3 * 3600e3; // Asia/Bahrain, no daylight saving
const DAY = 86400e3;
// Monday 00:00 Bahrain time on or before the given instant (as a UTC timestamp).
function weekStart(t) {
  const local = new Date(t + TZ_OFFSET);
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DAY - TZ_OFFSET;
}
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export function weeklyReports({ fixtures, files, fplFixtures, teams, spursId, players, now = new Date() }) {
  const real = fixtures.filter((f) => f.kickoff && !f.friendly);
  if (!real.length) return { weeks: [] };
  const first = weekStart(Math.min(...real.map((f) => Date.parse(f.kickoff))));
  const cur = weekStart(now.getTime());
  const tf = fplFixtures.map((f) => ({ id: f.id, homeId: num(f.team_h), awayId: num(f.team_a), hs: num(f.team_h_score), as: num(f.team_a_score), kickoff: f.kickoff_time,
    fin: Boolean((f.finished || f.finished_provisional) && num(f.team_h_score) !== null && num(f.team_a_score) !== null) }));
  const posAt = (t) => {
    const tbl = leagueTable(tf.map((f) => ({ ...f, counted: f.fin && f.kickoff && Date.parse(f.kickoff) < t })), teams);
    const r = tbl.find((x) => x.teamId === spursId);
    return r && r.played ? { position: r.position, points: r.points, played: r.played } : null;
  };
  const byPlayer = new Map(players.map((p) => [p.id, p]));
  const weeks = [];
  for (let ws = first; ws <= cur; ws += 7 * DAY) {
    const we = ws + 7 * DAY;
    const inWeek = real.filter((f) => { const t = Date.parse(f.kickoff); return t >= ws && t < we; });
    const played = inWeek.filter((f) => f.result);
    const nextWeek = real.filter((f) => { const t = Date.parse(f.kickoff); return t >= we && t < we + 7 * DAY && !f.result; });
    if (!inWeek.length && ws !== cur) continue;
    // Standout performers across the week's matches.
    const agg = new Map();
    for (const f of played) {
      for (const l of files[`matches/${f.id}.json`]?.lineup || []) {
        if (!(l.minutes > 0)) continue;
        const a = agg.get(l.playerId) || { playerId: l.playerId, name: l.name, pos: l.pos, minutes: 0, goals: 0, assists: 0, xg: 0, xa: 0, bps: 0, saves: 0, tackles: 0, cbi: 0, matches: 0 };
        a.matches++; for (const k of ['minutes', 'goals', 'assists', 'xg', 'xa', 'bps', 'saves', 'tackles', 'cbi']) a[k] += l[k] || 0;
        agg.set(l.playerId, a);
      }
    }
    const score = (a) => a.goals * 3 + a.assists * 2 + a.xg + a.xa + a.bps / 25 + (a.pos === 'GK' ? a.saves * 0.15 : 0) + (a.pos === 'DEF' ? (a.tackles + a.cbi) * 0.05 : 0);
    const stars = [...agg.values()].filter((a) => a.minutes >= 45).sort((x, y) => score(y) - score(x)).slice(0, 3).map((a) => ({
      ...a, xg: round(a.xg, 2), xa: round(a.xa, 2),
      line: [a.goals && `${a.goals} goal${a.goals > 1 ? 's' : ''}`, a.assists && `${a.assists} assist${a.assists > 1 ? 's' : ''}`, a.pos === 'GK' && a.saves && `${a.saves} save${a.saves > 1 ? 's' : ''}`,
        a.pos === 'DEF' && (a.tackles + a.cbi) && `${a.tackles + a.cbi} tackles, clearances, blocks & interceptions`, (a.xg + a.xa) >= 0.3 && `${round(a.xg + a.xa, 2)} xG+xA`].filter(Boolean).join(' · ') || `${a.minutes} minutes`,
    }));
    const before = posAt(ws); const after = posAt(Math.min(we, now.getTime()));
    const w = played.filter((f) => f.result === 'W').length; const d = played.filter((f) => f.result === 'D').length; const l = played.filter((f) => f.result === 'L').length;
    const gf = played.reduce((s, f) => s + (f.score?.spurs || 0), 0); const ga = played.reduce((s, f) => s + (f.score?.opp || 0), 0);
    // The written round-up.
    const parts = [];
    if (played.length) {
      const verdict = l === 0 && w > 0 ? (d ? 'An unbeaten week' : w > 1 ? 'A perfect week' : 'A winning week') : w === 0 && l > 0 ? (d ? 'A difficult week' : 'A week to forget') : w === 0 && l === 0 ? (d > 1 ? 'A week of draws' : 'A draw') : 'A mixed week';
      const phr = (f) => `${f.result === 'W' ? 'a win' : f.result === 'D' ? 'a draw' : 'a defeat'} ${f.home ? 'against' : 'at'} ${f.opponent} (${f.score.spurs}–${f.score.opp}${f.competition !== 'Premier League' ? `, ${f.competition}` : ''})`;
      if (played.length === 1) { const t = phr(played[0]); parts.push(`${t[0].toUpperCase()}${t.slice(1)}.`); } else
      parts.push(`${verdict}: ${list(played.map((f) => `${f.result === 'W' ? 'a win' : f.result === 'D' ? 'a draw' : 'a defeat'} ${f.home ? 'against' : 'at'} ${f.opponent} (${f.score.spurs}–${f.score.opp}${f.competition !== 'Premier League' ? `, ${f.competition}` : ''})`))}.`);
      if (played.length > 1) parts.push(`Spurs scored ${gf} and conceded ${ga} across the ${played.length} matches.`);
      if (stars[0]) parts.push(`${stars[0].name} was the standout${stars[0].line ? ` (${stars[0].line})` : ''}.`);
    } else if (inWeek.length) parts.push(`No result yet this week; ${list(inWeek.map((f) => (f.home ? `${f.opponent} at home` : `away at ${f.opponent}`)))} still to come.`);
    else parts.push('No Spurs match this week.');
    if (before && after && after.played > before.played) {
      const mv = before.position - after.position;
      parts.push(mv > 0 ? `Up ${mv} place${mv > 1 ? 's' : ''} to ${ord(after.position)} in the Premier League.` : mv < 0 ? `Down ${-mv} place${mv < -1 ? 's' : ''} to ${ord(after.position)} in the Premier League.` : `Still ${ord(after.position)} in the Premier League.`);
    } else if (after) parts.push(`${ord(after.position)} in the Premier League on ${after.points} points.`);
    if (nextWeek.length) parts.push(`Next week: ${list(nextWeek.map((f) => (f.home ? `${f.opponent} at home` : `away at ${f.opponent}`)))}.`);
    weeks.push({
      key: new Date(ws + TZ_OFFSET).toISOString().slice(0, 10), start: new Date(ws).toISOString(), end: new Date(we - 1).toISOString(), current: ws === cur,
      summary: parts.join(' '), record: { played: played.length, w, d, l, gf, ga },
      results: inWeek.map((f) => ({ id: f.id, kickoff: f.kickoff, opponent: f.opponent, opponentTeamId: f.opponentTeamId ?? null, home: f.home, competition: f.competition, score: f.score || null, result: f.result || null })),
      stars, table: { before, after },
      next: nextWeek.map((f) => ({ id: f.id, kickoff: f.kickoff, opponent: f.opponent, opponentTeamId: f.opponentTeamId ?? null, home: f.home, competition: f.competition, difficulty: f.difficulty || null })),
    });
  }
  // Team news is only known as it stands now, so it goes on the latest week.
  const out = players.filter((p) => p.current && ['i', 's', 'd'].includes(p.status)).map((p) => ({ id: p.id, name: p.web, status: p.status, news: p.news, chance: p.chanceNext, added: p.newsAdded }));
  if (weeks.length) { const lw = weeks[weeks.length - 1]; lw.teamNews = out.map((x) => ({ ...x, newThisWeek: x.added ? Date.parse(x.added) >= Date.parse(lw.start) : false })); }
  void byPlayer;
  return { weeks: weeks.reverse(), label: 'Written automatically from the stored match data and Premier League team news. Weeks run Monday to Sunday, Bahrain time.' };
}
