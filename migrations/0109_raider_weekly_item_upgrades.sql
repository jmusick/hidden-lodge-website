-- Hidden Lodge DB: per-item upgrade steps by week, for Raid Comp's Upgrades metric.
-- Run locally:  npx wrangler d1 execute hidden-lodge-db --local --file=migrations/0109_raider_weekly_item_upgrades.sql
-- Run in prod:  npx wrangler d1 execute hidden-lodge-db --remote --file=migrations/0109_raider_weekly_item_upgrades.sql

-- "Upgrades completed this week" used to be the drop in a raider's total
-- missing upgrade ranks since reset. Equipping a new item adds its unfilled
-- ranks to that total, so a raider who took a 1/6 vault piece and upgraded it
-- to 4/6 read as 0 upgrades. This table tracks each equipped item on its own:
-- one row per (raider, week, slot, item, upgrade track), with the step the
-- item was at when the week began (or when it was first equipped) and the
-- highest step seen since. Weekly upgrades = SUM(last_step - first_step).
-- See recordWeeklyItemUpgrades in raiders.ts and loadWeeklyUpgradeProgress in
-- bench.ts. Rows are pruned 28 days after their week starts.
CREATE TABLE IF NOT EXISTS raider_weekly_item_upgrades (
    blizzard_char_id  INTEGER NOT NULL,
    -- US weekly reset (unix seconds) the row belongs to.
    week_start        INTEGER NOT NULL,
    slot_key          TEXT    NOT NULL,
    item_id           INTEGER NOT NULL,
    -- Bonus id of step 1 of the item's upgrade track; a same-id item on a
    -- different track (e.g. the Heroic vs Mythic copy) is a different item.
    track_base_id     INTEGER NOT NULL,
    first_step        INTEGER NOT NULL,
    last_step         INTEGER NOT NULL,
    first_seen_at     INTEGER NOT NULL,
    last_seen_at      INTEGER NOT NULL,
    PRIMARY KEY (blizzard_char_id, week_start, slot_key, item_id, track_base_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_item_upgrades_week ON raider_weekly_item_upgrades(week_start);
