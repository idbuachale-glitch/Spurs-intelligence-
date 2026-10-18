// Shared helpers: data loading, formatting, Bahrain time.
export const TZ = 'Asia/Bahrain';
export const state = { meta: null, status: null, seasons: null, season: null, cache: new Map(), index: null };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function load(path, { fresh = false, optional = false } = {}) {
  const key = path;
  if (!fresh && state.cache.has(key)) return state.cache.get(key);
  const v = state.meta ? encodeURIComponent(state.meta.generatedAt) : Date.now();
  const p = fetch(`data/${path}?v=${fresh ? Date.now() : v}`, { cache: fresh ? 'no-store' : 'default' }).then((r) => {
    if (!r.ok) { if (optional && r.status === 404) return null; throw new Error(`${path}: HTTP ${r.status}`); }
    return r.json();
  });
  state.cache.set(key, p);
  try { return await p; } catch (e) { state.cache.delete(key); if (optional) return null; throw e; }
}
export const loadSeason = (file, season = state.season, opts) => load(`seasons/${season}/${file}`, opts);

export function fmt(v, dp = 0, { unit = '', na = '—' } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return `<span class="na" title="Not available from the data sources">${na}</span>`;
  return `${Number(v).toFixed(dp)}${unit}`;
}
export const fmtPlain = (v, dp = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(dp));

const dtf = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) { return iso ? dtf(opts).format(new Date(iso)) : 'Date TBC'; }
export function fmtTime(iso) { return iso ? dtf({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : 'TBC'; }
export function fmtDateTime(iso) { return iso ? `${fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(iso)}` : '—'; }
export function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const statusText = { SCHEDULED: 'Scheduled', LIVE: 'Live', FT: 'Full time', FT_PROVISIONAL: 'Full time (provisional)', POSTPONED: 'Postponed / date TBC', ABANDONED: 'Abandoned' };
export const resultChip = (r, sm = false) => (r ? `<span class="res ${r}${sm ? ' sm' : ''}" title="${{ W: 'Win', D: 'Draw', L: 'Loss' }[r]}">${r}</span>` : '');

export function photoHtml(p, cls = '') {
  const initials = esc(String(p.web || p.name || '?').split(/[ .]/).filter(Boolean).map((w) => w[0]).slice(0, 2).join(''));
  if (!p.photo) return `<div class="avatar ${cls}">${initials}</div>`;
  const a = `https://resources.premierleague.com/premierleague25/photos/players/110x140/${esc(p.photo)}.png`;
  const b = `https://resources.premierleague.com/premierleague/photos/players/110x140/p${esc(p.photo)}.png`;
  return `<div class="avatar ${cls}"><img loading="lazy" alt="" src="${a}" data-fallback="${b}" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback=''}else{this.parentNode.textContent='${initials}'}"></div>`;
}

export function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

export function sortableTable(el) {
  el.querySelectorAll('th.sortable').forEach((th, idx) => {
    th.tabIndex = 0;
    const go = () => {
      const tbody = el.querySelector('tbody');
      const col = [...th.parentNode.children].indexOf(th);
      const dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
      el.querySelectorAll('th').forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir);
      const rows = [...tbody.rows];
      const val = (r) => { const c = r.cells[col]; const d = c.dataset.v; return d === undefined || d === '' ? null : Number.isNaN(Number(d)) ? d : Number(d); };
      rows.sort((a, b) => {
        const x = val(a); const y = val(b);
        if (x === null) return 1; if (y === null) return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return dir === 'ascending' ? c : -c;
      });
      rows.forEach((r) => tbody.appendChild(r));
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    void idx;
  });
}
