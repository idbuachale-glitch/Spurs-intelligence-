// Local stand-in for the external providers, used by tests and previews.
// /fpl/*      -> reconstructed FPL API responses (or forced failures)
// /gh-raw/*   -> static files from a local clone of the community dataset
// /gh-api/*   -> GitHub "contents" directory listings for that clone
// /tsdb/*, /yt/* -> configurable (default: HTTP 503, to exercise failure handling)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function startServer({ fpl, communityRoot, failFpl = false, tsdb = null, youtube = null, port = 0 }) {
  const state = { failFpl, hits: {} };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const key = p.split('/')[1];
    state.hits[key] = (state.hits[key] || 0) + 1;
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (key === 'fpl') {
      if (state.failFpl) return json(503, { error: 'down' });
      if (p === '/fpl/bootstrap-static/') return json(200, fpl.bootstrap);
      if (p === '/fpl/fixtures/') return json(200, fpl.fixtures);
      if (p === '/fpl/regions/') return json(404, {});
      const m = p.match(/^\/fpl\/element-summary\/(\d+)\/$/);
      if (m) return json(200, { fixtures: [], history: fpl.histories.get(Number(m[1])) || [], history_past: [] });
      return json(404, {});
    }
    if (key === 'gh-raw' && communityRoot) {
      const f = path.join(communityRoot, p.replace(/^\/gh-raw\/main\//, ''));
      if (!f.startsWith(communityRoot) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(fs.readFileSync(f));
    }
    if (key === 'gh-api' && communityRoot) {
      const d = path.join(communityRoot, p.replace(/^\/gh-api\/contents\//, ''));
      if (!fs.existsSync(d)) return json(404, {});
      return json(200, fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })));
    }
    if (key === 'tsdb' && tsdb) return json(200, tsdb(p));
    if (key === 'yt' && youtube) { const body = youtube(p); if (body) { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(body); } }
    return json(503, { error: 'unavailable in harness' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, state, env: {
      FPL_BASE: `${base}/fpl`, FPL_GAP_MS: '0', FPLCORE_RAW: `${base}/gh-raw/main`, FPLCORE_API: `${base}/gh-api/contents`, TSDB_BASE: `${base}/tsdb`, YT_BASE: `${base}/yt`,
    } });
  }));
}
