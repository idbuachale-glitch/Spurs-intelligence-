import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aggregate, per90, leagueTable, playerMatch } from '../pipeline/derive/stats.js';
import { blankUnrecordedStats, fplFixtureStatus } from '../pipeline/derive/build.js';
import { analysisVideos } from '../pipeline/derive/videos.js';
import { recordedColumns, playerRow, opponentFromSlug, parseCsv } from '../pipeline/adapters/fplcore.js';
import { parseFeed } from '../pipeline/adapters/youtube.js';
import { normalizeEvent } from '../pipeline/adapters/thesportsdb.js';
import { seasonFromEvents, resolveTeamId } from '../pipeline/adapters/fpl.js';
import { redact } from '../pipeline/lib/http.js';
import { num } from '../pipeline/lib/validate.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('missing values stay missing, never zero', () => {
  assert.equal(num(''), null); assert.equal(num('None'), null); assert.equal(num(undefined), null); assert.equal(num('0.34'), 0.34);
  assert.equal(per90(3, 0), null); assert.equal(per90(null, 900), null); assert.equal(per90(3, 270), 1);
  const a = aggregate([{ minutes: 90, goals: 1, xg: null }, { minutes: 90, goals: 0, xg: 0.5 }]);
  assert.equal(a.totals.xg, 0.5);
  assert.deepEqual(a.coverage.xg, { reported: 1, of: 2 });
  assert.equal(a.per90.xg, 0.5, 'per-90 uses only minutes from matches that report the stat');
  assert.equal(a.totals.shots, null, 'a stat never reported is null');
  assert.equal(a.rates.takeOnPct, null);
});

test('provider zeros before a stat existed become unavailable', () => {
  const rows = new Map();
  for (let i = 0; i < 11; i++) rows.set(i, [{ matchId: 'm1', minutes: 90, xg: 0, xa: 0, xgc: 0, tackles: 1, recoveries: 3, cbi: 1 }]);
  blankUnrecordedStats(rows);
  assert.equal(rows.get(0)[0].xg, null);
  assert.equal(rows.get(0)[0].tackles, 1, 'recorded stats untouched');
});

test('community columns: blank-for-everyone = unavailable, blank-for-one = zero', () => {
  const raw = [
    { player_id: '1', match_id: 'x', minutes_played: '90', total_shots: '3', successful_dribbles: '', tackles_won: '2' },
    { player_id: '2', match_id: 'x', minutes_played: '45', total_shots: '', successful_dribbles: '', tackles_won: '' },
  ];
  const rec = recordedColumns(raw);
  const p2 = playerRow(raw[1], true, rec);
  assert.equal(p2.shots, 0); assert.equal(p2.tacklesWon, 0); assert.equal(p2.dribbles, null);
  const unprocessed = playerRow(raw[1], false, rec);
  assert.equal(unprocessed.shots, null, 'unprocessed matches never get zeros');
});

test('derived attempts and success rate use the same matches', () => {
  const r = playerRow({ player_id: '1', minutes_played: '90', successful_dribbles: '3', successful_dribbles_percent: '50' }, true);
  assert.equal(r.dribbleAtt, 6);
  const a = aggregate([{ minutes: 90, dribbles: 3, dribbleAtt: 6 }, { minutes: 90, dribbles: 0, dribbleAtt: null }]);
  assert.deepEqual(a.rates.takeOnPct, { value: 50, num: 3, den: 6, matches: 1 });
});

test('league table ordering and archived final positions', () => {
  const teams = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const fx = [{ homeId: 1, awayId: 2, hs: 2, as: 0, counted: true }, { homeId: 2, awayId: 3, hs: 1, as: 1, counted: true }, { homeId: 3, awayId: 1, hs: 0, as: 0, counted: true }, { homeId: 1, awayId: 3, hs: null, as: null, counted: false }];
  const t = leagueTable(fx, teams);
  assert.deepEqual(t.map((r) => [r.team, r.points, r.played]), [['A', 4, 2], ['C', 2, 2], ['B', 1, 2]]);
  const known = { '2020-21': 7, '2021-22': 4, '2022-23': 8, '2023-24': 5, '2024-25': 17, '2025-26': 17 };
  for (const [s, pos] of Object.entries(known)) {
    const f = path.join(ROOT, 'site/data/seasons', s, 'table.json');
    if (!fs.existsSync(f)) continue;
    assert.equal(JSON.parse(fs.readFileSync(f)).spurs.position, pos, `${s} final position`);
  }
});

