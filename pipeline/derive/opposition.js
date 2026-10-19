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
      // PPDA estimate: opponent passes in their own half per defensive action (tackles won,
      // interceptions, fouls). ppda = how hard this club presses; ppdaFaced = how hard it gets pressed.
      const acts = (sd) => { const x = [num(m[`${sd}_tackles_won`]), num(m[`${sd}_interceptions`]), num(m[`${sd}_fouls_committed`])]; return x.every((v) => v !== null) ? x.reduce((p, q) => p + q, 0) : null; };
      const oppOwn = num(m[`${other}_own_half`]); const myOwn = num(m[`${side}_own_half`]);
      const addK = (k, v) => { if (v === null || !Number.isFinite(v)) return; t.sums[k] = (t.sums[k] || 0) + v; t.counts[k] = (t.counts[k] || 0) + 1; };
      if (oppOwn !== null && acts(side)) addK('ppda', oppOwn / acts(side));
      if (myOwn !== null && acts(other)) addK('ppdaFaced', myOwn / acts(other));
      by.set(code, t);
    }
  }
  const keys = [...Object.keys(defs), 'fieldTilt', 'ppda', 'ppdaFaced'];
  const lower = new Set([...Object.entries(defs).filter(([, d]) => d[2]).map(([k]) => k), 'ppda']);
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
  ppda: ['Pressing (PPDA est., lower = harder)', ''], ppdaFaced: ['Pressed by opponents (PPDA faced)', ''],
};

