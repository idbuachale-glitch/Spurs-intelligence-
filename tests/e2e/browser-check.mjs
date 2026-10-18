// Browser checks against a built site directory: every page renders without script
// errors on phone and desktop, no horizontal overflow, search autocomplete works.
// Usage: node tests/e2e/browser-check.mjs <site-dir> <screenshot-dir>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const [siteDir, shotDir] = process.argv.slice(2);
fs.mkdirSync(shotDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(siteDir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(path.resolve(siteDir)) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const routes = ['overview', 'breakdown', 'fixtures', 'players', 'team', 'tactics', 'video', 'squad', 'table', 'match', 'sources'];
const results = [];
const browser = await chromium.launch();
for (const [label, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['desktop', { width: 1366, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  const check = async (hash, name) => {
    await page.goto(`${base}#/${hash}`);
    await page.waitForFunction(() => !document.querySelector('#view .skeleton:only-child'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, error: !!document.querySelector('#view .banner.error'), text: document.querySelector('#view').innerText.slice(0, 120), h1: document.querySelector('#view h1, #view .hero')?.innerText?.slice(0, 60) }));
    await page.screenshot({ path: path.join(shotDir, `${label}-${name}.png`), fullPage: false });
    results.push({ viewport: label, page: name, overflow: info.overflow, pageError: info.error, ok: info.overflow <= 1 && !info.error, head: info.h1 });
  };
  for (const r of routes) await check(r, r);
  // Search: partial name -> suggestion -> profile.
  await page.goto(`${base}#/overview`); await page.waitForTimeout(800);
  for (const q of ['Kulu', 'sola', 'kane']) {
    await page.fill('#search', q); await page.waitForTimeout(400);
    const sugg = await page.$$eval('#suggest li[data-id]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    results.push({ viewport: label, page: `search "${q}"`, ok: sugg.length > 0, head: sugg[0] || 'no suggestion' });
  }
  await page.fill('#search', 'sola'); await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  const prof = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('#view h1')?.innerText }));
  results.push({ viewport: label, page: 'keyboard select → profile', ok: prof.hash.startsWith('#/player/') && !!prof.h1, head: `${prof.hash} ${prof.h1}` });
  await page.screenshot({ path: path.join(shotDir, `${label}-player.png`), fullPage: false });
  // First played match page.
  await page.goto(`${base}#/match`); await page.waitForTimeout(800);
  const href = await page.$$eval('#view a.fx', (as) => (as.find((a) => a.querySelector('.res') && a.href.includes('pl-')) || {}).getAttribute?.('href')).catch(() => null);
  if (href) {
    await check(href.slice(2), 'match-detail');
    const flow = await page.evaluate(() => ({ charts: document.querySelectorAll('#view .chart svg').length, tabs: document.querySelectorAll('[data-mtab]').length }));
    await page.click('[data-mtab="Defending"]').catch(() => {});
    const def = await page.evaluate(() => document.querySelector('#m-lineup th:nth-child(4)')?.innerText);
    results.push({ viewport: label, page: 'match flow charts + stat tabs', ok: flow.charts >= 3 && flow.tabs === 5 && /Tackles/.test(def || ''), head: `${flow.charts} charts, ${flow.tabs} tabs, defending tab → ${def}` });
    await page.screenshot({ path: path.join(shotDir, `${label}-match-flow.png`), fullPage: true });
  }
  results.push({ viewport: label, page: 'script errors', ok: errors.length === 0, head: errors.slice(0, 3).join(' | ') || 'none' });
  await ctx.close();
}
await browser.close(); server.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.viewport.padEnd(8)} ${r.page.padEnd(28)} ${r.overflow ? `overflow=${r.overflow}px ` : ''}${r.head || ''}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
