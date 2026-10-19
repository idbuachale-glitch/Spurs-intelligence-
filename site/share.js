// Shareable match graphic: one tap draws a 1080×1350 image (Instagram portrait size) with
// the score, xG, a shot map, the star player and key stats, then opens the phone's share
// sheet (WhatsApp, Instagram, Photos…) or downloads the PNG where sharing isn't available.
import { state, fmtDate } from './lib.js';

export function shareButtonHtml(m) {
  if (!m?.fixture?.score) return '';
  return '<button class="btn share-btn" id="share-match">📤 Share match graphic</button>';
}

const C = { bg1: '#06102e', bg2: '#0d1f57', cyan: '#3ce8ff', white: '#f4f8ff', muted: '#93a6d8', faint: '#5b6c9c', line: 'rgba(140,180,255,0.22)', win: '#3ccf91', loss: '#ef5f74', draw: '#d9c25b' };
const crestUrl = (code) => `https://resources.premierleague.com/premierleague/badges/100/t${code}.png`;
function loadImg(src) {
  return new Promise((res) => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(null), 4000); });
}
function star(m) {
  const sc = (l) => (l.goals || 0) * 3 + (l.assists || 0) * 2 + (l.xg || 0) + (l.xa || 0) + (l.bps || 0) / 25 + (l.pos === 'GK' ? (l.saves || 0) * 0.15 : 0);
  const best = (m.lineup || []).filter((l) => (l.minutes || 0) >= 30).sort((a, b) => sc(b) - sc(a))[0];
  if (!best) return null;
  const bits = [best.goals && `${best.goals} goal${best.goals > 1 ? 's' : ''}`, best.assists && `${best.assists} assist${best.assists > 1 ? 's' : ''}`,
    best.pos === 'GK' && best.saves && `${best.saves} saves`, ((best.xg || 0) + (best.xa || 0)) >= 0.2 && `${((best.xg || 0) + (best.xa || 0)).toFixed(2)} xG+xA`,
    best.recoveries >= 6 && `${best.recoveries} recoveries`].filter(Boolean);
  return { name: best.name, line: bits.slice(0, 3).join('  ·  ') || `${best.minutes} minutes` };
}