test('fixture status handles postponed, live and provisional', () => {
  assert.equal(fplFixtureStatus({ event: null, kickoff_time: null }), 'POSTPONED');
  assert.equal(fplFixtureStatus({ event: 5, kickoff_time: 'x', started: true }), 'LIVE');
  assert.equal(fplFixtureStatus({ event: 5, kickoff_time: 'x', started: true, finished_provisional: true }), 'FT_PROVISIONAL');
  assert.equal(fplFixtureStatus({ event: 5, kickoff_time: 'x', finished: true }), 'FT');
});

test('history rows map to records with nulls for absent fields', () => {
  const r = playerMatch({ fixture: '3', minutes: '90', goals_scored: '1', was_home: 'True' });
  assert.equal(r.goals, 1); assert.equal(r.home, true); assert.equal(r.xg, null);
});

test('provider adapters parse real-shaped payloads', () => {
  assert.equal(opponentFromSlug('26-27-efl-cup-tottenham-hotspur-vs-charlton-athletic-2026-08-24'), 'Charlton Athletic');
  assert.equal(opponentFromSlug('26-27-friendly-auckland-fc-vs-tottenham-hotspur-2026-07-26'), 'Auckland FC');
  assert.deepEqual(parseCsv('a,b\n1,"x,y"\n'), [{ a: '1', b: 'x,y' }]);
  const feed = parseFeed(`<feed><title>Tottenham Hotspur</title><author><name>Tottenham Hotspur</name></author><entry><yt:videoId>abcdefghijk</yt:videoId><title>HIGHLIGHTS | Spurs 2-1 Coventry City</title><published>2026-10-20T10:00:00+00:00</published><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/></entry></feed>`);
  assert.equal(feed.author, 'Tottenham Hotspur'); assert.equal(feed.entries[0].videoId, 'abcdefghijk');
  const tsdb = normalizeEvent({ idEvent: '9', idHomeTeam: '133616', idAwayTeam: '1', strHomeTeam: 'Tottenham', strAwayTeam: 'Charlton', intHomeScore: '5', intAwayScore: '1', strStatus: 'FT', strLeague: 'EFL Cup', strTimestamp: '2026-08-26T18:45:00' }, '133616');
  assert.deepEqual(tsdb.score, { spurs: 5, opp: 1 }); assert.equal(tsdb.status, 'FT');
  assert.equal(seasonFromEvents([{ deadline_time: '2026-08-21T17:30:00Z' }]), '2026-27');
  assert.equal(resolveTeamId([{ id: 19, name: 'Spurs', short_name: 'TOT' }, { id: 1, name: 'Arsenal', short_name: 'ARS' }], ['spurs', 'tot']), 19);
});

test('video room keeps only Spurs analysis; highlights go to the match page', () => {
  const fx = [{ id: 'pl-1', kickoff: '2026-10-19T19:00:00Z', status: 'FT', opponent: 'Coventry City', competition: 'Premier League' }];
  const channels = [{ key: 'spurs', tier: 'official', spursOnly: true }, { key: 'sky', tier: 'broadcaster' }, { key: 'athletic', tier: 'tactical' }, { key: 'lwos', tier: 'spurs-review', spursOnly: true }];
  const players = [{ id: 'p1', web: 'Solanke', aliases: ['Dominic', 'Solanke'], current: true }];
  const v = (id, channel, title, published = '2026-10-20T10:00:00Z', description = '') => ({ videoId: id.padEnd(11, 'x'), channel, title, published, description });
  const videos = [
    v('a', 'spurs', 'HIGHLIGHTS | Spurs 2-1 Coventry City'),
    v('b', 'spurs', 'Behind the scenes at Spurs training!'),
    v('c', 'spurs', 'Getting set for Coventry 🏋️', '2026-10-18T10:00:00Z'),
    v('d', 'sky', 'Carragher analyses how De Zerbi\'s Spurs beat the Coventry press', '2026-10-20T21:00:00Z'),
    v('e', 'sky', 'Arsenal 3-0 Chelsea | Highlights'),
    v('f', 'athletic', 'Why Solanke is perfect for De Zerbi\'s Tottenham', '2026-10-01T10:00:00Z'),
    v('g', 'lwos', 'Spurs 2-1 Coventry | Post Match Analysis', '2026-10-19T22:30:00Z'),
    v('h', 'athletic', 'Tottenham by the numbers: xG, field tilt and the 3-2-5', '2026-10-05T10:00:00Z'),
    v('i', 'sky', 'Spurs fans react #shorts'),
    v('j', 'lwos', 'Van De Ven AVAILABLE • Spurs EYE Alvarez MOVES • Conte FRUSTRATION Revealed'),
    v('k', 'lwos', 'WHEN The YEAR Ends In ONE • HOW Tottenham Hotspur WINNING The FA Cup SAVED The Club!'),
    v('l', 'lwos', 'De Zerbi PRESSURE • Savio INJURY Setback • Coventry PREVIEW', '2026-10-17T10:00:00Z'),
  ];
  const { items, highlights } = analysisVideos({ videos, fixtures: fx, players, channels });
  const byId = Object.fromEntries(items.map((i) => [i.videoId[0], i]));
  assert.deepEqual(Object.keys(byId).sort(), ['d', 'f', 'g', 'h', 'l']); assert.equal(byId.l.category, 'preview');
  assert.equal(highlights.length, 1); assert.equal(highlights[0].matchId, 'pl-1');
  assert.equal(byId.d.matchId, 'pl-1'); assert.equal(byId.d.category, 'review'); assert.ok(byId.d.topics.includes('Pressing & counter-press'));
  assert.equal(byId.f.category, 'player'); assert.deepEqual(byId.f.players.map((p) => p.id), ['p1']); assert.equal(byId.f.matchId, null);
  assert.equal(byId.g.category, 'review'); assert.equal(byId.h.category, 'stats');
});

