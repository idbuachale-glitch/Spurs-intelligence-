// Rule-based football analyst. It answers only from the stored dataset: it finds the
// metric, group and time window in the question, retrieves the numbers, and states
// season, competition, sample and source. No language model; if the data needed is
// not stored, it says what is missing instead of guessing.
import { esc, norm, fmtPlain } from './lib.js';

const METRICS = [
  { re: /take[- ]?ons?|dribbl/, key: 'takeOnPct', rate: true, alt: 'dribbles', label: 'take-on success %' },
  { re: /chances? created|key pass|creat/, key: 'chancesCreated', per90: true, label: 'chances created per 90', fallback: 'xa' },
  { re: /\bxa\b|expected assists?/, key: 'xa', per90: true, label: 'xA per 90' },
  { re: /\bxg\b|expected goals?/, key: 'xg', per90: true, label: 'xG per 90' },
  { re: /assists?/, key: 'assists', label: 'assists' },
  { re: /goals?|scor/, key: 'goals', label: 'goals' },
  { re: /shots? on target/, key: 'sot', per90: true, label: 'shots on target per 90' },
  { re: /shots?|shoot/, key: 'shots', per90: true, label: 'shots per 90' },
  { re: /pass(ing)? accuracy|pass %|passing/, key: 'passPct', rate: true, label: 'pass accuracy %' },
  { re: /tackles?/, key: 'tacklesWon', per90: true, label: 'tackles won per 90', fallback: 'tackles' },
  { re: /aerial|header|in the air/, key: 'aerialPct', rate: true, label: 'aerial duel success %' },
  { re: /duels?/, key: 'duelPct', rate: true, label: 'duel success %' },
  { re: /recover/, key: 'recoveries', per90: true, label: 'recoveries per 90' },
  { re: /intercept/, key: 'interceptions', per90: true, label: 'interceptions per 90' },
  { re: /saves?|goalkeep/, key: 'saves', per90: true, label: 'saves per 90' },
  { re: /minutes|played most/, key: 'minutes', label: 'minutes' },
];
const GROUPS = [[/attacker|forward|striker|winger/, ['FWD', 'MID'], 'attackers (forwards & midfielders)'], [/midfield/, ['MID'], 'midfielders'], [/defender|defence|centre-back|full-back/, ['DEF'], 'defenders'], [/goalkeeper|keeper/, ['GK'], 'goalkeepers']];

export function suggestions() {
  return [
    'Who has the highest take-on success rate among our attackers?',
    'Which players create the most chances per 90?',
    'How has our defensive performance changed over the last five matches?',
    'What are our biggest statistical weaknesses?',
    'Who could replace our most-used midfielder?',
    'Do we struggle against a high press?',
  ];
}

