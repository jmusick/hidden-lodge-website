# Deferred Discord raid signups plan

Recovered from the pre-consolidation TODO on 2026-10-11. This is a proposal, not a live feature. Attendance and raid-signup feature flags remain off. Reconcile phase details against current code before implementation; track the proposal in [the backlog](../BACKLOG.md).

# Discord raid signups: low priority, longer term

**Status: backlog.** Not scheduled. Spec written 2026-09-23 so it's ready if we pick it up.

**Goal:** bring back the raid schedule/calendar, and make #raid-signup the main place people sign
up. Each raid night gets a single bot post showing the live signup list, with buttons to sign up
right from Discord and role pings on a timer to remind people. Signing up on the site keeps
working. Both routes write the same `raid_signups` rows.

## Constraints that shape the design

- **No long-running process.** The site is a Cloudflare Pages project with no cron triggers and
  no gateway connection. Everything below uses Discord's HTTP-only surfaces: the REST API with a
  bot token, and an Interactions Endpoint URL that Discord POSTs to. No discord.js, and no server
  on the LodgeSim box.
- **Why a plain channel webhook isn't enough.** A webhook can post and edit messages, but it
  can't receive button clicks. Interactive buttons only work on messages the *application*
  posted. So posting goes through the bot token (`POST /channels/{channel_id}/messages`) from
  the start, rather than using a webhook and swapping later.
- **Identity.** Site logins are Battle.net only (`src/lib/auth.ts`). A button click tells us
  the Discord user ID and nothing else. Each person has to link their Discord account to their
  site user once. This is the unavoidable up-front cost.
- **Cron.** cron-job.org, the `X-Cron-Secret` header, and the 30s-per-request limit, the same as
  the other `/api/cron/*` endpoints.

## Phase 0: revive site signups (prerequisite)

1. Turn on `FEATURE_FLAGS.raidSignups` and check every place it gates: `Layout.astro` and
   `AdminLayout.astro` nav, `signup.astro`, `admin/raid-signups.astro`, `profile.astro`, the
   `api/signup/*`, `api/admin/raid-signups/*`, and `api/profile/update-role.ts` routes.
2. Make sure `/signup` and `/admin/raid-signups` still render and work after sitting behind the
   flag (design-system styles, auth guards, timezone display).
3. Check `src/pages/api/desktop/raid-signups-today.ts` against HiddenLodgeDesktop.
4. **Don't** reconnect the retired `attendance` pipeline.
5. Move the create/cancel logic out of `api/signup/create.ts` and `cancel.ts` into
   `src/lib/raid-signups.ts`, for example `upsertSignup(db, userId, target, { characterId,
   status, role, notes })` and `cancelSignup(db, userId, target)`. That covers the ownership
   check, the "raid already started" lock, the "late needs a note" rule, and the delete+insert
   batch. The form endpoints and the Discord interaction handler must share this code so the
   rules can't drift between the two routes.
6. Add a shared occurrence key type, `{ kind: 'primary', scheduleId, occurrenceStartUtc } |
   { kind: 'adhoc', adHocRaidId }`, and a string form (`p:<id>:<epoch>` / `a:<id>`) for use in
   Discord `custom_id`s.

## Phase 1: bot posts, live list, reminders

**Setup (once, manual).** Create a Discord application with a bot user. Invite it to the server
with only these permissions: View Channel, Send Messages, Embed Links, Read Message History, and
Mention @everyone/Roles *only if* the Raider role isn't mentionable. Pages secrets:
`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`. Store `discord_channel_id`,
`discord_raider_role_id`, and the reminder-stage settings in `site_settings`, editable from
`/admin/raid-signups`.

**Schema.** New migration `discord_raid_posts`:

| column | notes |
|---|---|
| `occurrence_key` | TEXT PK (`p:<id>:<epoch>` / `a:<id>`) |
| `channel_id`, `message_id` | the one live signup post for this raid |
| `last_stage_sent` | highest reminder stage already sent, so reruns don't double-ping |
| `content_hash` | hash of the last rendered embed; skip the PATCH if unchanged |
| `created_at`, `updated_at` | |

**`src/lib/discord.ts`**
- `discordFetch(path, init)`: bot-token auth, `AbortSignal.timeout(8_000)`, and 429 handling
  that honors `retry_after` once and then gives up (the next cron tick reconciles).
- `renderSignupPost(occurrence)`: the embed has a title (raid name + date in ET/server time
  plus a `<t:epoch:F>` / `<t:epoch:R>` timestamp so each viewer sees their own local time), a
  headcount against target ("14/20 · 2T 3H 9D"), fields per role (Tank / Healer / Melee /
  Ranged) listing character names for Coming, and then Late (with note), Tentative, and Absent.
  Components are the Phase 3 buttons plus a link button to `/signup`.
- `syncRaidPost(db, occurrence)`: create the message if there's no row, otherwise PATCH it,
  skipping when `content_hash` matches. If Discord returns 404 (the post was deleted by hand),
  recreate it.

**Live updates.** At the end of every signup mutation (site form endpoints, admin signup-role
edits, and Phase 3 interactions), call `syncRaidPost` inside `waitUntil(...)` so the user's
request never waits on Discord. Discord allows roughly 5 edits per 5s per channel. If a raid
night gets bursty, collapse edits with a short "dirty" flag checked by the cron job rather than
editing on every click.

**Reminders: `/api/cron/discord-raid`**, every 15 min via cron-job.org:
1. Load active occurrences starting within the next 7 days using the existing schedule helpers
   (`shouldScheduleOccurOnUtcDate`, `adjustedPrimaryDisplayStartUtc`). The reminders must use
   the same dates as the calendar, including across DST changes.