async function draw(m, withCrests) {
  const f = m.fixture; const W = 1080; const H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  try { await document.fonts.ready; } catch { /* ignore */ }
  const disp = (sz, wt = 700) => `${wt} ${sz}px "Chakra Petch", "Barlow", Arial, sans-serif`;
  const body = (sz, wt = 500) => `${wt} ${sz}px "Barlow", Arial, sans-serif`;
  // Background
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, C.bg2); bg.addColorStop(1, C.bg1); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 300, 50, W / 2, 300, 700); glow.addColorStop(0, 'rgba(60,232,255,0.16)'); glow.addColorStop(1, 'rgba(60,232,255,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // Header
  g.fillStyle = C.cyan; g.font = disp(30, 600); g.fillText(`${f.competition.toUpperCase()}${f.gameweek ? ` · GW${f.gameweek}` : ''}`, W / 2, 86);
  g.fillStyle = C.muted; g.font = body(28); g.fillText(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 128);
  // Teams, crests, score
  const L = f.home ? 'Spurs' : f.opponent; const R = f.home ? f.opponent : 'Spurs';
  const sc = f.home ? [f.score.spurs, f.score.opp] : [f.score.opp, f.score.spurs];
  const oppCode = f.opponentTeamId ? state.meta.teamCodes?.[f.opponentTeamId] : null;
  if (withCrests) {
    const [a, b] = await Promise.all([loadImg(crestUrl(f.home ? 6 : oppCode)), loadImg(crestUrl(f.home ? oppCode : 6))]);
    if (a) g.drawImage(a, 150, 190, 150, 150); if (b) g.drawImage(b, W - 300, 190, 150, 150);
  }
  g.fillStyle = C.white; g.font = disp(44, 600);
  const fit = (t, max) => { let s = 44; g.font = disp(s, 600); while (g.measureText(t).width > max && s > 24) { s -= 2; g.font = disp(s, 600); } return t; };
  fit(L, 300); g.fillText(L, 225, 400); fit(R, 300); g.fillText(R, W - 225, 400);
  g.font = disp(170, 700); g.fillStyle = C.white; g.fillText(`${sc[0]}–${sc[1]}`, W / 2, 330);
  const res = f.result; g.font = disp(30, 700); g.fillStyle = res === 'W' ? C.win : res === 'L' ? C.loss : C.draw;
  g.fillText(res === 'W' ? 'SPURS WIN' : res === 'L' ? 'SPURS DEFEAT' : 'DRAW', W / 2, 390);
  // xG bar
  const adv = m.team?.adv; const shots = m.detail?.shots || [];
  const xs = adv?.spurs?.xg ?? shots.filter((s) => s.team === 'spurs').reduce((a, s) => a + (s.xg || 0), 0);
  const xo = adv?.opp?.xg ?? shots.filter((s) => s.team === 'opp').reduce((a, s) => a + (s.xg || 0), 0);
  const xL = f.home ? xs : xo; const xR = f.home ? xo : xs;
  g.font = disp(30, 600); g.fillStyle = C.muted; g.fillText('EXPECTED GOALS (xG)', W / 2, 478);
  g.font = disp(54, 700); g.fillStyle = C.white; g.textAlign = 'left'; g.fillText(xL.toFixed(2), 110, 548); g.textAlign = 'right'; g.fillText(xR.toFixed(2), W - 110, 548); g.textAlign = 'center';
  const bx = 280; const bw = W - 560; const tot = (xL + xR) || 1;
  g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, bx, 520, bw, 22, 11); g.fill();
  g.fillStyle = f.home ? C.cyan : '#8090c0'; rr(g, bx, 520, Math.max(22, bw * (xL / tot)), 22, 11); g.fill();
  g.fillStyle = f.home ? '#8090c0' : C.cyan; rr(g, bx + bw * (xL / tot), 520, Math.max(22, bw * (xR / tot)), 22, 11); g.fill();
  // Shot map (full pitch; Spurs attack up)
  const px = 120; const py = 600; const pw = 370; const ph = pw * (105 / 68); const s = pw / 68;
  g.strokeStyle = C.line; g.lineWidth = 3; rr(g, px, py, pw, ph, 14); g.stroke();
  g.beginPath(); g.moveTo(px, py + ph / 2); g.lineTo(px + pw, py + ph / 2); g.stroke();
  g.beginPath(); g.arc(px + pw / 2, py + ph / 2, 9.15 * s, 0, Math.PI * 2); g.stroke();
  for (const top of [true, false]) { const y0 = top ? py : py + ph - 16.5 * s; g.strokeRect(px + 13.84 * s, y0, 40.32 * s, 16.5 * s); }
  for (const sh of shots) {
    if (sh.x === null || sh.y === null) continue;
    const up = sh.team === 'spurs'; const x = px + ((up ? sh.y : 100 - sh.y) / 100) * pw; const y = up ? py + sh.x * s : py + ph - sh.x * s;
    const r = 6 + Math.sqrt(sh.xg || 0.01) * 26; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (sh.outcome === 'goal') { g.fillStyle = up ? C.cyan : '#c7d2f0'; g.fill(); } else { g.strokeStyle = up ? 'rgba(60,232,255,0.75)' : 'rgba(200,210,240,0.6)'; g.lineWidth = 3; g.stroke(); }
  }
  g.font = body(22); g.fillStyle = C.faint; g.fillText('Spurs ↑   ·   filled = goal   ·   size = xG', px + pw / 2, py + ph + 38);
  // Right column: star + stats
  const rx = 580; const rw = W - rx - 100; g.textAlign = 'left';
  const st = star(m);
  if (st) {
    g.fillStyle = 'rgba(60,232,255,0.1)'; rr(g, rx, py, rw, 170, 20); g.fill(); g.strokeStyle = 'rgba(60,232,255,0.45)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = C.cyan; g.font = disp(24, 700); g.fillText('★ STAR PLAYER', rx + 28, py + 48);
    g.fillStyle = C.white; g.font = disp(46, 700); g.fillText(st.name, rx + 28, py + 105);
    g.fillStyle = C.muted; g.font = body(26); wrap(g, st.line, rx + 28, py + 145, rw - 50, 30);
  }
  const rows = adv ? [['Possession', adv.spurs.possession, adv.opp.possession, '%'], ['Shots', adv.spurs.shots, adv.opp.shots], ['On target', adv.spurs.sot, adv.opp.sot], ['Big chances', adv.spurs.bigChances, adv.opp.bigChances], ['Pass accuracy', adv.spurs.passPct, adv.opp.passPct, '%'], ['Corners', adv.spurs.corners, adv.opp.corners]].filter((r) => r[1] !== null && r[1] !== undefined) : [];
  let y = py + 230;
  g.font = disp(22, 700); g.fillStyle = C.faint; g.fillText('SPURS', rx, y - 12); g.textAlign = 'right'; g.fillText(f.opponent.toUpperCase().slice(0, 14), rx + rw, y - 12); g.textAlign = 'left';
  for (const [lab, a, b, u = ''] of rows) {
    y += 62; g.font = disp(36, 700); g.fillStyle = C.white; g.fillText(`${a}${u}`, rx, y);
    g.textAlign = 'right'; g.fillText(`${b}${u}`, rx + rw, y); g.textAlign = 'center'; g.font = body(24); g.fillStyle = C.muted; g.fillText(lab, rx + rw / 2, y - 4); g.textAlign = 'left';
    const tt = (a + b) || 1; g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(rx, y + 14, rw, 6); g.fillStyle = C.cyan; g.fillRect(rx, y + 14, rw * (a / tt), 6);
  }
  // Footer
  g.textAlign = 'center'; g.fillStyle = C.line; g.fillRect(100, H - 120, W - 200, 2);
  g.fillStyle = C.white; g.font = disp(34, 700); g.fillText('SPURS INTELLIGENCE', W / 2, H - 66);
  g.fillStyle = C.cyan; g.font = disp(26, 700); g.fillText('COYS', W / 2, H - 30);
  return cv;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrap(g, text, x, y, max, lh) { const words = text.split(' '); let line = ''; for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > max && line) { g.fillText(line, x, y); line = w; y += lh; } else line = t; } if (line) g.fillText(line, x, y); }
const toBlob = (cv) => new Promise((res, rej) => { try { cv.toBlob((b) => (b ? res(b) : rej(new Error('empty'))), 'image/png'); } catch (e) { rej(e); } });

export async function makeGraphic(m) {
  let cv = await draw(m, true); let blob;
  try { blob = await toBlob(cv); } catch { cv = await draw(m, false); blob = await toBlob(cv); } // crests blocked: draw without them
  return blob;
}

export function bindShare(m) {
  const btn = document.getElementById('share-match'); if (!btn) return;
  btn.addEventListener('click', async () => {
    const old = btn.textContent; btn.textContent = 'Making graphic…'; btn.disabled = true;
    try {
      const blob = await makeGraphic(m);
      const f = m.fixture; const name = `spurs-${f.home ? 'v' : 'at'}-${f.opponent.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${f.score.spurs}-${f.score.opp}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `Spurs ${f.score.spurs}–${f.score.opp} ${f.opponent}` }); } catch { /* user cancelled */ }
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }
    } catch (e) { alert(`Sorry, the graphic could not be made (${e.message}).`); }
    btn.textContent = old; btn.disabled = false;
  });
}
