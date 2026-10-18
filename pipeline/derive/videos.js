// Video Evidence Room: keeps only videos that analyse how Spurs play — match reviews,
// tactical breakdowns, statistical/data videos and player-role analysis — and drops
// highlights, interviews, training clips, promos and shorts.
//
// Honesty rules: classification uses the video's title and description only (we
// cannot watch the footage). A video is linked to a match only when its title or
// description names the opponent and it was published in that match's window. We
// never claim a video shows a particular action, and no timestamps are inferred.
import { teamAliases } from './build.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Not analysis: dropped from the room (highlights stay on the match page).
const NOT_ANALYSIS = [
  /#shorts?\b/, /\bpress conference\b|\bpresser\b/, /behind the scenes|\binside training\b|\btraining\b(?! ground analysis)/,
  /\bunbox|\bkit\b|\bboots?\b|\bboot room\b/, /\bwomen\b|\bwsl\b|\bu21s?\b|\bu18s?\b|\bacademy\b|\blegends?\b/,
  /\bwatchalong\b|\blive stream\b|\blivestream\b|\bvlog\b|\bmatchday vlog\b/, /\bfifa\b|\bea fc\b|\bfc ?2[5-9]\b|\bfantasy\b|\bfpl\b/,
  /\bat home with\b|\bchallenge\b|\bquiz\b|\bin \d+(\.\d+)? seconds\b|\brecreate\b|\bpreviously against\b/,
  /\bticket|\bcompetition\b|\bgiveaway\b|\bsponsor/,
];
const HIGHLIGHTS = /\bhighlights?\b|\ball the goals\b|\bevery goal\b|\bgoals? of the\b/;
const ANALYSIS_TERMS = /analys|tactic|explain|breakdown|broken down|\bbreak(ing)? down\b|\breview\b|post[- ]match|talking points|what (we|went)|lessons|verdict|\bwhy\b|\bhow (de zerbi|spurs|tottenham|they)\b|\bsystem\b|formation|build[- ]?up|press(ing|-resist)?\b|\bshape\b|\brole\b|masterclass|\bstats?\b|statistic|\bdata\b|\bxg\b|by the numbers|\bnumbers\b|\bopta\b|\bscout|\bdeep dive|\bproblem\b|\bfix(ing|ed)?\b|\bstyle\b|\bidentity\b|\bblueprint\b|\bmonday night football\b|\bmnf\b|carragher|neville|\bpreview\b/;

const COMMON_FIRST = new Set(['jan paul', 'james', 'lucas', 'pedro', 'mohammed', 'mohamed', 'conor', 'kevin', 'micky', 'archie', 'mathys', 'destiny', 'joao', 'xavi', 'dejan', 'brennan', 'cristian', 'radu', 'pape', 'yves', 'antonin', 'kota', 'djed', 'guglielmo', 'dominic', 'randal']);

const STRONG = /analys|tactic|breakdown|broken down|explain|\bsystem\b|formation|build[- ]?up|\bpress(ing)?\b|\bshape\b|\brole\b|\bxg\b|\bstats?\b|statistic|\bdata\b|by the numbers|masterclass|deep dive|\bblueprint\b/;
const NEWSY = /transfer|injur|\bnews\b|rumou?r|\beye\b|\bmoves?\b|reveal|linked|\bbid\b|signing|available|\bsaved the club\b|when the year ends|history|frustration|\bsack|\bexit\b/;

export const CATEGORY_LABELS = {
  review: 'Match review',
  tactical: 'Tactical breakdown',
  stats: 'Stats & data',
  player: 'Player analysis',
  preview: 'Match preview',
};

export const TOPIC_RULES = [
  ['Build-up & press resistance', /build[- ]?up|playing out|from the back|goalkeeper.*(feet|distribution)|press[- ]resist|beat(ing)? the press|first phase/],
  ['Pressing & counter-press', /\bpress(ing)?\b|counter[- ]?press|high line|win(ning)? (it|the ball) back/],
  ['Attacking patterns & chance creation', /attack|chance|creat|final third|overload|half[- ]space|wing(er|s)?\b|crossing|cutback|third[- ]man/],
  ['Finishing', /finish|clinical|wasteful|conversion|\bxg\b|expected goals|big chances?/],
  ['Defending & transitions', /defen|transition|counter[- ]?attack|concede|vulnerab|back (three|four|line)|centre[- ]backs?|full[- ]?backs?|clean sheet/],
  ['Set pieces', /set[- ]piece|corner|free[- ]kick|long throw/],
  ['Midfield control', /midfield|pivot|\bdouble six\b|\bnumber (6|8|10)\b|possession|control/],
  ['De Zerbi system', /de zerbi|\bsystem\b|formation|3-2-5|4-2-3-1|4-3-3|3-4-3|identity|philosophy|style/],
];

function categorise(t, hasPlayer, hasMatch) {
  if (/\bpreview\b|\bahead of\b|\bthreat\b|how (spurs|tottenham) (can|could|should|will) (beat|stop)/.test(t)) return 'preview';
  if (/\bstats?\b|statistic|\bdata\b|\bxg\b|by the numbers|\bnumbers\b|\bopta\b/.test(t)) return 'stats';
  if (/\breview\b|post[- ]match|talking points|what we learned|lessons|verdict|\b\d+[-–]\d+\b/.test(t) && hasMatch) return 'review';
  if (hasPlayer && /\bwhy\b|\bhow\b|\brole\b|explain|analys|scout|deep dive|masterclass|perfect for|suits?/.test(t)) return 'player';
  if (hasMatch) return 'review';
  return 'tactical';
}

