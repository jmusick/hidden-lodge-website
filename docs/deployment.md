# Worker deployment and cron

The website targets the `hidden-lodge-website` Worker in Cloudflare account `fdabb6996edf7688fdaf7c8c367f7d08`. Source: [jmusick/hidden-lodge-website](https://github.com/jmusick/hidden-lodge-website), production branch `main`.

## Build and deploy

```sh
npm ci
npm run typecheck
npm run test:cron
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

Astro 6's Cloudflare adapter generates `dist/server/wrangler.json` and `.wrangler/deploy/config.json`. Wrangler follows that generated config automatically. Edit `wrangler.toml` and `src/worker.ts`, then rebuild; do not patch generated output. The old Pages build patch has been removed. The compatibility date remains `2025-01-01` to preserve runtime behavior during migration.

`DB` reuses the existing `hidden-lodge-db` D1 database (`f51db21f-954c-4845-a829-a6900f5be5c3`). No database copy or schema migration is part of the hosting move. `ASSETS` serves `dist/client`. Application sessions remain in D1; Astro's separate session driver remains the existing LRU driver.

## Native cron

| UTC expression | Work | Cadence |
| --- | --- | --- |
| `0,15,30,45 * * * *` | Roster, professions/trinkets when enabled, gear icons; raiders/logs skipped | Every 15 minutes |
| `5,20,35,50 * * * *` | Raiders | Every 15 minutes, offset 5 minutes |
| `10 */2 * * *` | Log activity → bench parses → Pull Scores; death analysis → mechanics | Every 2 hours, offset 10 minutes |

`src/worker.ts` dispatches through `src/lib/cron/scheduled.ts` and the shared `src/lib/cron/refresh*.ts` functions. Native events require neither `CRON_SECRET` nor an HTTP self-request. Manual `/api/cron/*` routes still require `X-Cron-Secret`. Partial failures are logged and throw so Cron Events mark the invocation failed. Logs and traces are enabled in Wrangler.

Keep the existing per-leg deadlines, cursor carryover, feature gates, and 8-second upstream timeouts. They keep each run bounded even though cron-job.org's 30-second HTTP cutoff no longer governs native events. Update both the dispatch map and Wrangler cron expressions together; `npm run test:cron` checks the mapping.

## Cutover and rollback

1. Upload the built Worker with the existing production secret values. A protected JSON/env file can be supplied with `wrangler deploy --secrets-file`; never commit it or print values. Local development uses a localhost Blizzard callback; production must use `https://hidden-lodge.com/auth/callback`.
2. Validate the Worker URL, static assets, D1-backed pages, OAuth redirect, and machine endpoint authentication before moving traffic.
3. Route `hidden-lodge.com/*` to this Worker. The existing Pages project/domain can remain as a rollback origin, with its automatic deployments disabled. Avoid deploying the new Worker build through Pages.
4. Connect Workers Builds to the renamed GitHub repo: `main`, root `/`, build `npm run build`, deploy `npx wrangler deploy`, Node 22.12+ (24 is supported). Disable non-production branch builds unless their bindings are isolated from production D1.
5. After confirming native scheduled runs in Cloudflare Cron Events/Worker logs, retire the external cron-job.org jobs to prevent duplicate refreshes. Done: the jobs were deleted, not kept disabled (see [Native cron verification](#native-cron-verification--2026-10-13)).

Rollback: remove the Worker route so the retained Pages domain serves its prior deployment. Pages has no cron triggers, so the external scheduler must be recreated: three jobs sending the `X-Cron-Secret` header (the Worker's `CRON_SECRET` value) to `https://hidden-lodge.com/api/cron/refresh?skipRaiders=1&skipLogs=1`, `/api/cron/refresh-raiders`, and `/api/cron/refresh-logs`, matching the cadences in the table above. Disable Worker cron triggers before enabling them. This rolls back hosting only, not D1 data. Record deployment IDs, observed cron runs, and any remaining cutover step below.

## References

- [Cloudflare Pages-to-Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Astro Cloudflare adapter and custom entrypoint](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers Builds GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)

The original cron-job.org logs job was confirmed on 2026-10-11 to run every 2 hours (`0 */2 * * *`, America/New_York). Native cron preserves that interval, at minute 10 UTC to stagger load; UTC scheduling means local clock parity changes at DST boundaries.

## Cutover verification — 2026-10-11

- `hidden-lodge.com/*` serves the Worker, using the existing D1 database and production API credentials. Pages production and preview builds are disabled; its previous deployment remains the rollback origin.
- Workers Builds is connected to `jmusick/hidden-lodge-website`, branch `main`, root `/`, with the build/deploy commands above and preview branch builds disabled. The first push-triggered build (`c0b121c8-0a34-4e8e-804d-6bffcc3d923c`, commit `2d558a9`) succeeded on Node 24.18.0 and deployed version `72334f65-2062-468c-8915-a9f39c265f93` at 16:16 UTC.
- Production checks passed for public/D1-backed pages, CSS assets, robots/sitemap, expected 404/redirect behavior, the Battle.net redirect with the production callback, and desktop/sim endpoints both with and without authentication.
- All three shared refresh endpoints returned success without partial failures. All three native scheduled dispatch paths also completed successfully in Cloudflare remote preview using the production D1 binding; the logs path was tested explicitly rather than waiting two hours.
- The original cron-job.org `X-Cron-Secret` value was preserved in the Worker's `CRON_SECRET` after an initial local-value mismatch returned 401. A refresh authenticated with the original value then returned 200 and success. Keep the original value for rollback/manual integration; native events do not use it.
- Build, typecheck (0 errors, 0 warnings), cron dispatch/failure checks, and Wrangler dry run passed. Documentation checks covered 76 local/Vault links, 25 Markdown anchors, and the four renamed GitHub README destinations.
- At the 2026-10-11 stop (about 16:44 UTC), automatic production firing had not yet been observed; remote-preview scheduled tests had passed. Confirmed afterwards; see below.

## Native cron verification — 2026-10-13

- The first automatic production events fired 2026-10-11 at 17:15 UTC (refresh), 17:20 UTC (raiders), and 18:10 UTC (logs). From then to 2026-10-14 00:05 UTC, Cloudflare's `workersInvocationsScheduled` analytics recorded 436 scheduled invocations: 435 `success`, and one `scriptThrewException` (refresh, 2026-10-12 02:00 UTC); the next tick succeeded.
- Between about 08:00 and 20:35 UTC on 2026-10-13, Cloudflare delivered triggers up to ~20 minutes late and skipped 17 refresh, 17 raiders, and 3 logs slots (10:10, 16:10, 18:10). Each leg's cursor carried the work into the next run; delivery was on time again afterwards. If this recurs, check Cloudflare status before changing code.
- Production D1 was current at verification: roster and raider summaries/details and gear synced within the last 15 minutes, and bench parses updated by the 20:10 UTC logs run. Raid-log activity, Pull Scores, and death analysis last changed 2026-10-10 about 02:00 UTC because the newest WCL report (the Friday raid) ended at 01:58 UTC; logs runs since then succeeded with nothing new to sync.
- The three cron-job.org jobs (`HiddenLodgeWebsite Refresh`, `HiddenLodgeWebsite Refresh Raiders`, `HiddenLodgeWebsite Refresh Logs`) were deleted on 2026-10-13, after native firing was established. Native cron is now the only scheduler; rollback to Pages requires recreating them (see [Rollback](#cutover-and-rollback)). The manual `/api/cron/*` endpoints and `CRON_SECRET` remain for manual runs.
- The cutover is complete. No database migrations, new issues, or source reorganization remain for this maintenance pass.

Temporary credential files used for deployment and runtime verification were removed. Production secrets remain encrypted in Cloudflare; local development env files remain ignored.
