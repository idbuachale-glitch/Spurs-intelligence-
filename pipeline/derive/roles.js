// Readable roles and pitch positions from ESPN team-sheet position codes. ESPN labels slots
// by a formation template (in its 4-2-3-1 the two holding midfielders are "LM"/"RM"), so
// the code is read together with the listed formation.
const BACK3 = (f) => /^3|^5/.test(String(f || ''));

export function roleOf(pos, formation) {
  const p = String(pos || '').toUpperCase();
  const f = String(formation || '');
  if (p === 'G' || p === 'GK') return 'GK';
  // In ESPN's 3-1-4-2 / 4-1-x templates the single holding slot is coded SW.
  if (p === 'SW') return /^\d-1-/.test(f) ? 'DM' : 'CB';
  if (/^(CD|CB)/.test(p) || p === 'D') return 'CB';
  if (p === 'LB') return BACK3(f) ? 'LWB' : 'LB';
  if (p === 'RB') return BACK3(f) ? 'RWB' : 'RB';
  if (p === 'LWB' || p === 'RWB') return p;
  if (p === 'DM' || p === 'CDM') return 'DM';
  if (p === 'LM' || p === 'RM') {
    if (BACK3(f)) return p === 'LM' ? 'LWB' : 'RWB';
    if (/^4-2-3-1|^4-2-2-2|^4-2-4/.test(f)) return 'DM';
    return p === 'LM' ? 'LM' : 'RM';
  }
  if (/^CM/.test(p) || p === 'M') return 'CM';
  if (p === 'AM-L' || p === 'LW' || p === 'LF') return 'LW';
  if (p === 'AM-R' || p === 'RW' || p === 'RF') return 'RW';
  if (p === 'AM' || p === 'CAM') return 'AM';
  if (/^(F|CF|ST|FW)/.test(p)) return 'ST';
  return p || '?';
}

export const ROLE_LABEL = { GK: 'Goalkeeper', CB: 'Centre-back', LB: 'Left-back', RB: 'Right-back', LWB: 'Left wing-back', RWB: 'Right wing-back', DM: 'Holding midfield', CM: 'Central midfield', LM: 'Left midfield', RM: 'Right midfield', AM: 'Attacking midfield', LW: 'Left wing / inside left', RW: 'Right wing / inside right', ST: 'Striker' };

// Approximate pitch position (x 0–100 left→right, y 0–100 own goal→opponent goal) for the
// mini pitch: wide roles on the touchlines, central roles spread across the middle.
export function pitchSpots(starters, formation) {
  const Y = { GK: 6, CB: 22, LB: 28, RB: 28, LWB: 46, RWB: 46, DM: 40, CM: 52, LM: 56, RM: 56, AM: 68, LW: 72, RW: 72, ST: 87 };
  const WIDE_L = /^(LB|LWB|LW|LM)$/; const WIDE_R = /^(RB|RWB|RW|RM)$/;
  const side = (p) => { const s = String(p || '').toUpperCase(); return /-L$/.test(s) ? -1 : /-R$/.test(s) ? 1 : 0; };
  const rows = starters.map((p) => ({ name: p.short || p.name, pos: p.pos, role: roleOf(p.pos, formation) }));
  const out = [];
  const central = new Map();
  for (const p of rows) {
    if (WIDE_L.test(p.role)) out.push({ name: p.name, role: p.role, x: 12, y: Y[p.role] });
    else if (WIDE_R.test(p.role)) out.push({ name: p.name, role: p.role, x: 88, y: Y[p.role] });
    else { const k = p.role; if (!central.has(k)) central.set(k, []); central.get(k).push(p); }
  }
  for (const [role, g] of central) {
    g.sort((a, b) => side(a.pos) - side(b.pos));
    const span = g.length >= 3 ? 50 : 30;
    g.forEach((p, i) => out.push({ name: p.name, role, x: g.length === 1 ? 50 : Math.round(50 - span / 2 + (span * i) / (g.length - 1)), y: Y[role] ?? 50 }));
  }
  return out;
}