// Public entry point. `channels` maps channel key -> config (tier, label).
export function analysisVideos({ videos, fixtures, players = [], matchFiles = {}, channels = [] }) {
  const tierOf = new Map(channels.map((c) => [c.key, c]));
  const played = fixtures.filter((f) => f.kickoff && ['FT', 'FT_PROVISIONAL', 'LIVE'].includes(f.status));
  const upcoming = fixtures.filter((f) => f.kickoff && f.status === 'SCHEDULED');
  const names = players.filter((p) => p.current || p.lastMatch).flatMap((p) => {
    // Surnames / known names of 4+ letters; common first names alone are too ambiguous.
    const keys = new Set([p.web, ...(p.aliases || [])].map(norm).filter((n) => n.length >= 4 && !COMMON_FIRST.has(n)));
    return [...keys].map((k) => ({ key: k, id: p.id, name: p.web }));
  });
  const items = []; const highlights = [];
  for (const v of videos) {
    const title = norm(v.title); const desc = norm(v.description); const both = `${title} ${desc}`;
    const ch = tierOf.get(v.channel) || { tier: 'other', label: v.channelName };
    const spursDedicated = ch.spursOnly === true;
    const mentionsSpurs = /tottenham|\bspurs\b|de zerbi/.test(title) || (/tottenham|\bspurs\b/.test(desc) && /tottenham|\bspurs\b|de zerbi/.test(both));
    const playersIn = [...new Map(names.filter((n) => new RegExp(`\\b${n.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(title)).map((n) => [n.id, n])).values()];
    if (!spursDedicated && !mentionsSpurs) continue;
    const pub = Date.parse(v.published);
    const mentionsOpp = (f) => teamAliases(f.opponent).some((a) => both.includes(a));
    const match = played.find((f) => { const k = Date.parse(f.kickoff); return pub >= k - 1 * 3600e3 && pub <= k + 6 * 86400e3 && mentionsOpp(f); })
      || upcoming.find((f) => { const k = Date.parse(f.kickoff); return pub <= k && pub >= k - 4 * 86400e3 && mentionsOpp(f); });
    if (HIGHLIGHTS.test(title) && !/analys|tactic|review|breakdown|explain/.test(title)) {
      if (match) highlights.push(base(v, ch, match));
      continue;
    }
    if (NOT_ANALYSIS.some((r) => r.test(title))) continue;
    // Official club channel: only explicit analysis titles count. Analysis outlets:
    // their Spurs videos are analysis by nature, but still need an analysis signal.
    const signal = ANALYSIS_TERMS.test(title) || (ch.tier !== 'official' && ANALYSIS_TERMS.test(desc.slice(0, 300)));
    if (!signal) continue;
    if (ch.tier === 'official' && !/analys|tactic|explain|breakdown|stats|data|\bxg\b/.test(title)) continue;
    const category = categorise(title, playersIn.length > 0, !!match && Date.parse(match.kickoff) <= pub);
    const strong = STRONG.test(title);
    // News, transfer and nostalgia pieces are not analysis unless clearly framed as such.
    if (NEWSY.test(title) && !strong && category !== 'preview' && category !== 'review') continue;
    if (category === 'tactical' && !strong) continue;
    const topics = TOPIC_RULES.filter(([, r]) => r.test(both)).map(([l]) => l).slice(0, 4);
    const item = { ...base(v, ch, match), category, categoryLabel: CATEGORY_LABELS[category], topics, players: playersIn.map((p) => ({ id: p.id, name: p.name })) };
    if (match) item.matchStats = matchStats(matchFiles[`matches/${match.id}.json`]);
    items.push(item);
  }
  const sort = (a, b) => String(b.published).localeCompare(String(a.published));
  return { items: items.sort(sort), highlights: highlights.sort(sort) };
}

function base(v, ch, match) {
  return {
    videoId: v.videoId, title: v.title, url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`, published: v.published,
    channel: v.channelName || ch.label || v.channel, channelKey: v.channel, tier: ch.tier, tierLabel: TIER_LABELS[ch.tier] || 'Other',
    thumbnail: v.thumbnail, description: String(v.description || '').slice(0, 280),
    matchId: match ? match.id : null, opponent: match ? match.opponent : null, competition: match ? match.competition : null,
    matchKickoff: match ? match.kickoff : null,
    matchConfidence: match ? 'opponent named in title/description and published in the match window' : 'not linked to a match',
    basis: 'Classified from title and description; the footage itself has not been analysed by this site.',
  };
}

export const TIER_LABELS = {
  broadcaster: 'Broadcaster analysis',
  tactical: 'Tactical analysts',
  'spurs-review': 'Spurs match-review show',
  official: 'Official club',
};

function matchStats(mf) {
  if (!mf || !mf.fixture?.score) return null;
  const s = mf.team?.adv?.spurs; const o = mf.team?.adv?.opp;
  return {
    score: `${mf.fixture.score.spurs}–${mf.fixture.score.opp}`, result: mf.fixture.result,
    xg: s?.xg ?? mf.team?.xg ?? null, xga: o?.xg ?? mf.team?.xga ?? null,
    possession: s?.possession ?? null, shots: s?.shots ?? null, shotsAgainst: o?.shots ?? null,
    passPct: s?.passPct ?? null, boxTouches: s?.touchesOppBox ?? null,
    verdict: mf.breakdown?.verdict?.text || null,
  };
}
