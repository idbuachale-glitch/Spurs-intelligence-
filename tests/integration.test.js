// End-to-end pipeline tests against the local provider harness. Needs a local clone
// of the community dataset (set COMMUNITY_DATA=/path/to/FPL-Elo-Insights); skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconstruct } from './harness/reconstruct.js';
import { startServer } from './harness/server.js';

const community = process.env.COMMUNITY_DATA;
const skip = !community || !fs.existsSync(path.join(community, 'data', '2026-2027')) ? 'COMMUNITY_DATA not set' : false;

test('sync: real-shaped data, idempotent, failure-preserving', { skip, timeout: 1200000 }, async () => {
  const fpl = reconstruct(path.join(community, 'data', '2026-2027'));
  const h = await startServer({ fpl, communityRoot: path.resolve(community) });
  Object.assign(process.env, h.env, { SPURS_QUIET: '1' });
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'si-site-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-state-'));
  const { runSync } = await import('../pipeline/sync.js');
  try {
    const t0 = new Date('2026-10-18T11:00:00Z');
    const first = await runSync({ now: t0, force: true, siteData: site, stateDir });
    assert.equal(first.season, '2026-27');
    const D = (f) => JSON.parse(fs.readFileSync(path.join(site, 'seasons', '2026-27', f)));
    const fx = D('fixtures.json').fixtures;
    // Real results from the source data.
    const brentford = fx.find((f) => f.competition === 'Premier League' && f.opponent === 'Brentford' && f.status === 'FT');
    assert.deepEqual(brentford.score, { spurs: 0, opp: 3 });
    assert.ok(fx.some((f) => f.competition === 'EFL Cup' && f.opponent === 'Charlton Athletic' && f.score.spurs === 5));
    // Unique IDs: no duplicated matches or players.
    assert.equal(new Set(fx.map((f) => f.id)).size, fx.length);
    const ps = D('players.json').players;
    assert.equal(new Set(ps.map((p) => p.id)).size, ps.length);
    // Player stats equal the sum of the source's per-match rows.
    const p = ps.find((x) => x.season.apps > 3);
    const pm = JSON.parse(fs.readFileSync(path.join(site, 'seasons', '2026-27', 'players', `${p.id}.json`))).matches.filter((m) => m.comp === 'Premier League');
    assert.equal(p.season.totals.minutes, pm.reduce((s, m) => s + (m.minutes || 0), 0));
    const srcRows = fpl.histories.get(p.elementId) || [];
    assert.equal(p.season.totals.minutes, srcRows.reduce((s, r) => s + r.minutes, 0), 'minutes match source');
    const snapshot = fs.readFileSync(path.join(site, 'seasons', '2026-27', 'fixtures.json'), 'utf8');

    // Second run with identical data: nothing duplicated, data files unchanged.
    const second = await runSync({ now: new Date(t0.getTime() + 25 * 60000), force: true, siteData: site, stateDir });
    assert.equal(fs.readFileSync(path.join(site, 'seasons', '2026-27', 'fixtures.json'), 'utf8').length, snapshot.length);
    assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'seasons', '2026-27', 'fixtures.json'))).fixtures.length, fx.length);
    assert.ok(second.changed <= 3, `only status/meta-type files should change, got ${second.changed}`);

    // Provider outage: last valid data preserved, failure recorded, never reported as success.
    h.state.failFpl = true;
    await runSync({ now: new Date(t0.getTime() + 50 * 60000), force: true, siteData: site, stateDir });
    const after = JSON.parse(fs.readFileSync(path.join(site, 'seasons', '2026-27', 'fixtures.json')));
    assert.equal(after.fixtures.length, fx.length);
    const st = JSON.parse(fs.readFileSync(path.join(site, 'status.json')));
    assert.equal(st.sources['fpl-core'].consecutiveFailures, 1);
    assert.ok(st.sources['fpl-core'].lastSuccess < st.sources['fpl-core'].lastFailure);
    // Recovery.
    h.state.failFpl = false;
    await runSync({ now: new Date(t0.getTime() + 75 * 60000), force: true, siteData: site, stateDir });
    assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'status.json'))).sources['fpl-core'].consecutiveFailures, 0);
  } finally { h.server.close(); }
});
