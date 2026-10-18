#!/usr/bin/env node
// One-off historical backfill from the archived FPL dataset maintained at
// github.com/vaastav/Fantasy-Premier-League (MIT licence), which snapshots the same
// official FPL API. Produces past seasons in exactly the live-season format.
// Usage: node scripts/backfill-history.js <path-to-repo>/data 2020-21 2021-22 ...
import fs from 'node:fs';
import path from 'node:path';
import { buildSeason } from '../pipeline/derive/build.js';
import { writeJson, readJson } from '../pipeline/lib/store.js';
import { SITE_DATA } from '../pipeline/config.js';

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const csv = (f) => parseCsv(fs.readFileSync(f, 'utf8'));

export function backfillSeason(dataDir, season, outDir = SITE_DATA) {
  const dir = path.join(dataDir, season);
  const teamsRaw = csv(path.join(dir, 'teams.csv'));
  const teams = teamsRaw.map((t) => ({ id: Number(t.id), name: t.name, short: t.short_name }));
  const spurs = teams.find((t) => t.name === 'Spurs' || t.short === 'TOT');
  if (!spurs) throw new Error(`${season}: Spurs not found`);
  const fixtures = csv(path.join(dir, 'fixtures.csv')).map((f) => ({
    ...f, id: Number(f.id), event: f.event === '' || f.event === 'None' ? null : Number(f.event), team_h: Number(f.team_h), team_a: Number(f.team_a),
    team_h_score: f.team_h_score === '' || f.team_h_score === 'None' ? null : Number(f.team_h_score),
    team_a_score: f.team_a_score === '' || f.team_a_score === 'None' ? null : Number(f.team_a_score),
    finished: f.finished === 'True', finished_provisional: f.finished_provisional === 'True', started: f.started === 'True',
  }));
  const raw = csv(path.join(dir, 'players_raw.csv'));
  const elements = new Map(raw.map((e) => [Number(e.id), { ...e, id: Number(e.id), team: Number(e.team) }]));
  const gw = csv(path.join(dir, 'gws', 'merged_gw.csv'));
  const histories = new Map();
  for (const r of gw) {
    if (r.team && r.team !== 'Spurs') continue;
    const id = Number(r.element);
    if (!histories.has(id)) histories.set(id, []);
    histories.get(id).push(r);
    if (!elements.has(id)) elements.set(id, { id, code: null, web_name: r.name, first_name: r.name, second_name: '', element_type: r.position });
  }
  // Archived players_raw lists a player's club at season end; include anyone with Spurs minutes.
  const built = buildSeason({
    season, generatedAt: new Date().toISOString(), isCurrent: false, teams, spursId: spurs.id, fplFixtures: fixtures, elements, histories,
    aliases: readJson(new URL('../pipeline/aliases.json', import.meta.url).pathname, {}), sourceRef: 'Fantasy Premier League API (archived by vaastav/Fantasy-Premier-League, MIT)',
  });
  let n = 0;
  for (const [rel, data] of Object.entries(built.files)) {
    if (rel === 'evidence.json') continue;
    data.archived = true;
    if (writeJson(path.join(outDir, 'seasons', season, rel), data)) n++;
  }
  return { season, files: n, players: built.players.length, matches: built.teamMatches.length, position: built.table.find((r) => r.teamId === spurs.id)?.position };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dataDir, ...seasons] = process.argv.slice(2);
  for (const s of seasons) console.log(JSON.stringify(backfillSeason(dataDir, s)));
}
