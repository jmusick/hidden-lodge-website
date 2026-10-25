-- allow-destructive: rebuilds death_analysis_stats, mechanics_analysis_stats,
-- and bench_parses to add difficulty to their primary keys (SQLite can't
-- change a primary key in place). Every existing row is copied into the new
-- table first; nothing is lost.
--
-- Hidden Lodge DB: Heroic / Mythic / Combined views for the log-analysis
-- tools. Death Analysis and Mechanics Analysis used to add Heroic and Mythic
-- together per report at sync time; they now keep one stats row per
-- difficulty. Rows copied from before this migration get difficulty 0
-- ("unsplit"): Combined still counts them, and the Heroic/Mythic views skip
-- them until the cron re-syncs that report (Death Analysis backfills reports
-- whose heroic_pulls is NULL; Mechanics re-syncs everything because its
-- synced_at is reset below). Pull Score already stored difficulty per pull and
-- now also syncs Mythic fights; WCL Parse is fetched for both difficulties.
-- Run locally:  npx wrangler d1 execute hidden-lodge-db --local --file=migrations/0108_difficulty_split.sql
-- Run in prod:  npx wrangler d1 execute hidden-lodge-db --remote --file=migrations/0108_difficulty_split.sql

-- Death Analysis: per-difficulty pull counts on each report. NULL = synced
-- before the split (backfill pending). Reports with no qualifying pulls have
-- nothing to split.
ALTER TABLE death_analysis_reports ADD COLUMN heroic_pulls INTEGER;
ALTER TABLE death_analysis_reports ADD COLUMN mythic_pulls INTEGER;
UPDATE death_analysis_reports SET heroic_pulls = 0, mythic_pulls = 0 WHERE boss_pulls = 0;

CREATE TABLE death_analysis_stats_new (
    report_code         TEXT    NOT NULL REFERENCES death_analysis_reports(report_code) ON DELETE CASCADE,
    blizzard_char_id    INTEGER NOT NULL,
    -- WCL difficulty id (4 Heroic, 5 Mythic); 0 = Heroic + Mythic from before the split.
    difficulty          INTEGER NOT NULL DEFAULT 0,
    fights_present      INTEGER NOT NULL DEFAULT 0,
    total_deaths        INTEGER NOT NULL DEFAULT 0,
    first_death_count   INTEGER NOT NULL DEFAULT 0,
    second_death_count  INTEGER NOT NULL DEFAULT 0,
    third_death_count   INTEGER NOT NULL DEFAULT 0,
    fourth_death_count  INTEGER NOT NULL DEFAULT 0,
    spec_id             INTEGER,
    PRIMARY KEY (report_code, blizzard_char_id, difficulty)
);
INSERT INTO death_analysis_stats_new (
    report_code, blizzard_char_id, difficulty, fights_present, total_deaths,
    first_death_count, second_death_count, third_death_count, fourth_death_count, spec_id
)
SELECT
    report_code, blizzard_char_id, 0, fights_present, total_deaths,
    first_death_count, second_death_count, third_death_count, fourth_death_count, spec_id
FROM death_analysis_stats;
DROP TABLE death_analysis_stats;
ALTER TABLE death_analysis_stats_new RENAME TO death_analysis_stats;

ALTER TABLE death_analysis_events ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 0;

-- Mechanics Analysis: same split. Its cursor gets per-difficulty pull counts,
-- and synced_at = 0 makes the next few cron runs re-sync every report.
CREATE TABLE mechanics_analysis_stats_new (
    report_code       TEXT    NOT NULL,
    mechanic_key      TEXT    NOT NULL,
    blizzard_char_id  INTEGER NOT NULL,
    -- WCL difficulty id (4 Heroic, 5 Mythic); 0 = Heroic + Mythic from before the split.
    difficulty        INTEGER NOT NULL DEFAULT 0,
    role              TEXT,
    pulls_present     INTEGER NOT NULL DEFAULT 0,
    pulls_hit         INTEGER NOT NULL DEFAULT 0,
    hit_count         INTEGER NOT NULL DEFAULT 0,
    best_pull_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (report_code, mechanic_key, blizzard_char_id, difficulty)
);
INSERT INTO mechanics_analysis_stats_new (
    report_code, mechanic_key, blizzard_char_id, difficulty, role, pulls_present, pulls_hit, hit_count, best_pull_count
)
SELECT report_code, mechanic_key, blizzard_char_id, 0, role, pulls_present, pulls_hit, hit_count, best_pull_count
FROM mechanics_analysis_stats;
DROP TABLE mechanics_analysis_stats;
ALTER TABLE mechanics_analysis_stats_new RENAME TO mechanics_analysis_stats;

ALTER TABLE mechanics_analysis_reports ADD COLUMN heroic_pulls INTEGER;
ALTER TABLE mechanics_analysis_reports ADD COLUMN mythic_pulls INTEGER;
UPDATE mechanics_analysis_reports SET synced_at = 0;

-- Pull Score: 1 once a report's fights were synced with Mythic in scope. A
-- report Death Analysis knows has Mythic pulls is re-synced while this is 0.
ALTER TABLE pull_score_reports ADD COLUMN includes_mythic INTEGER NOT NULL DEFAULT 0;

-- WCL Parse: one cached zoneRankings row per character per difficulty.
-- Existing rows are all Heroic; Mythic rows arrive on the next parse refresh.
CREATE TABLE bench_parses_new (
    blizzard_char_id  INTEGER NOT NULL,
    difficulty        INTEGER NOT NULL,
    zone_id           INTEGER NOT NULL,
    wcl_found         INTEGER NOT NULL DEFAULT 0,
    dps_median        REAL,
    dps_bosses        INTEGER NOT NULL DEFAULT 0,
    healer_median     REAL,
    healer_bosses     INTEGER NOT NULL DEFAULT 0,
    tank_median       REAL,
    tank_bosses       INTEGER NOT NULL DEFAULT 0,
    synced_at         INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (blizzard_char_id, difficulty)
);
INSERT INTO bench_parses_new (
    blizzard_char_id, difficulty, zone_id, wcl_found, dps_median, dps_bosses,
    healer_median, healer_bosses, tank_median, tank_bosses, synced_at
)
SELECT
    blizzard_char_id, difficulty, zone_id, wcl_found, dps_median, dps_bosses,
    healer_median, healer_bosses, tank_median, tank_bosses, synced_at
FROM bench_parses;
DROP TABLE bench_parses;
ALTER TABLE bench_parses_new RENAME TO bench_parses;

-- Raid Comp: which difficulty's Pull Score, deaths, and WCL Parse Regenerate scores on.
ALTER TABLE raid_comp_settings ADD COLUMN difficulty_scope TEXT NOT NULL DEFAULT 'combined';