test('strengths and weaknesses compare a player with his position group', async () => {
  const { fotmobPool, strengthsProfile } = await import('../pipeline/derive/profile.js');
  const els = new Map(); const rows = [];
  for (let i = 1; i <= 12; i++) {
    els.set(i, { id: i, element_type: 3 });
    for (let m = 1; m <= 4; m++) rows.push({ player_id: String(i), match_id: `m${m}`, minutes_played: '90', tackles_won: String(i === 1 ? 6 : 1), fouls_committed: String(i === 1 ? 5 : 1), chances_created: '1', total_shots: '1', accurate_passes: '40', accurate_passes_percent: '80' });
  }
  const pool = fotmobPool(rows, els);
  const prof = strengthsProfile({ player: { elementId: 1, pos: 'MID', web: 'Test' }, fotPool: pool, fplPct: null, minMinutes: 180 });
  assert.ok(prof.strengths.some((m) => m.key === 'tacklesWon'), 'most tackles = strength');
  assert.ok(prof.weaknesses.some((m) => m.key === 'foulsCommitted'), 'most fouls = weakness (lower is better)');
  assert.equal(prof.metrics.find((m) => m.key === 'tacklesWon').value, 6);
  const none = strengthsProfile({ player: { elementId: 99, pos: 'MID', web: 'New' }, fotPool: pool, fplPct: null, minMinutes: 180 });
  assert.equal(none.metrics.length, 0);
});

test('goalkeeper passing comes from the goalkeeper columns, never a fabricated zero', async () => {
  const { playerRow } = await import('../pipeline/adapters/fplcore.js');
  const rec = new Set(['accurate_passes', 'accurate_long_balls', 'gk_accurate_passes']);
  const gk = playerRow({ player_id: '496', match_id: 'm', minutes_played: '90', gk_accurate_passes: '16', gk_accurate_long_balls: '1' }, true, rec);
  assert.equal(gk.passesAcc, 16); assert.equal(gk.longBallsAcc, 1);
});

test('credentials never appear in logs or the public site', () => {
  assert.equal(redact('https://www.thesportsdb.com/api/v1/json/SECRETKEY/eventslast.php?id=1').includes('SECRETKEY'), false);
  const siteFiles = fs.readdirSync(path.join(ROOT, 'site')).filter((f) => /\.(js|html)$/.test(f));
  for (const f of siteFiles) {
    const t = fs.readFileSync(path.join(ROOT, 'site', f), 'utf8');
    assert.equal(/X-Auth-Token|FOOTBALL_DATA_KEY|GITHUB_TOKEN|api[_-]?key\s*[:=]/i.test(t), false, `${f} must not reference credentials`);
  }
});

test('loans and departures are not in the current squad', async () => {
  const { squadMembership } = await import('../pipeline/derive/build.js');
  const teams = new Map([[19, { id: 19, name: 'Spurs' }], [7, { id: 7, name: 'Chelsea' }]]);
  assert.equal(squadMembership({ team: 19, status: 'a' }, 19, teams).state, 'current');
  assert.equal(squadMembership({ team: 19, status: 'i', news: 'Knee injury' }, 19, teams).state, 'current');
  assert.equal(squadMembership({ team: 19, status: 'u', news: 'Has joined Juventus on loan for the rest of the season' }, 19, teams).state, 'loan');
  assert.equal(squadMembership({ team: 19, status: 'u', news: 'Has joined Atletico Madrid permanently' }, 19, teams).state, 'left');
  assert.equal(squadMembership({ team: 7, status: 'a' }, 19, teams).note, 'Now at Chelsea');
  assert.equal(squadMembership({ team: 19, status: 'u', news: 'not included in squad.' }, 19, teams).state, 'unregistered');
});
