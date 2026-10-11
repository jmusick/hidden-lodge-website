# Operations history

Migrated from the Obsidian technical note on 2026-10-11. The following is dated history, not current deployment or migration state. Current setup is in [README.md](../README.md), coding guidance in [AGENTS.md](../AGENTS.md), and hosting in [deployment.md](deployment.md). Historical Pages/cron-job.org notes and old Pull Score formulas are retained to explain prior fixes; do not use them as current instructions.

# Hidden Lodge technical notes

Operational notes for [Hidden Lodge](../README.md), focused on the website component. The source repository's `README.md` and `AGENTS.md` remain the authoritative setup and implementation references.

## Architecture

- Runtime:
  - Astro 6 with server output (`output: "server"`).
  - Cloudflare Pages/Workers through `@astrojs/cloudflare`.
- Data:
  - Cloudflare D1 (binding `DB`), raw SQL via `env.DB.prepare(...)` — no ORM.
  - Schema is sequential, additive migration files in `migrations/*.sql`; an already-applied migration is never edited.
- Authentication:
  - Blizzard Battle.net OAuth2 for member login; guild rank from the Blizzard API determines admin/officer access.
  - Sessions are D1-backed with an HTTP-only cookie.
- Feature flags:
  - `src/lib/feature-flags.ts` (`FEATURE_FLAGS`) gates raid signups, roster teams, attendance, death analysis, applications, feedback, tools (trinkets/professions/loot history/upgrades), and interactive sim tools — code and data are preserved, not removed.
  - As of 2026-09-22: `deathAnalysis`, `mechanicsAnalysis`, `raidComp`, `parseAnalysis`, and `tools` are on; `attendance` (the old signup-based pipeline), `raidSignups`, `rosterTeams`, `applications`, `feedback`, and `sim` are off. See [[#Death Analysis (Season 2)]] and [[#Parse Analysis (Pull Score)]].
  - `parseAnalysis` gates only the `/parse-analysis` page and the profile's Pull Score History panel — Raid Comp's own Pull Score sync/scoring runs off `deathAnalysis` alone, so turning this flag off doesn't touch scoring.
  - Tools menu (each entry gated on its own flag, not the menu as a whole): Gear Summary (`/raiders/gear-summary`, moved off a button on `/raiders` 2026-09-11), Professions, Loot History, Death Analysis, Mechanics Analysis, Raid Composition, Parse Analysis.
  - `/trinkets`, `/upgrades`, and `/signup` still redirect to `/hiatus` via `HIATUS_PATHS` in `src/middleware.ts` and are hidden from the Tools menu for now; `/professions` was unblocked for Season 2 on 2026-09-11, and `/loot-history` was unblocked (removed from `HIATUS_PATHS`, re-added to the Tools menu) on 2026-09-20.

## Design system migration

Started 2026-09-20. Audit found ~15,000 lines of CSS across 41 per-page `<style>` blocks, no shared stylesheet, 807 distinct color literals, and 4+ conflicting implementations each of tables/buttons/cards. Full plan (resolved values, no open decisions) lives in `DESIGN-SYSTEM.md` in the repo; the audit and rationale are in `TODO.md`'s "Design system pass" section.

- **Tranche 1 (done, 2026-09-20)**: full token vocabulary (surfaces, borders, state colors, type/space scale, radius, focus ring, WoW quality colors) added to `Layout.astro`'s `:root`, plus an `AdminLayout.astro` `.admin-wrapper` override for admin's warmer tint. Purely additive — every existing token kept its value, nothing renders differently yet.
- **Tranche 2 (done, 2026-09-20)**: new `src/styles/base.css` (imported globally from `Layout.astro`) sets body font-size/line-height, global `h1`–`h4` sizes off the type scale, the `.label` uppercase pattern, a global `:focus-visible` ring, and a shared `.sr-only` utility; the old scoped `:global(h1,h2,h3)` rule in `Layout.astro` was deleted in favor of it. Bundled with security-audit item 4: the homepage (`index.astro`) had no `<h1>` at all (only an `<img>` hero) — added a visually-hidden `<h1>The Hidden Lodge</h1>` ahead of the header image so the document outline starts correctly for search/screen readers without changing the visual design.
- **Tranche 3 (done, 2026-09-20)**: new `src/styles/components.css` (imported globally from `Layout.astro`, after `base.css`) holds the shared primitives resolved in `DESIGN-SYSTEM.md` §5 — `.data-table`/`.sort-btn`, `.btn` with `--primary`/`--secondary`/`--danger`/`--subtle` variants plus the state-driven `--sign`/`--tentative`/`--late` signup modifiers, `.card` (+ `--interactive`/`--flush`/`--accent`), `.page-header`/`.page-desc`, `.empty-state`, `.pill` — plus a new `src/components/PageHeader.astro` component. Nothing in the app references these classes yet, so this is purely additive; build and typecheck both stayed clean (0 errors/0 warnings).
- Remaining tranches (4: page-by-page migration, the bulk of the work; 5: spacing/radius snap; 6: lint guardrail + docs) are unstarted. `raid-composition` and `RaiderSimTools` are deliberately migrated last (`DESIGN-SYSTEM.md` §9) — confirm no feature work is in flight on `raid-composition` first, since v2.25–v2.27 all touched it.
- Nav breakpoints (900/1200/1310px in `Layout.astro`) and the WoW item-quality colors are explicitly out of scope for value changes — the last two releases were bug fixes to exactly those breakpoints.

## Workspace boundaries

- Website source:
  - `C:\Users\JD\source\hidden-lodge-website`
- Add-on, desktop bridge, sim tooling source (sibling components, see [project overview](../README.md)):
  - `C:\Users\JD\source\hidden-lodge-addon`, `C:\Users\JD\source\hidden-lodge-desktop`, `C:\Users\JD\source\hidden-lodge-sim`
- Reusable assets and provenance:
  - `C:\Users\JD\projects\hidden-lodge`
- Project documentation:
  - `C:\Users\JD\Vault\projects\hidden-lodge`

## Common commands

- Local development (Astro dev server + local cron refresher together):
  - `npm run dev`
- Astro only, no refresher:
  - `npm run dev:site`
- Build/typecheck:
  - `npm run build` (does **not** run a full typecheck)
  - `npm run typecheck` (`astro check`) — clean as of 2026-09-11: 0 errors, 0 warnings. The remaining hints are false positives (values only used in JSON `<script>` tags or inline `on*` handlers) or style suggestions.
  - Known leftover: `/raiders/[charId]` calls `getLatestSingleTargetForRaiders` and discards the result while `FEATURE_FLAGS.sim` is on; it stays because that call also runs `purgeStaleSimData`.
- D1 migrations:
  - Local: `npm run db:migrate:local -- migrations/NNNN_name.sql`
  - Production (after local verification): `npm run db:migrate:prod -- migrations/NNNN_name.sql`
- Release:
  - `npm run version:patch` / `:minor` / `:major`, then `git push --follow-tags` — tag push triggers a GitHub Release via `.github/workflows/release.yml`.

## Operational cautions

- D1 environments:
  - Local dev D1 is separate from production; content/data created locally does not exist in production until reproduced there.
  - `db:migrate:prod` auto-backs-up protected tables (`users`, `characters`, `raider_notes`, `raid_signups`, `loot_history`, `applications`, `application_notes`) before a migration touches them — anything else needs a manual `wrangler d1 export` first.
  - Migrations run through `0076` (`0076_remap_stale_wcl_character_ids.sql`, a data-only fix). Production is current through `0076` as of 2026-09-11 (`0075` applied with `v2.19.0`, `0076` with `v2.19.1`).
  - Don't trust the `d1_migrations` table for production state: it stops at `0041` because later migrations went through `scripts/run-d1-migration.mjs` (`wrangler d1 execute --file`), which doesn't record there. That's what made production look ~31 migrations behind. Check the actual schema (`SELECT name FROM sqlite_master …`) instead. On 2026-09-11 every table from `0042`–`0073` was present and `0072`'s dropped tables were gone.
- Cron: see [[#Cron and cache refresh]] below.
- Companion apps:
  - `HiddenLodgeDesktop` (separate repo) consumes `src/pages/api/desktop/*` endpoints — check before removing/gating one.
  - 2026-09-15 audit: the WoW addon and Desktop bridge API contracts (all 5 `/api/desktop/*` endpoints, request/response shapes, auth header) still match the current website — no client-side changes were needed. The one real bug found was server-side: `/api/desktop/loot-history` and `/loot-history` only accepted loot from a hardcoded Season 1 raid list (`src/lib/midnight-season-one.ts`), so no Venomous Abyss (Season 2) loot had synced since Season 2 started 2026-08-18 — a month of silent drops. Fixed by renaming that module to `src/lib/midnight-tracked-raids.ts` with both seasons' raid names (`MIDNIGHT_TRACKED_RAID_NAMES`); a future season's raid needs adding there too. Separately, the Raidbots/Sim Tools upload panel was fully removed (not flag-gated) from `/raiders/[charId]` back in the 2026-08-06 hiatus cleanup — left as-is per the user, so Desktop's droptimizer-upgrades sync will keep returning stale/empty data until that panel is intentionally restored.

## Cron and cache refresh

There is no `[triggers] crons` entry in `wrangler.toml`. The site deploys as a Cloudflare **Pages** project, which has no cron triggers at all, so refresh is driven entirely by cron-job.org, which sends an `X-Cron-Secret` header matching the `CRON_SECRET` secret. (A `scheduled()` handler used to be baked into the build by `scripts/patch-wrangler-config.mjs`; it could never fire on Pages and was removed on 2026-09-11.)

Endpoints:

- `/api/cron/refresh` — roster, raiders, professions, trinkets, raid-log activity, death analysis, and gear icons, each leg run under `Promise.allSettled` so one failure degrades rather than aborts (legs for flagged-off features are skipped). `skipRaiders=1` and `skipLogs=1` drop the legs that have their own endpoints. The old `/api/cron/refresh-roster` alias was deleted on 2026-09-11.
- `/api/cron/refresh-raiders` — the raiders leg on its own. Split out because it is by far the slowest, and sharing one request timeout with everything else starved it.
- `/api/cron/refresh-logs` — the Warcraft Logs legs: raid-log activity, then bench parses, then Pull Scores (see [[#Parse Analysis (Pull Score)]]); death analysis, then mechanics analysis, run in parallel with that first chain. Split out on 2026-09-11 because WCL requests had no timeout and death analysis pages through whole reports after a raid night. Logs only change on raid nights, so this job can run less often.
- `/api/cron/refresh-attendance` — old attendance pipeline only; returns 404 while `attendance` is off.
- `/api/cron/backfill-gear` — manual/occasional gear icon backfill.

Three scheduled jobs in cron-job.org: `refresh?skipRaiders=1&skipLogs=1`, `refresh-raiders`, and `refresh-logs`. The skip flags keep the work from being done twice; dropping one doubles that work.

### The 30s timeout constraint

cron-job.org aborts a request at 30s, so `refreshRaidersCache()` in `src/lib/raiders.ts` is written to fit inside that rather than to run to completion:

- `REFRESH_TIME_BUDGET_MS` (20s) is a single wall-clock deadline taken at the top of the function and checked in **both** phases — the parallel enrichment fan-out and the serial per-raider persist loop that follows it.
- Skipped raiders keep their old `details_synced_at`, and `listDetailCandidates` orders stalest-first, so whatever gets dropped is automatically first in line next tick. There is no separate queue to maintain.
- Blizzard and Raider.IO fetches carry an 8s `AbortSignal.timeout()`, and the Blizzard retry backoff is clamped to 2s, so a single slow upstream cannot consume the budget.
- `DETAIL_BATCH_SIZE` is 4 against a 12h detail TTL — at a 15-minute cadence that is ~16 raiders/hour, far more headroom than the TTL needs.
- The WCL legs follow the same pattern (since 2026-09-11): 8s timeouts on every WCL request (`wcl.ts`, `raid-log-activity.ts`); raid-log activity stops starting new reports after 15s, and death analysis after 12s (it returns `budgetExhausted: true`). Death analysis only checks between reports, so its limit is lower to leave room for the report in flight.

Fixed in `v2.15.0` (2026-09-09), after a long stretch where `refresh-raiders` timed out on nearly every tick. The cause was that the budget covered only the enrichment phase, leaving an unbounded serial persist loop — including two sequential Raider.IO calls per raider — running on top of an already-spent budget. Those calls now ride along with the parallel fan-out.

Two things worth knowing when reading the cron-job.org dashboard:

- A timeout there does **not** mean the work did not happen. The Worker keeps running after the pinger hangs up, so the visible symptom (red "Failed (timeout)" rows) overstated the damage — what was really lost was the success signal and any predictability about how much got done.
- Successful ticks return a `tookMs` field and per-leg `timingsMs`; that response body is the fastest way to see whether the budget is being approached again. `console.warn` fires whenever the budget truncates a tick.

## Death Analysis (Season 2)

Rebuilt 2026-09-11 for Midnight Season 2. The Season 1 version (admin "Performance Review" tab) sat on the attendance pipeline, which only discovered raid nights from `raid_signups` rows. With signups retired for Season 2, nothing new was ever synced, so the pipeline was replaced rather than revived.

- **Where**: `/death-analysis` — raider-facing, in the Tools menu, guild members only. `/admin/log-matching` — admins plus officers (roster ranks 0–3). The old Performance Review admin tab is gone.
- **Source**: the guild's Warcraft Logs report list (guild 781707) directly, like the recent-raider activity sync. No dependency on signups or `primary_raid_schedules`.
- **Scope**: zone **The Venomous Abyss**; report must overlap a **Thu/Fri 9pm–midnight Eastern** window by 30+ minutes (DST-aware); only **Heroic and Mythic** pulls count, and only pulls lasting **30+ seconds** (added 2026-09-18, `MIN_FIGHT_DURATION_MS` in `death-analysis.ts` — excludes instant wipes like accidental pulls/DCs from pulls, deaths, and death links); rolling **90 days**, pruned each sync.
- **One report per night**: most qualifying pulls wins (tie → earliest start), unless an officer picks another on Log Matching (dropdown of that night's reports, or paste any WCL URL/code — it's synced on save). Clearing an override moves a reassigned report back to its natural night.
- **Scoring** same formula as Season 1: (4×1st + 3×2nd + 2×3rd + 1×4th deaths) / pulls attended, first 4 deaths per pull only, >25% above average highlighted. Since 2026-09-11 a raider must have **20+ pulls across 4+ reports** to appear at all (Season 1 was 5 pulls, no report minimum, and showed everyone). Below that they're hidden from the rankings, not just excluded from the average — low-sample scores were outranking regulars. On the first local sync this left 21 ranked raiders.
- **Sync**: `deathAnalysis` leg of `/api/cron/refresh-logs`, 12s time limit per run, up to 3 new or grown reports per run (`?deathReportBatchSize=`), roughly 2–3s per report. Admins also get a "Sync Now" button on Log Matching.
- **Live-log fix (2026-09-18)**: the Sep 17 report `8kLpNwF6YCRqVyTd` showed 0 pulls on Log Matching. It was a live log that the cron synced around 9:44 PM, before any boss pulls had uploaded. The sync only picked up reports it hadn't seen, so the 0 stuck. Saving it as an override didn't help, because an existing report only had its night changed. Now the sync also re-syncs any report whose WCL `endTime` is later than its `synced_at` and keeps the stored `night_key`. Saving an override always re-pulls the report, and mechanics re-syncs when its `synced_at` is older than the death report's.
- **Death links (2026-09-18)**: each raider row on `/death-analysis` expands into a list of that raider's individual counted deaths (raid night, boss, 1st–4th order, time into the pull), each linking to `warcraftlogs.com/reports/<code>#fight=<id>&type=deaths&death=<position>` so raiders jump straight to that death's moment (HP graph zoomed, event log leading up to it) instead of the whole fight. The `death=` param is WCL's own — confirmed by clicking a death row on a live report and reading the resulting URL — and it's the fight-wide death ordinal, exactly what's already stored as `death_position`; no extra data needed once that was known. Backed by a new `death_analysis_events` table (one row per counted death, same first-4-per-pull cap as the stats), populated by `syncReport` alongside the existing aggregate. `fetchReportFightStats` in `wcl.ts` now also returns raw per-death rows (fight id, encounter id, offset-into-fight ms) instead of only the aggregated counters, and `getZoneEncounterIds` became `getZoneEncounters` to also resolve encounter names for the link labels. Migration `0078` force-reset every existing report's `synced_at` to 0 so the next cron ticks backfill events for raid nights synced before this feature existed, not just new ones; verified locally by running `/api/cron/refresh-logs` by hand a few times until `deathAnalysis.remaining` hit 0 (524 events across 8 reports, 36 characters).
- **Code**: `src/lib/death-analysis.ts`; shared WCL client code moved to a neutral `src/lib/wcl.ts` (token, GraphQL, rate-limit backoff, character matching, per-report death stats) so death analysis doesn't import from the retired `attendance.ts`.
- **30s minimum fight duration (2026-09-18)**: `isQualifyingFight` in `syncReport` now also requires `endTime - startTime >= MIN_FIGHT_DURATION_MS` (30s), on top of the existing encounter/difficulty check. No schema change; migration `0079` just resets every report's `synced_at` to 0 again to rescore under the new rule. Verified locally: after resync, `death_analysis_events` dropped from 524 to 492 rows (9 reports) and total `boss_pulls` across reports came to 134.
- **Tables**: `death_analysis_reports`, `death_analysis_stats`, `death_analysis_night_overrides` (migration `0074`), `death_analysis_events` (migration `0078`). The Season 1 `raid_attendance_*` data is left in place.
- **First local sync (2026-09-11)**: 7 in-window reports from Aug 20 onward. Aug 20 (first S2 raid night) had 0 Heroic/Mythic pulls, presumably a Normal clear, so it's excluded; the other 6 nights gave 97 pulls and 35 ranked raiders.

## Mechanics Analysis

Added 2026-09-11. Per-boss leaderboards of who handles a mechanic, in the Tools menu at `/mechanics-analysis` (guild members). It is gated on `mechanicsAnalysis` **and** `deathAnalysis`.

- **Source**: no report discovery of its own. It reuses Death Analysis's canonical report per raid night (Heroic and Mythic pulls, 90 days), so Log Matching overrides apply here too.
- **First mechanic**: The Coiled Altar (encounter 3429), Orb Carries. It counts `applydebuff` events for Volatile Venom (ability 1282419) on each player, one per orb picked up. Checked against WCL on report `1BMkxhDgvX2pNzWy`: 204 applications over 6 Heroic pulls, matching WCL's Auras "uses" exactly (Kivaria 35).
- **Filters**: boss tabs; range **Latest log** / **All logs** (default); role **All** (default) / Tank / Healer / Melee / Ranged. Role is taken from the CombatantInfo `specID`, i.e. the spec played in that pull, and each player is shown in the role they played most. No site table stored per-character roles before this.
- **Visual**: a top-3 podium, a class-coloured bar leaderboard (count, per pull, pulls carried/present, best pull), and a list of players who were present but carried nothing.
- **Extending**: add entries to `MECHANICS_BOSSES` in `src/lib/mechanics-analysis.ts`. The sync cursor is per (report, mechanic), so a new mechanic backfills itself.
- **Sync**: chained after death analysis in `/api/cron/refresh-logs` (skipped if death analysis took more than 16s). It has a 6s budget and handles up to 3 reports per run (`?mechanicsReportBatchSize=`). Log Matching's Sync Now also runs it. On the first local run, 6 reports backfilled in 2 ticks (~7s, then ~4s).
- **Tables**: `mechanics_analysis_reports` and `mechanics_analysis_stats` (migration `0075`).
- **Character-matching fix (after v2.19.0)**: Wispi showed as a Druid because the account had two "Wispi-Area 52" rows in `characters`: a stale Druid (247746639, an old deleted character) and the live Paladin (247390553). WCL matching was name + realm only, so the stale ID won. `matchWclActorCharId` in `wcl.ts` now uses the WCL actor's `gameID`, which is the Blizzard character ID, and only falls back to name. Death Analysis uses the same matcher. Death stats already synced under stale IDs, Wispi (6 rows) and Bophadease (1 row, 224910813 → 237889337), were remapped in prod by data migration `0076_remap_stale_wcl_character_ids.sql`, released as `v2.19.1`. Ten name + realm duplicates exist in `characters` overall; the rest had no stats.

## Parse Analysis (Pull Score)

Added 2026-09-22. Replaces WCL's all-time Parse as Raid Comp's scoring input with **Pull Score** — WCL's own per-kill `bracketPercent`, decay-weighted by this site instead of averaged flat over all time. Full plan lives in `TODO.md`'s "Pull Score & Parse Analysis" section; the formula went through a real revision the same day (see below), so read the code/AGENTS.md over the original plan text where they disagree.

- **Why decay-weight**: WCL's Parse is an all-time percentile, so it's slow to reflect a raider who's genuinely improved (or fallen off). Pull Score decays the same way Death Analysis does (30-day half-life), so recent form dominates.
- **Formula pivot (same day)**: the first version scored every pull (kills *and* wipes) against the raid group's own median DPS/HPS that pull — no dependency on WCL's percentile at all. Caught by the user asking directly: "how are we accounting for different spec potentials?" The honest answer was we weren't — a 50-percentile Arcane Mage and a 50-percentile Elemental Shaman on the same pull were just two numbers feeding one pooled `dps` median, no spec normalization at all. The proposed fix (median restricted to same-spec-same-guild) turned out to have a worse flaw, caught by a second question: with one player on a spec, the "median" *is* their own value, so `50 × amount ÷ median` collapses to exactly 50 every time — mathematically impossible to score above or below 50, and most raid rosters have several one-person specs. WCL's `bracketPercent` doesn't have that problem (a worldwide population, not a guild-sized one), so Pull Score became a direct decay-weighted average of it instead. Net effect: simpler formula, and it now matches "how Raid Comp used to rank parse, plus recency" — which was the actual goal.
- **Scope**: Heroic only for now (`PULL_SCORE_DIFFICULTIES`); syncs kills and wipes ≥ 30s (`refreshPullScores` still fetches `table`/`playerDetails` for both, since DPS/HPS and role-median are kept as pull-history display context), but only **kills** get a `pull_score` — WCL's public API has no percentile for wipes (confirmed via the API: `rankings` returns empty for wipe fights under every query variant tried), so wipes stay `pull_score = NULL` forever. Reuses Death Analysis's canonical raid-night reports, so Log Matching overrides apply here too.
- **Sync**: `src/lib/pull-scores.ts`, `refreshPullScores`, chained after bench parses in `/api/cron/refresh-logs` and the "Refresh Logs Data" button. Per report: one fights+actors metadata query, then a few fights at a time via one aliased GraphQL request each (`table(DamageDone)` + `table(Healing)` + `playerDetails`, one alias per fight — a single `table` call given multiple `fightIDs` aggregates across them rather than returning one row per fight, confirmed by spike). A separate rankings pass writes each kill's `bracketPercent` straight into `pull_score` once fights finish syncing. Two bugs found and fixed during local verification: (1) the retry-wait gate compared against the fights-sync timestamp instead of a dedicated rankings-attempt timestamp, blocking the *first* rankings attempt for an hour, not just retries (migration `0104` added `rankings_attempted_at`); (2) the 3-day age gate was checked against the *raid night's date*, so a backfilled report more than 3 days old could never get a rankings attempt at all — fixed so every report gets one unconditional attempt regardless of age, and only a retry after an empty first attempt is limited to recent nights.
- **Cost**: measured via a throwaway spike against real WCL data — ~3.1 points per fight for the table×2 + playerDetails triple, ~0.5 points per fight for rankings. A ~40-pull raid night lands around ~140 points, well inside the 3600/hour limit alongside Death Analysis/Mechanics/bench parses.
- **Where it shows**: `/parse-analysis` (new, Tools menu, guild members, gated on `parseAnalysis` + `deathAnalysis`) — a "How this works" explainer, per-role tables (Tanks/Healers/Ranged/Melee) with Pull Score, pulls attended, kills, WCL Parse (median — the one remaining reference column; WCL Parse (kills) was dropped once it became numerically identical to Pull Score), and a 14-day trend, plus an expandable per-raider pull history. The same history table appears on each raider's profile as "Pull Score History" (same flag; its own duplicate "Pull Score"/"WCL Parse" columns were likewise merged into one "Parse" column). Raid Comp's Roster table gained a "Score used" column and a separate greyed "WCL Parse (median)" reference column; the "Refresh Parses" button was renamed "Refresh Logs Data" since it now runs both parses and Pull Scores. Both role tables were also restyled to match raid-composition's Roster table exactly (fixed colgroup columns, class-colored names, column-header tooltips) after the first pass didn't visually match — turned out `.data-table` (the newer design-system primitive) and raid-composition's pre-migration `.review-table` literals render differently, so matching the reference meant reusing its literals, not the tokens.
- **Verified locally**: ran `/api/cron/refresh-logs` by hand repeatedly against real guild data (full resync after the formula pivot) until the sync cursor drained — 9 reports, 3508 pull rows, 615 kill rows, 557 of them scored (rest still pending WCL's ranking lag). Spot-checked stored `pull_score` values are exactly the raw `bracketPercent` WCL returned for those characters/fights, matching the earlier spike's numbers.
- **Tables**: `pull_score_pulls` (one row per raider per pull — `pull_score` nullable) and `pull_score_reports` (per-report fights/rankings sync cursor) — migrations `0103`, `0104`, and `0105` (`0105` dropped the original `NOT NULL` on `pull_score`, which the formula pivot needed, and force-reset the sync cursor for a full resync).
- **Not yet done**: the `/minor` release and `db:migrate:prod` (needs explicit go-ahead per the plan). Until the cron backfills the ~17-night window, raiders will show "too-few-pulls" in Raid Comp.

## External content integrations

Two site sections deliberately have no local content store — they render live from partner sites, following the same fetch/edge-cache pattern (`caches.default`, ~10 min TTL) in both cases:

- **`/links`** — reads bookmarks tagged `wow` from [Tagstash](https://tagsta.sh)'s public API (`src/lib/bookmarks.ts`). No admin CRUD or D1 table in this repo (migration `0072` dropped `links`/`link_categories`); links are curated directly in Tagstash. Shipped in `v2.8.0`.
- **`/articles`** — reads World-of-Warcraft-tagged posts from a public API on [Orboro.net](https://orboro.net) (`src/lib/orboro-posts.ts`, `GET orboro.net/api/posts/by-category/[slug]`). `/articles/:slug` 301-redirects to the matching post on orboro.net rather than rendering content locally — Orboro's shortcode system only resolves inside its own render pipeline, so full post bodies can't be reproduced here. Both `/articles` and the homepage carry a small credit link back to orboro.net. Shipped in `v2.9.0`; the new `GET /api/posts/by-category/[slug]` endpoint on the Orboro side shipped as its `v1.26.0`.

## Leadership page assets

- Page source: `src/pages/leadership.astro`.
- Website assets: `public/images/leadership/`.
- Durable approved masters and references: `C:\Users\JD\projects\hidden-lodge\01_Assets\Characters\Leadership`.
- The asset catalog records display-name/character mappings, Armory URLs, provenance, website paths, and SHA-256 hashes. Approved files are split between `Approved/Masters` and `Approved/Web`.
- Current linked characters: Nic / Justsaywhen (Sargeras), Mike / Badbloodx (Illidan), Sam / Keakz (Tichondrius), Sunsourse / Steelsourse (Illidan), and Justin / Merlinmonroe (Mal'Ganis). All five now link out to the Armory.
- Nic keeps the custom wooden bear guardian portrait; only the name links to a character. That link is **seasonal** (added in `v2.13.0`) and should be revisited when the season turns.
- The chibi Leadership refresh shipped in `v2.12.0` and Nic's link in `v2.13.0` — both are committed and deployed. The external asset catalog was reconciled with those current links on 2026-09-20.

## Related notes

- [Orboro README, Public API section](<file:///C:/Users/JD/source/orboro-net/README.md>) — the by-category posts API consumed by `/articles`; [Orboro operations history](<file:///C:/Users/JD/source/orboro-net/docs/operations.md>) records dated hosting checks.
- the personal ChatGPT export map in Obsidian
