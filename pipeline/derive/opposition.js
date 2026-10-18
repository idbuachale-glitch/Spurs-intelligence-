// Opposition scouting for upcoming matches, regenerated on every run so it always
// reflects the opponent's latest results, numbers and team news.
import { num } from '../lib/validate.js';
import { round, normalizePos, resultOf } from './stats.js';

const f2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// Per-club per-match averages and ranks from all league matches in the stored rounds.
export function clubProfiles(leagueMatches, teams) {
  const seen = new Set(); const by = new Map();
  const defs = {
    possession: ['possession', null, false], xg: ['expected_goals_xg', null, false], xga: [null, 'expected_goals_xg', true], shots: ['total_shots', null, false],
    shotsAgainst: [null, 'total_shots', true], sot: ['shots_on_target', null, false], bigChances: ['big_chances', null, false], bigChancesAgainst: [null, 'big_chances', true],
    passPct: ['accurate_passes_pct', null, false], xgSetPlay: ['xg_set_play', null, false], xgSetPlayAgainst: [null, 'xg_set_play', true],
    touchesOppBox: ['touches_in_opposition_box', null, false], dribbles: ['successful_dribbles', null, false], longBallPct: ['accurate_long_balls_pct', null, false],
    tacklesWon: ['tackles_won', null, false], interceptions: ['interceptions', null, false], aerialPct: ['aerial_duels_won_pct', null, false], corners: ['corners', null, false],
  };
  for (const m of leagueMatches) {
    if (seen.has(m.match_id)) continue; seen.add(m.match_id);
    for (const [side, other] of [['home', 'away'], ['away', 'home']]) {
      const code = num(m[`${side}_team`]); if (code === null) continue;
      const t = by.get(code) || { code, n: 0, sums: {}, counts: {} };
      t.n++;
      for (const [k, [own, opp]] of Object.entries(defs)) {
        const v = num(own ? m[`${side}_${own}`] : m[`${other}_${opp}`]);
        if (v === null) continue;
        t.sums[k] = (t.sums[k] || 0) + v; t.counts[k] = (t.counts[k] || 0) + 1;
      }
      const a = num(m[`${side}_opposition_half`]); const b = num(m[`${other}_opposition_half`]);
      if (a !== null && b !== null && a + b > 0) { t.sums.fieldTilt = (t.sums.fieldTilt || 0) + (a / (a + b)) * 100; t.counts.fieldTilt = (t.counts.fieldTilt || 0) + 1; }
      by.set(code, t);
    }
  }
  const keys = [...Object.keys(defs), 'fieldTilt'];
  const lower = new Set(Object.entries(defs).filter(([, d]) => d[2]).map(([k]) => k));
  const profiles = new Map();
  for (const t of by.values()) profiles.set(t.code, { code: t.code, matches: t.n, avg: Object.fromEntries(keys.map((k) => [k, t.counts[k] ? round(t.sums[k] / t.counts[k], 2) : null])), rank: {} });
  for (const k of keys) {
    const list = [...profiles.values()].filter((p) => p.avg[k] !== null).sort((x, y) => (lower.has(k) ? x.avg[k] - y.avg[k] : y.avg[k] - x.avg[k]));
    list.forEach((p, i) => { p.rank[k] = { rank: i + 1, of: list.length }; });
  }
  const leagueAvg = Object.fromEntries(keys.map((k) => { const v = [...profiles.values()].map((p) => p.avg[k]).filter((x) => x !== null); return [k, v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null]; }));
  return { profiles, leagueAvg, teamByCode: new Map(teams.map((t) => [Number(t.code), t])) };
}

export const PROFILE_LABELS = {
  possession: ['Possession', '%'], fieldTilt: ['Field tilt', '%'], xg: ['xG per match', ''], xga: ['xG conceded per match', ''], shots: ['Shots per match', ''],
  shotsAgainst: ['Shots conceded per match', ''], bigChances: ['Big chances per match', ''], bigChancesAgainst: ['Big chances conceded', ''], passPct: ['Pass accuracy', '%'],
  xgSetPlay: ['Set-piece xG per match', ''], xgSetPlayAgainst: ['Set-piece xG conceded', ''], touchesOppBox: ['Touches in opposition box', ''], dribbles: ['Successful take-ons', ''],
  longBallPct: ['Long-ball accuracy', '%'], tacklesWon: ['Tackles won', ''], interceptions: ['Interceptions', ''], aerialPct: ['Aerial duels won', '%'], corners: ['Corners', ''],
};

