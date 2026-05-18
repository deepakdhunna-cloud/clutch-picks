# Verified Data Source Requirements

Runtime app data must come from verified feeds, user activity, or the production database. The app should never inject mock games, random scores, invented splits, or manually guessed prediction inputs.

## Already Wired

- Games, scores, schedules, linescores: ESPN/backend game routes.
- MLB home-plate umpire assignment: MLB Stats API schedule hydrate=officials.
- MLB home-plate umpire tendency: backend verified-feed adapter from UmpScorecards game-level public data.
- Soccer fixture congestion: ESPN schedule history.
- Soccer manager changes: backend verified-feed adapter from ESPN active team lists plus Wikidata current head-coach statements.
- EPL/MLS standings stakes: ESPN standings.
- UCL pedigree: backend verified-feed adapter from RankingUEFA five-year club coefficients.
- UCL team locations: backend verified-feed adapter for ESPN active Champions League teams and verified club home-city coordinates.
- Player injuries/availability: ESPN game summary plus PlayerAvailability ingestion rows.
- Market comparison: SharpAPI through required production `SHARPAPI_KEY`.
- Community pick percentages: backend pick stats only; hidden until enough real picks exist.

## Verified Feed URLs

These factors are release-required in production. Feed responses must match the JSON shapes in `backend/src/lib/data`.

- `MLB_UMPIRE_TENDENCY_SOURCE_URL`: verified MLB umpire tendency feed shaped like `umpireZoneTendencies.json`.
- `SOCCER_MANAGER_CHANGES_SOURCE_URL`: verified soccer manager-change feed shaped like `soccerManagerChanges.json`.
- `UCL_COEFFICIENTS_SOURCE_URL`: verified UEFA club coefficient feed shaped like `uclPedigree.json`.
- `UCL_TEAM_LOCATION_SOURCE_URL`: verified UCL team/city coordinate feed shaped like `uclCityCoords.json`.

## Provider Notes

- UmpScorecards publishes game-level public umpire data used to derive hitter/pitcher and home-team bias by umpire.
- RankingUEFA publishes a JSON five-year club coefficient feed used for UCL pedigree.
- Wikidata current head-coach statements are used only as a verified manager-change source; future/stale dates are ignored by the prediction factor.
- UCL city coordinates are static release data, tied to ESPN's active Champions League team list and kept in the backend verified-feed adapter.

## Release Rule

If a verified feed URL is missing in production, the backend must fail release readiness. If a configured provider is temporarily unavailable at runtime, the related factor must remain unavailable and explain that the source is unavailable. Do not fill the gap with mock guesses or visual QA data.
