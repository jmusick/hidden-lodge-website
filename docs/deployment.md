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
5. After confirming native scheduled runs in Cloudflare Cron Events/Worker logs, disable the three cron-job.org jobs to prevent duplicate refreshes. Retain them disabled during the rollback window.

Rollback: remove the Worker route so the retained Pages domain serves its prior deployment; disable Worker cron triggers before re-enabling the external jobs. This rolls back hosting only, not D1 data. Record deployment IDs, observed cron runs, and any remaining cutover step below.

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
- Automatic production cron observation and external job retirement remain pending at the user's requested stop on 2026-10-11, approximately 16:44 UTC. The Worker API reports both `fetch` and `scheduled` handlers and all three expected schedules, but no automatic event has yet appeared in Cron Events or the live tail. Remote-preview scheduled tests are successful; they do not prove automatic production firing. The three cron-job.org jobs remain enabled as the working fallback.

### Resume the remaining cutover

1. Check production [Cron Events](https://dash.cloudflare.com/fdabb6996edf7688fdaf7c8c367f7d08/workers/services/cron-events/hidden-lodge-website/production) and `npx wrangler tail hidden-lodge-website --format json` for an automatic event and a `scheduled-refresh` record with `success: true`. Do not treat an authenticated HTTP refresh or a remote-preview test as that proof. If events remain absent, investigate Cloudflare trigger execution before removing the fallback.
2. In the signed-in [cron-job.org console](https://console.cron-job.org/jobs), disable (retain for rollback) `HiddenLodgeWebsite Refresh`, `HiddenLodgeWebsite Refresh Raiders`, and `HiddenLodgeWebsite Refresh Logs` after automatic native execution is confirmed. Logs job ID: `8431795`. Preserve their URLs, header, and schedules.
3. Verify all three are disabled and record the observed native event and retirement here. No database migrations, new issues, or source reorganization remain for this maintenance pass.

Temporary credential files used for deployment and runtime verification were removed. Production secrets remain encrypted in Cloudflare; local development env files remain ignored.