export function scoutReport({ fixture, opp, teams, fplFixtures, elements, table, clubs, spursId, spursCode }) {
  const oppTeam = teams.find((t) => t.id === opp);
  if (!oppTeam) return null;
  const row = table.find((r) => r.teamId === opp) || null;
  const spursRow = table.find((r) => r.teamId === spursId) || null;
  const venueOpp = fixture.home ? 'away' : 'home';
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Results this season.
  const games = fplFixtures.filter((f) => (num(f.team_h) === opp || num(f.team_a) === opp) && (f.finished || f.finished_provisional) && num(f.team_h_score) !== null)
    .sort((a, b) => String(a.kickoff_time).localeCompare(String(b.kickoff_time)))
    .map((f) => {
      const home = num(f.team_h) === opp; const gf = num(home ? f.team_h_score : f.team_a_score); const ga = num(home ? f.team_a_score : f.team_h_score);
      return { kickoff: f.kickoff_time, home, opponent: teamById.get(num(home ? f.team_a : f.team_h))?.name || '?', gf, ga, result: resultOf(gf, ga) };
    });
  const split = (rows) => ({ n: rows.length, w: rows.filter((g) => g.result === 'W').length, d: rows.filter((g) => g.result === 'D').length, l: rows.filter((g) => g.result === 'L').length, gf: rows.reduce((s, g) => s + g.gf, 0), ga: rows.reduce((s, g) => s + g.ga, 0) });
  const venueGames = games.filter((g) => (venueOpp === 'home' ? g.home : !g.home));

  // Squad: danger men and team news (FPL season totals + availability flags).
  const squad = [...elements.values()].filter((e) => num(e.team) === opp && normalizePos(e.element_type));
  const val = (e, k) => num(e[k]) ?? 0;
  const top = (fn, n = 3, min = 0) => squad.map((e) => ({ e, v: fn(e) })).filter((x) => x.v > min).sort((a, b) => b.v - a.v).slice(0, n);
  const player = (e) => ({ name: e.web_name, pos: normalizePos(e.element_type), minutes: val(e, 'minutes'), goals: val(e, 'goals_scored'), assists: val(e, 'assists'), xg: round(val(e, 'expected_goals'), 2), xa: round(val(e, 'expected_assists'), 2) });
  const dangerMen = top((e) => val(e, 'expected_goals') + val(e, 'expected_assists'), 4, 0.3).map(({ e }) => player(e));
  const topScorers = top((e) => val(e, 'goals_scored'), 3).map(({ e }) => player(e));
  const creators = top((e) => val(e, 'expected_assists'), 3, 0.2).map(({ e }) => player(e));
  const news = squad.filter((e) => ['i', 'd', 's'].includes(e.status) && val(e, 'minutes') > 0).sort((a, b) => val(b, 'minutes') - val(a, 'minutes'))
    .map((e) => ({ name: e.web_name, pos: normalizePos(e.element_type), status: { i: 'Injured', d: 'Doubtful', s: 'Suspended' }[e.status], news: e.news || null, chance: num(e.chance_of_playing_next_round), minutes: val(e, 'minutes') }));
  const keeper = top((e) => (normalizePos(e.element_type) === 'GK' ? val(e, 'minutes') : 0), 1).map(({ e }) => ({ name: e.web_name, saves: val(e, 'saves'), cs: val(e, 'clean_sheets'), gc: val(e, 'goals_conceded'), minutes: val(e, 'minutes') }))[0] || null;

  // Style profile from match data.
  const prof = clubs.profiles.get(Number(oppTeam.code)) || null;
  const mine = clubs.profiles.get(Number(spursCode)) || null;
  const profile = prof ? Object.keys(PROFILE_LABELS).filter((k) => prof.avg[k] !== null && prof.avg[k] !== undefined).map((k) => ({
    key: k, label: PROFILE_LABELS[k][0], unit: PROFILE_LABELS[k][1], value: prof.avg[k], rank: prof.rank[k]?.rank, of: prof.rank[k]?.of, leagueAvg: clubs.leagueAvg[k], spurs: mine ? mine.avg[k] : null,
  })) : [];
  const P = (k) => profile.find((x) => x.key === k);

  // Style tags.
  const tags = [];
  if (P('possession')?.rank <= 5) tags.push('Possession side'); else if (P('possession')?.rank >= 16) tags.push('Happy without the ball');
  if (P('longBallPct') && P('possession') && P('possession').value < 48 && P('aerialPct')?.rank <= 6) tags.push('Direct and strong in the air');
  if (P('xgSetPlay')?.rank <= 5) tags.push('Dangerous from set pieces');
  if (P('xga')?.rank <= 5) tags.push('Hard to create against');
  if (P('xga')?.rank >= 16) tags.push('Concede good chances');
  if (P('dribbles')?.rank <= 5) tags.push('Take players on');
  if (P('xg')?.rank <= 5) tags.push('Create a lot');
  if (P('fieldTilt')?.rank <= 5) tags.push('Pin teams back');

  // Matchup notes (rule-based): compare Spurs' profile with the opponent's.
  const notes = [];
  const s = (k) => mine?.rank?.[k]?.rank; const o = (k) => P(k)?.rank;
  if (o('xga') >= 14 && s('xg') <= 10) notes.push({ kind: 'opportunity', text: `${oppTeam.name} concede plenty of chance quality (${ord(o('xga'))} for xG conceded) and Spurs create well (${ord(s('xg'))} for xG).` });
  if (o('xga') >= 14 && s('xg') > 10) notes.push({ kind: 'opportunity', text: `${oppTeam.name} allow good chances (${ord(o('xga'))} for xG conceded), a chance for Spurs to improve on their ${ord(s('xg'))}-ranked attack.` });
  if (o('xga') <= 6) notes.push({ kind: 'threat', text: `${oppTeam.name} are hard to break down (${ord(o('xga'))} for xG conceded, ${f2(P('xga').value)} per match).` });
  if (o('xgSetPlay') <= 6) notes.push({ kind: 'threat', text: `Set pieces are a weapon for them (${ord(o('xgSetPlay'))} for set-piece xG). Spurs concede ${f2(mine?.avg?.xgSetPlayAgainst)} set-piece xG per match (${ord(s('xgSetPlayAgainst') || 0)}).` });
  if (o('possession') <= 6 && s('possession') <= 6) notes.push({ kind: 'watch', text: `Both teams want the ball (${oppTeam.name} ${f2(P('possession').value)}%, Spurs ${f2(mine?.avg?.possession)}%), so control of midfield should decide the pattern of the game.` });
  else if (o('possession') >= 15 && s('possession') <= 6) notes.push({ kind: 'watch', text: `Expect Spurs to have most of the ball; ${oppTeam.name} average only ${f2(P('possession').value)}% possession. Breaking down a low block and protecting against counters are the keys.` });
  if (o('dribbles') <= 5) notes.push({ kind: 'threat', text: `${oppTeam.name} are among the best at taking players on (${f2(P('dribbles').value)} successful take-ons per match).` });
  if (o('bigChancesAgainst') >= 15) notes.push({ kind: 'opportunity', text: `They give away big chances (${f2(P('bigChancesAgainst').value)} per match, ${ord(o('bigChancesAgainst'))}).` });
  if (dangerMen[0]) notes.push({ kind: 'threat', text: `Main danger: ${dangerMen[0].name} (${dangerMen[0].goals} goal${dangerMen[0].goals === 1 ? '' : 's'}, ${dangerMen[0].assists} assist${dangerMen[0].assists === 1 ? '' : 's'}, ${f2(dangerMen[0].xg + dangerMen[0].xa)} xG+xA this season).` });
  if (news.length) notes.push({ kind: 'watch', text: `Team news: ${news.slice(0, 4).map((n) => `${n.name} (${n.status.toLowerCase()})`).join(', ')}.` });

  const recentForm = games.slice(-5);
  return {
    opponent: oppTeam.name, short: oppTeam.short, generatedFor: fixture.id,
    table: row ? { position: row.position, played: row.played, points: row.points, won: row.won, drawn: row.drawn, lost: row.lost, gf: row.gf, ga: row.ga, gd: row.gd } : null,
    spursTable: spursRow ? { position: spursRow.position, points: spursRow.points } : null,
    form: recentForm, overall: split(games), venue: { label: venueOpp === 'home' ? 'At home' : 'Away from home', ...split(venueGames) },
    profile, profileMatches: prof?.matches ?? 0, tags, notes,
    dangerMen, topScorers, creators, keeper, news,
    label: 'Scouting generated automatically from this season\'s data; matchup notes are rule-based comparisons, not predictions.',
    sources: ['Fantasy Premier League API (results, table, player totals, availability)', prof ? 'FPL Core Insights (FotMob team match statistics)' : null].filter(Boolean),
  };
}