export function scoutReport({ fixture, opp, teams, fplFixtures, elements, table, clubs, spursId, spursCode, spursNews = [] }) {
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

  // Rule-based matchup analysis: worries, Spurs' edges and a suggested approach.
  const s = (k) => mine?.rank?.[k]?.rank; const o = (k) => P(k)?.rank;
  const sv = (k) => mine?.avg?.[k]; const ov = (k) => P(k)?.value;
  const name = oppTeam.name;
  const worries = []; const edges = []; const plan = [];
  const ev = (...xs) => xs.filter(Boolean).join(' · ');

  // What to worry about
  if (dangerMen[0]) {
    const tot = dangerMen.reduce((a, d) => a + d.xg + d.xa, 0) || 1;
    worries.push({ text: `${dangerMen[0].name} is their main threat: ${dangerMen[0].goals} goal${dangerMen[0].goals === 1 ? '' : 's'}, ${dangerMen[0].assists} assist${dangerMen[0].assists === 1 ? '' : 's'} and ${f2(dangerMen[0].xg + dangerMen[0].xa)} xG+xA this season.`, evidence: ev(dangerMen[1] && `next: ${dangerMen[1].name} (${f2(dangerMen[1].xg + dangerMen[1].xa)})`, `${Math.round(((dangerMen[0].xg + dangerMen[0].xa) / tot) * 100)}% of their top-4 output`) });
  }
  if (o('xgSetPlay') <= 7) worries.push({ text: `Set pieces: they are ${ord(o('xgSetPlay'))} for set-piece xG (${f2(ov('xgSetPlay'))} per match).`, evidence: `Spurs concede ${f2(sv('xgSetPlayAgainst'))} set-piece xG per match (${ord(s('xgSetPlayAgainst') || 0)})` });
  if (o('xga') <= 7) worries.push({ text: `They are hard to break down: ${ord(o('xga'))} for xG conceded (${f2(ov('xga'))} per match), and Spurs are ${ord(s('xg') || 0)} for chance creation.`, evidence: `big chances conceded ${f2(ov('bigChancesAgainst'))} per match` });
  if (o('dribbles') <= 6) worries.push({ text: `Their dribblers: ${ord(o('dribbles'))} for successful take-ons (${f2(ov('dribbles'))} per match).`, evidence: '' });
  if (o('aerialPct') <= 6 && sv('aerialPct') !== null && s('aerialPct') >= 12) worries.push({ text: `In the air they win ${f2(ov('aerialPct'))}% of aerial duels (${ord(o('aerialPct'))}); Spurs win ${f2(sv('aerialPct'))}% (${ord(s('aerialPct'))}).`, evidence: '' });
  if (o('xg') <= 7) worries.push({ text: `They create a lot: ${ord(o('xg'))} for xG (${f2(ov('xg'))} per match).`, evidence: `Spurs concede ${f2(sv('xga'))} xG per match (${ord(s('xga') || 0)})` });
  if (s('sot') >= 15 && s('shots') <= 12) worries.push({ text: `Spurs' own finishing problem: plenty of shots (${f2(sv('shots'))} per match) but few on target (${f2(sv('sot'))}, ${ord(s('sot'))}).`, evidence: 'a recurring issue this season' });
  if (spursNews.length) worries.push({ text: `Spurs team news: ${spursNews.slice(0, 5).map((n) => `${n.name} (${n.status.toLowerCase()})`).join(', ')}.`, evidence: 'official Premier League availability' });

  // Where Spurs have the edge
  if (s('possession') <= 6 && o('possession') >= 12) edges.push({ text: `Control of the ball: Spurs average ${f2(sv('possession'))}% possession (${ord(s('possession'))}); ${name} average ${f2(ov('possession'))}% (${ord(o('possession'))}).`, evidence: '' });
  if (s('dribbles') <= 5) edges.push({ text: `1v1 ability: Spurs are ${ord(s('dribbles'))} for successful take-ons (${f2(sv('dribbles'))} per match)${o('tacklesWon') >= 12 ? `, and ${name} win few tackles (${ord(o('tacklesWon'))})` : ''}.`, evidence: '' });
  if (s('passPct') <= 5) edges.push({ text: `Passing security: ${f2(sv('passPct'))}% pass accuracy (${ord(s('passPct'))})${o('interceptions') >= 12 ? `, against a side that intercepts little (${ord(o('interceptions'))})` : ''}.`, evidence: '' });
  if (o('xga') >= 13) edges.push({ text: `Their defence concedes good chances: ${ord(o('xga'))} for xG conceded (${f2(ov('xga'))} per match), ${f2(ov('bigChancesAgainst'))} big chances given up per match.`, evidence: '' });
  if (s('xga') <= 8 && o('xg') >= 12) edges.push({ text: `Spurs' defence (${ord(s('xga'))} for xG conceded) faces an attack ranked ${ord(o('xg'))} for chance creation.`, evidence: '' });
  if (s('fieldTilt') <= 6 && o('fieldTilt') >= 12) edges.push({ text: `Territory: Spurs play ${f2(sv('fieldTilt'))}% of their passes in the opposition half (${ord(s('fieldTilt'))}); ${name} only ${f2(ov('fieldTilt'))}% (${ord(o('fieldTilt'))}).`, evidence: '' });
  if (news.length) edges.push({ text: `${name} are missing ${news.filter((n) => n.status !== 'Doubtful').map((n) => n.name).join(', ') || 'no one for certain'}${news.some((n) => n.status === 'Doubtful') ? `; doubtful: ${news.filter((n) => n.status === 'Doubtful').map((n) => n.name).join(', ')}` : ''}.`, evidence: 'official availability flags' });

  // Suggested approach
  if (o('possession') >= 14 && s('possession') <= 8) plan.push(`Expect a low block. Move the ball quickly from side to side and use the take-on strength to beat the first man, rather than passing around them.`);
  if (o('possession') <= 6) plan.push(`${name} like the ball too. Win the midfield battle, press their build-up and be ready to defend for spells.`);
  if (s('sot') >= 14 || (P('xga') && o('xga') >= 13)) plan.push(`Work the ball into the box before shooting. Spurs' shots are often low quality, and ${name} ${o('bigChancesAgainst') >= 12 ? 'give away big chances' : 'can be opened up'} when teams get in behind.`);
  if (o('xgSetPlay') <= 8) plan.push(`Avoid cheap fouls and corners near the box; their set pieces are a real threat.`);
  if (o('aerialPct') <= 6) plan.push(`Keep the ball on the ground in build-up; long balls play into their aerial strength.`);
  if (dangerMen[0]) plan.push(`Limit ${dangerMen[0].name}'s time on the ball${dangerMen[0].pos === 'FWD' ? ' in and around the box' : ' between the lines'}.`);
  if (o('dribbles') <= 6) plan.push(`Defend their wide players in pairs and stay on your feet against their dribblers.`);
  if (s('possession') <= 6) plan.push(`Keep the rest-defence structure behind the ball to stop counter-attacks when possession is lost.`);
  const recentForm = games.slice(-5);
  return {
    opponent: oppTeam.name, short: oppTeam.short, generatedFor: fixture.id,
    table: row ? { position: row.position, played: row.played, points: row.points, won: row.won, drawn: row.drawn, lost: row.lost, gf: row.gf, ga: row.ga, gd: row.gd } : null,
    spursTable: spursRow ? { position: spursRow.position, points: spursRow.points } : null,
    form: recentForm, overall: split(games), venue: { label: venueOpp === 'home' ? 'At home' : 'Away from home', ...split(venueGames) },
    profile, profileMatches: prof?.matches ?? 0, tags, worries, edges, plan,
    dangerMen, topScorers, creators, keeper, news,
    label: 'Rebuilt on every update from this season\'s data. The worries, edges and approach are rule-based readings of the numbers, not predictions or coaching advice.',
    sources: ['Fantasy Premier League API (results, table, player totals, availability)', prof ? 'FPL Core Insights (FotMob team match statistics)' : null].filter(Boolean),
  };
}
