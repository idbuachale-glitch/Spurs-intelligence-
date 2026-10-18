// League-table context: Premier League player leaders and what the other fixtures in
// Spurs' next gameweek mean for Spurs' position. Rule-based, from FPL data only.
import { num } from '../lib/validate.js';

const LEADER_DEFS = [
  ['goals', 'goals_scored', 'Top scorers'],
  ['assists', 'assists', 'Most assists'],
  ['yellows', 'yellow_cards', 'Most yellow cards'],
  ['reds', 'red_cards', 'Most red cards'],
  ['xg', 'expected_goals', 'Expected goals (xG)'],
  ['xa', 'expected_assists', 'Expected assists (xA)'],
];

// Top five (plus anyone tied with fifth, up to eight) for each measure.
export function leaders(elements, teams) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const out = {};
  for (const [key, field, title] of LEADER_DEFS) {
    const rows = elements
      .map((e) => ({ e, v: num(e[field]) }))
      .filter((x) => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v || (num(a.e.minutes) ?? 0) - (num(b.e.minutes) ?? 0));
    if (!rows.length) { out[key] = { title, rows: [], recorded: elements.some((e) => e[field] !== null && e[field] !== undefined) }; continue; }
    const cut = rows[Math.min(4, rows.length - 1)].v;
    const picked = rows.filter((x) => x.v >= cut).slice(0, 8);
    out[key] = {
      title, recorded: true,
      rows: picked.map(({ e, v }) => {
        const t = teamById.get(num(e.team));
        return { name: e.web_name, teamId: num(e.team), team: t ? t.short : null, value: Math.round(v * 100) / 100, minutes: num(e.minutes), code: e.code ? String(e.code) : null };
      }),
    };
  }
  return out;
}

const fmtPts = (n) => `${n} pt${n === 1 ? '' : 's'}`;

