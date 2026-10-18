# Spurs Intelligence

A self-updating Tottenham Hotspur analytics site. Every 20 minutes a scheduled GitHub Actions job collects fixtures, results, player and team statistics, video links and analysis, validates them, stores them in this repository and republishes the site on GitHub Pages. Nobody needs to run anything.

## How it works

```
GitHub Actions (every 20 min) ──► pipeline/sync.js
   │  fetches ──► FPL API · FPL Core Insights dataset · TheSportsDB · YouTube RSS · Wikipedia
   │  validates, merges, derives stats, writes analysis
   ├─► commits data to this repo (the database; git history = versioned backups)
   └─► deploys site/ to GitHub Pages
```

- **No server, no database bill.** Data is JSON in `site/data/`; durable pipeline state in `state/`. A run with no new football data makes no data commit.
- **Failures never erase data.** Each source is fetched, validated and written independently. If one fails, the last valid data stays, the site shows a warning, and retries continue. After six consecutive failures the run is marked failed, so GitHub emails the repository owner.
- **Missing stays missing.** Statistics the sources do not provide are shown as "—" and listed on the Data sources page; zeros the provider reports before it began recording a stat are converted to "unavailable".

## Data sources

| Source | Used for | Key needed | Cost |
|---|---|---|---|
| [Fantasy Premier League API](https://fantasy.premierleague.com/api/bootstrap-static/) (Premier League) | PL fixtures, results, table, squad, availability, per-match player stats incl. Opta xG/xA/xGC, tackles, CBI, recoveries | No | Free |
| [FPL Core Insights](https://github.com/olbauday/FPL-Elo-Insights) (community dataset; match data collected from FotMob) | Shots, passing, possession, duels, shot locations, set-piece split, cup & European matches | No | Free |
| [TheSportsDB](https://www.thesportsdb.com) | Cross-check of scores, non-PL fixtures | Public test key | Free |
| YouTube RSS — official Spurs & Premier League channels | Video metadata and embeds | No | Free |
| Wikipedia API | Current head coach (era labels) | No | Free |
| football-data.org *(optional)* | Independent PL table check | Free key (`FOOTBALL_DATA_KEY` secret) | Free |

Historical seasons 2020/21–2025/26 were backfilled from the archived FPL data at [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) (MIT).

To switch the community dataset off: repository Settings → Secrets and variables → Actions → Variables → add `SUPPLEMENTARY_STATS` = `off`.

## Development

```
node pipeline/sync.js --force          # run a full sync locally (needs internet access to the sources)
node --test tests/*.test.js            # unit tests; set COMMUNITY_DATA=<clone of FPL-Elo-Insights> for integration tests
node scripts/backfill-history.js <vaastav-repo>/data 2024-25   # rebuild an archived season
```

No npm dependencies. Node 20+.