export function answer(q, ctx) {
  const t = norm(q);
  const { players, team, analysis, season } = ctx;
  const src = 'Fantasy Premier League API; match detail from FPL Core Insights (FotMob)';
  const out = (o) => ({ season, ...o });

  if (/press|pressing|counter-?press/.test(t)) {
    const a = team.overall.adv;
    return out({
      type: 'Data limitation', text: 'Pressing cannot be measured with the stored data: it needs pressure or tracking events, which no free source provides. The closest available evidence is below — possession and pass completion against each opponent — which describes how play went, not how opponents pressed.',
      table: a ? team.matches.filter((m) => m.adv).map((m) => [m.opponent, `${fmtPlain(m.adv.spurs.possession)}%`, `${fmtPlain(m.adv.spurs.passPct)}%`, `${m.gf}-${m.ga}`]) : null,
      head: ['Opponent', 'Possession', 'Pass accuracy', 'Score'], sample: a ? `${a.n} PL matches` : 'n/a', competition: 'Premier League', source: src,
    });
  }
  if (/weakness|worst|problem|struggl/.test(t)) {
    const w = analysis.squad.weaknesses.map((x) => x.text);
    const ins = analysis.insights.filter((i) => /below|more than|worsened|depends/.test(i.title + i.interpretation)).map((i) => `${i.title}: ${i.text}`);
    return out({ type: 'Calculated analysis', text: [...w, ...ins].length ? [...w, ...ins].join(' ') : 'No metric currently falls into the weakness thresholds (bottom third of the league or clear under-performance).', sample: `${team.overall.n} PL matches`, competition: 'Premier League', source: src });
  }
  if (/defen[cs]|conced|clean sheet/.test(t) && /last|recent|chang|trend|form/.test(t)) {
    const l = team.last5; const o = team.overall;
    return out({ type: 'Calculated statistics', text: `Last ${l.n} PL matches: ${l.ga} conceded (${fmtPlain(l.perMatch.ga.value, 2)} per match) from ${fmtPlain(l.perMatch.xga.value, 2)} xG against per match, ${l.cleanSheets} clean sheet(s). Season: ${fmtPlain(o.perMatch.ga.value, 2)} conceded and ${fmtPlain(o.perMatch.xga.value, 2)} xG against per match over ${o.n}.`,
      table: team.matches.slice(-5).map((m) => [m.opponent, m.ga, fmtPlain(m.xga, 2), m.adv ? fmtPlain(m.adv.opp.shots) : '—']), head: ['Opponent', 'Conceded', 'xG against', 'Shots faced'], sample: `${l.n} vs ${o.n} PL matches`, competition: 'Premier League', source: src });
  }
  if (/replace|replacement|successor|instead of/.test(t)) {
    let target = players.find((p) => p.current && t.includes(norm(p.web)));
    if (!target) {
      const g = GROUPS.find(([re]) => re.test(t));
      target = players.filter((p) => p.current && (!g || g[1].includes(p.pos))).sort((a, b) => (b.season.totals.minutes || 0) - (a.season.totals.minutes || 0))[0];
    }
    const reps = target && analysis.squad.replacements[target.id];
    if (!reps || !reps.length) return out({ type: 'Not enough data', text: 'Replacement matching needs at least 450 Premier League minutes for the player this season.', source: src });
    return out({ type: 'Algorithmic recommendation (not reporting)', text: `Players with the most similar per-90 profile to ${target.web} among Premier League ${target.pos === 'GK' ? 'goalkeepers' : target.pos === 'DEF' ? 'defenders' : target.pos === 'MID' ? 'midfielders' : 'forwards'} (450+ minutes). Fees, wages and availability are not known and not estimated.`,
      table: reps.map((r) => [r.web, r.team, r.age ?? '—', r.minutes, `${r.similarity}%`]), head: ['Player', 'Club', 'Age', 'Minutes', 'Similarity'], sample: 'Current season', competition: 'Premier League', source: 'Fantasy Premier League API' });
  }
  const names = players.filter((p) => t.includes(norm(p.web)) || (p.knownName && t.includes(norm(p.knownName))));
  const metric = METRICS.find((m) => m.re.test(t));
  if (names.length >= 2 && metric) {
    return out({ type: 'Observed data', text: `Comparison of ${metric.label}.`, table: names.slice(0, 4).map((p) => [p.web, valueOf(p, metric).text, p.season.totals.minutes ?? 0]), head: ['Player', metric.label, 'Minutes'], sample: 'Season to date', competition: 'Premier League', source: src });
  }
  if (metric) {
    const g = GROUPS.find(([re]) => re.test(t));
    let pool = players.filter((p) => p.current && (!g || g[1].includes(p.pos)) && (p.season.totals.minutes || 0) >= (metric.per90 || metric.rate ? 180 : 1));
    let m = metric;
    if (!pool.some((p) => valueOf(p, m).v !== null)) {
      if (m.fallback) { m = METRICS.find((x) => x.key === m.fallback) || { key: m.fallback, per90: true, label: m.fallback }; }
      if (!pool.some((p) => valueOf(p, m).v !== null)) {
        return out({ type: 'Data limitation', text: `${metric.label[0].toUpperCase()}${metric.label.slice(1)} is not recorded for individual players by the stored sources this season${metric.key === 'takeOnPct' ? ' (team-level take-on counts are available on the Team page)' : ''}. Nothing is estimated in its place.`, source: src });
      }
    }
    pool = pool.map((p) => ({ p, ...valueOf(p, m) })).filter((x) => x.v !== null).sort((a, b) => b.v - a.v).slice(0, 8);
    const fellBack = m !== metric ? ` ${metric.label} is not recorded for players, so ${m.label} is shown instead.` : '';
    return out({ type: m.rate ? 'Calculated statistics' : 'Observed data',
      text: `${pool[0].p.web} leads ${g ? g[2] : 'the squad'} for ${m.label} (${pool[0].text}).${fellBack}${m.rate ? ' Rates are only shown where attempts were recorded.' : ''}`,
      table: pool.map((x) => [x.p.web, x.text, x.sample]), head: ['Player', m.label, m.rate ? 'Attempts / matches' : 'Minutes'],
      sample: `Current-squad players with ${m.per90 || m.rate ? '180+' : 'any'} PL minutes`, competition: 'Premier League', source: src });
  }
  return out({ type: 'Not understood', text: 'Try asking about a statistic (goals, xG, chances created, take-ons, tackles, passing), a position group, recent defensive form, weaknesses or replacements.' });
}

function valueOf(p, m) {
  const s = p.season;
  if (m.rate) { const r = s.rates?.[m.key]; return r ? { v: r.value, text: `${r.value}%`, sample: `${r.den} att. / ${r.matches} m` } : { v: null, text: '—', sample: '' }; }
  const v = m.per90 ? s.per90?.[m.key] : s.totals?.[m.key];
  return { v: v ?? null, text: v === null || v === undefined ? '—' : m.per90 ? Number(v).toFixed(2) : String(v), sample: `${s.totals.minutes ?? 0} min` };
}

export function renderAnswer(a) {
  return `<div class="answer panel flat"><p><span class="${a.type.startsWith('Observed') ? 'label-observed' : 'label-analysis'}">${esc(a.type)}</span></p>
    <p>${esc(a.text)}</p>
    ${a.table && a.table.length ? `<div class="table-wrap"><table><thead><tr>${a.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${a.table.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
    <p class="source">${[a.season && `Season ${a.season}`, a.competition, a.sample && `Sample: ${a.sample}`, a.source && `Source: ${a.source}`].filter(Boolean).map(esc).join('. ')}.</p></div>`;
}
