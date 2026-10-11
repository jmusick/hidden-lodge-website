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
