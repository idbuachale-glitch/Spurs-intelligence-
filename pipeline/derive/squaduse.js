// Squad use under De Zerbi: shape and starting XI per match (ESPN team sheets) and each
// player's starts, minutes and roles (FPL minutes). Positions are as listed, not measured.
import { roleOf } from './roles.js';

export function squadUse({ fixtures, files, players, sheetOf, coachFor, leagues }) {
    const nmz = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const findPlayer = (n) => { const w = nmz(n); const last = w.split(' ').slice(-1)[0];
      return players.find((p) => nmz(p.name) === w) || players.find((p) => nmz(p.web) === w || w.endsWith(` ${nmz(p.web)}`)) || players.filter((p) => nmz(p.name).split(' ').slice(-1)[0] === last).length === 1 && players.find((p) => nmz(p.name).split(' ').slice(-1)[0] === last) || null; };
    const dz = fixtures.filter((f) => f.result && !f.friendly && coachFor(f.kickoff) === 'Roberto De Zerbi').sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    const dzMatches = []; const usage = new Map(); let prevXI = null;
    for (const f of dz) {
      const mf = files[`matches/${f.id}.json`]; const sheet = leagues[f.competition] ? sheetOf(f) : null;
      const side = sheet ? (/tottenham/i.test(sheet.home?.team || '') ? sheet.home : /tottenham/i.test(sheet.away?.team || '') ? sheet.away : null) : null;
      const starters = side ? side.starters.map((p) => { const pl = findPlayer(p.name); return { name: pl ? pl.web : (p.short || p.name), playerId: pl ? pl.id : null, role: roleOf(p.pos, side.formation) }; }) : [];
      const ids = new Set(starters.map((x) => x.playerId || x.name));
      const changes = prevXI && starters.length ? starters.filter((x) => !prevXI.has(x.playerId || x.name)).length : null;
      if (starters.length) prevXI = ids;
      dzMatches.push({ matchId: f.id, opponent: f.opponent, opponentTeamId: f.opponentTeamId ?? null, home: f.home, kickoff: f.kickoff, competition: f.competition, score: f.score, result: f.result, formation: side?.formation || null, starters, changes });
      for (const l of mf?.lineup || []) {
        if (!(l.minutes > 0)) continue;
        const u = usage.get(l.playerId) || { playerId: l.playerId, name: l.name, pos: l.pos, apps: 0, starts: 0, subApps: 0, minutes: 0, roles: {} };
        u.apps++; u.minutes += l.minutes; if (l.role === 'starter') u.starts++; else u.subApps++;
        usage.set(l.playerId, u);
      }
      for (const st of starters) { if (!st.playerId) continue; const u = usage.get(st.playerId); if (u) u.roles[st.role] = (u.roles[st.role] || 0) + 1; }
    }
    const possibleMin = dz.length * 90;
    return { coach: 'Roberto De Zerbi', matches: dzMatches,
      players: [...usage.values()].map((u) => ({ ...u, minutesShare: possibleMin ? Math.round((u.minutes / possibleMin) * 100) : null })).sort((a, b) => b.minutes - a.minutes),
      sources: ['ESPN match feed (team sheets: formation and positions as listed, not measured)', 'Fantasy Premier League API (minutes, starts)'] };
}