// What is at stake in Spurs' next (or current) gameweek.
export function roundContext({ table, fplFixtures, spursId, teams, now = new Date() }) {
  const short = new Map(teams.map((t) => [t.id, t.short]));
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const row = new Map(table.map((r) => [r.teamId, r]));
  const sp = row.get(spursId);
  if (!sp) return null;
  const spursFx = fplFixtures
    .filter((f) => (num(f.team_h) === spursId || num(f.team_a) === spursId) && f.event && f.kickoff_time)
    .sort((a, b) => String(a.kickoff_time).localeCompare(String(b.kickoff_time)));
  // The gameweek of the next unfinished Spurs league match (live counts as current).
  const target = spursFx.find((f) => !f.finished && !f.finished_provisional);
  if (!target) return null;
  const gw = num(target.event);
  const roundFx = fplFixtures.filter((f) => num(f.event) === gw && f.kickoff_time);
  const spursHome = num(target.team_h) === spursId;
  const oppId = spursHome ? num(target.team_a) : num(target.team_h);
  const day = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 10); // Bahrain date
  const spursDay = day(target.kickoff_time);

  // Range of positions Spurs could hold after the gameweek, from points alone (goal
  // difference can't be predicted, so level-on-points teams count as "could go either way").
  const playing = new Set(roundFx.filter((f) => !f.finished && !f.finished_provisional).flatMap((f) => [num(f.team_h), num(f.team_a)]));
  const others = table.filter((r) => r.teamId !== spursId);
  const spursMax = sp.points + 3;
  const bestAbove = others.filter((r) => r.points > spursMax).length; // definitely above even if they lose
  const bestTies = others.filter((r) => r.points === spursMax).length;
  const worstAbove = others.filter((r) => (playing.has(r.teamId) ? r.points + 3 : r.points) > sp.points).length;
  const worstTies = others.filter((r) => (playing.has(r.teamId) ? r.points + 3 : r.points) === sp.points).length;
  // best/worst: highest and lowest finish on points; *Gd: the alternative if goal difference decides level teams.
  const range = { current: sp.position, best: bestAbove + 1, bestNeedsGd: bestTies > 0, bestSafe: bestAbove + bestTies + 1, worst: worstAbove + worstTies + 1, worstIfGd: worstAbove + 1 };

  // A rival matters if it is within six points of Spurs (enough to change places this round).
  const near = (id) => { const r = row.get(id); return r && id !== spursId && Math.abs(r.points - sp.points) <= 6; };
  const desc = (id) => { const r = row.get(id); return `${short.get(id)} (${r.position}${r.position === 1 ? 'st' : r.position === 2 ? 'nd' : r.position === 3 ? 'rd' : 'th'}, ${fmtPts(r.points)})`; };
  const gap = (id) => row.get(id).points - sp.points; // positive = above Spurs

  const items = roundFx.filter((f) => num(f.team_h) !== spursId && num(f.team_a) !== spursId).map((f) => {
    const h = num(f.team_h); const a = num(f.team_a);
    const done = !!(f.finished || f.finished_provisional);
    const live = !done && f.started;
    const hs = num(f.team_h_score); const as = num(f.team_a_score);
    const nh = near(h); const na = near(a);
    let note = null; let wants = null; // wants: 'home' | 'away' | 'draw'
    if (nh || na) {
      if (nh && na) {
        const gh = gap(h); const ga = gap(a);
        if (gh > 0 && ga > 0) { wants = 'draw'; note = `Both ${desc(h)} and ${desc(a)} are above Spurs. A draw takes points off both.`; }
        else if (gh <= 0 && ga <= 0) { wants = 'draw'; note = `Both ${desc(h)} and ${desc(a)} are at or below Spurs. A draw stops either from jumping three points.`; }
        else {
          const above = gh > 0 ? h : a; const below = above === h ? a : h;
          wants = above === h ? 'away' : 'home';
          note = `Spurs want ${short.get(below)} to beat ${desc(above)}, who sits ${fmtPts(gap(above))} ahead.${gap(below) >= -2 ? ` ${short.get(below)} could pass Spurs with a win, though.` : ''}`;
        }
      } else {
        const rival = nh ? h : a; const g = gap(rival);
        wants = rival === h ? 'away' : 'home';
        note = g > 0
          ? `${desc(rival)} is ${fmtPts(g)} ahead. If they drop points${g <= 3 ? ' and Spurs win, Spurs can overtake' : ', Spurs close the gap'}.`
          : g === 0
            ? `${desc(rival)} is level on points. A ${short.get(rival)} slip helps Spurs pull clear.`
            : `${desc(rival)} is ${fmtPts(-g)} behind. A win${-g <= 3 ? ' could take them past Spurs if Spurs slip' : ' narrows the gap'}.`;
      }
    }
    let outcome = null;
    if ((done || live) && hs !== null && as !== null && wants) {
      const res = hs > as ? 'home' : hs < as ? 'away' : 'draw';
      outcome = res === wants ? 'good' : wants === 'draw' || res === 'draw' ? 'mixed' : 'bad';
      if (wants !== 'draw' && res === 'draw') outcome = 'mixed';
    }
    return {
      id: f.id, kickoff: f.kickoff_time, sameDay: day(f.kickoff_time) === spursDay,
      home: { teamId: h, team: name.get(h), short: short.get(h), position: row.get(h)?.position ?? null, points: row.get(h)?.points ?? null },
      away: { teamId: a, team: name.get(a), short: short.get(a), position: row.get(a)?.position ?? null, points: row.get(a)?.points ?? null },
      status: done ? 'FT' : live ? 'LIVE' : 'SCHEDULED', score: hs !== null && as !== null && (done || live) ? { home: hs, away: as } : null,
      relevant: !!note, wants, note, outcome,
    };
  }).sort((a, b) => (b.relevant - a.relevant) || String(a.kickoff).localeCompare(String(b.kickoff)));

  return {
    gameweek: gw, spurs: { position: sp.position, points: sp.points },
    spursMatch: { kickoff: target.kickoff_time, home: spursHome, opponentTeamId: oppId, opponent: name.get(oppId), opponentShort: short.get(oppId) },
    range, fixtures: items,
    label: 'Calculated from points only: goal difference and later results can change the picture. Analysis, not official.',
  };
}
