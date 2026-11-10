import { handle } from '@astrojs/cloudflare/handler';
import type { ExportedHandler, Response as CfResponse } from '@cloudflare/workers-types';
import { runRefresh } from './lib/cron/refresh';
import { runRaidersRefresh } from './lib/cron/refresh-raiders';
import { runLogsRefresh } from './lib/cron/refresh-logs';
import { runScheduledRefresh } from './lib/cron/scheduled';
import { withSecurityHeaders } from './lib/security-headers';

// Every response the Worker produces gets the baseline security headers: pages, API
// routes, middleware redirects and 403s, and Astro's own 404/500 responses. Static
// files served by the assets binding skip the Worker; public/_headers covers those.
// (Workers' Response type and the DOM one are the same object at runtime.)
const fetchWithSecurityHeaders: typeof handle = async (request, env, ctx) =>
  withSecurityHeaders((await handle(request, env, ctx)) as unknown as Response) as unknown as CfResponse;

export default {
  fetch: fetchWithSecurityHeaders,
  async scheduled(controller) {
    await runScheduledRefresh(controller.cron, {
      refresh: () => runRefresh(new URL('https://hidden-lodge.com/api/cron/refresh?skipRaiders=1&skipLogs=1')),
      raiders: () => runRaidersRefresh(new URL('https://hidden-lodge.com/api/cron/refresh-raiders')),
      logs: () => runLogsRefresh(new URL('https://hidden-lodge.com/api/cron/refresh-logs')),
    });
  },
} satisfies Pick<ExportedHandler<Env>, 'scheduled'> & { fetch: typeof handle };
