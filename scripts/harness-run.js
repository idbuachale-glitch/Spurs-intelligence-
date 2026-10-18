#!/usr/bin/env node
// Runs the real sync pipeline against the local provider harness.
// Usage: node scripts/harness-run.js <community-repo-root> <site-out-dir> <state-dir> [--fail-fpl]
import fs from 'node:fs';
import path from 'node:path';
import { reconstruct } from '../tests/harness/reconstruct.js';
import { startServer } from '../tests/harness/server.js';

const [communityRoot, siteOut, stateDir] = process.argv.slice(2);
const failFpl = process.argv.includes('--fail-fpl');
const fpl = reconstruct(path.join(communityRoot, 'data', '2026-2027'));
const h = await startServer({ fpl, communityRoot: path.resolve(communityRoot), failFpl });
Object.assign(process.env, h.env, { SPURS_QUIET: process.env.SPURS_QUIET ?? '1' });
fs.mkdirSync(siteOut, { recursive: true });
const { runSync } = await import('../pipeline/sync.js');
try {
  const r = await runSync({ force: true, siteData: path.resolve(siteOut), stateDir: path.resolve(stateDir) });
  console.log(JSON.stringify({ ok: true, season: r.season, changed: r.changed, persistent: r.persistent.map(([k]) => k), hits: h.state.hits }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message, hits: h.state.hits }));
  process.exitCode = 1;
} finally { h.server.close(); }