2. For each one, work out the highest due stage and compare it to `last_stage_sent`. Default
   stages, each toggleable in admin:
   - **T-6d:** create the post and send "Signups are open" with a role ping.
   - **T-48h:** role ping with the current headcount and missing roles ("need 1 healer").
   - **T-24h:** the same.
   - **T-2h:** final call.
   Only send the newest due stage. If the cron job was down for two stages, skip the older one
   so people don't get pinged twice back to back.
3. Pings go out as *separate short messages* that reply to or link the live post, with
   `allowed_mentions: { roles: [raiderRoleId] }`. Never put the ping in the edited post, because
   edits don't notify anyone.
4. Also call `syncRaidPost` for each occurrence as a fallback in case a `waitUntil` edit failed.
5. Once the raid has started, edit the post one last time to "Signups closed" and remove the
   buttons.
6. Keep a deadline like the other cron legs and pick up any remaining work on the next tick.

## Phase 2: link Discord accounts

- Migration: `users.discord_user_id TEXT` with a partial UNIQUE index (one Discord account per
  site user), plus `users.discord_username` for display.
- "Link Discord" on `/profile`: Discord OAuth2 authorization-code flow, scope `identify` only,
  signed `state` tied to the session for CSRF, callback at
  `/api/auth/discord/callback`. Exchange the code, call `GET /users/@me`, and store the ID.
  Add an "Unlink" option.
- A user who links is assumed to sign up with their `characters.is_main` character and their
  `users.preferred_role`. The profile page should nudge them to set both.
- Update `/privacy` to say we store the Discord user ID and username when someone links.
- Optional admin view on `/admin/raid-signups`: which rostered users are and aren't linked.

## Phase 3: sign up from the Discord post

**Interactions endpoint.** Put `/api/discord/interactions` in the app's "Interactions Endpoint
URL".
- Verify `X-Signature-Ed25519` / `X-Signature-Timestamp` against `DISCORD_PUBLIC_KEY` using
  Web Crypto Ed25519 (supported in Workers). Reject anything that fails with a 401. Discord
  checks for this when the URL is saved and sends bad signatures on purpose to test it.
- Answer type 1 (PING) with PONG.
- Reply within 3s. Do the D1 write inline, since it's fast, and push the post edit into
  `waitUntil`.
- This endpoint must skip the site's session/auth middleware. Its only authentication is the
  Discord signature.

**Buttons on each post:** `Coming` · `Late` · `Tentative` · `Absent` · `Change…` · `Sign up on
site` (link). `custom_id` = `su:<status>:<occurrenceKey>`.

**Click flow**
1. Look up `users` by `interaction.member.user.id`.
   - **Not linked:** ephemeral reply saying "Link your Discord account first", with a link
     button to `/profile#discord`. Nothing is written.
   - **Linked but not a guild member** (same check as `isGuildMember`): ephemeral refusal.
2. **Late** needs a note (same rule as the site), so open a *modal* with one text input. The
   modal submit (interaction type 5) carries the occurrence in its `custom_id`.
3. Call `upsertSignup` using the main character and preferred role, or keep the existing
   character and role if they already signed up for this raid.
4. Send an ephemeral confirmation: "Signed up as **Coming** on *Charname* (Healer)", plus
   `Change…` and `Withdraw` buttons.
5. `waitUntil(syncRaidPost(...))`.

**`Change…`:** an ephemeral message with two select menus, *character* (their characters from
`characters`, main first) and *role*, plus an optional notes modal. Submitting calls the same
`upsertSignup`. This covers alts and off-specs without leaving Discord.

**Withdraw:** `cancelSignup`, ephemeral confirmation, and a post sync.

**Locking:** a click after the raid start gets an ephemeral "Signups for this raid are closed",
matching the `locked` status on the site.

**Slash commands (optional, later):** `/raid` shows this week's raids with your status
(ephemeral), and `/signup <raid>` is a fallback for the buttons. Register them once as guild
commands (`PUT /applications/{app_id}/guilds/{guild_id}/commands`) from a small script in
`scripts/`, not at runtime.

## Phase 4: reminders aimed at the people who haven't answered (optional)

- "Expected" raiders = rostered raiders active in the last `RECENT_LOG_WINDOW_DAYS` (from
  `raider_log_activity`), minus anyone with a signup row for the raid, minus Raid Comp
  `is_absent`.
- The T-24h reminder lists them. Linked users are mentioned with `<@id>` and
  `allowed_mentions.users`; unlinked users are listed by character name with no ping.
- Optional DM per person (`POST /users/@me/channels` then send). This needs an opt-in on
  `/profile`, because unwanted DMs from a guild bot are a quick way to get it muted.

## Testing

- Discord has to reach the interactions endpoint over public HTTPS. Use a Pages preview deploy
  or `cloudflared tunnel` to `npm run dev`, with a **separate test application and test
  server/channel** so production never gets test pings.
- Unit-test the stage calculation (DST weeks, biweekly schedules, a missed cron run), the embed
  render, and signature verification (known-good and tampered payloads).
- Once end to end: link, then click each button, the Late modal, Change…, and Withdraw, and
  check that `/signup` shows the same state. Then sign up on the site and watch the post update.

## Rough effort

| Phase | Effort |
|---|---|
| 0. Revive site signups + shared `upsertSignup` | M |
| 1. Bot posts, live list, reminders | L |
| 2. Discord account linking | M |
| 3. Buttons, modal, select menus | L |
| 4. Targeted reminders / DMs | M |

Phases 0 and 1 are useful by themselves (reminders plus a live list, with signups still on the
site). Phase 3 depends on Phase 2.
