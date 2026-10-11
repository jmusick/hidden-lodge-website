import { handle } from '@astrojs/cloudflare/handler';
import type { ExportedHandler } from '@cloudflare/workers-types';
import { runRefresh } from './lib/cron/refresh';
import { runRaidersRefresh } from './lib/cron/refresh-raiders';
import { runLogsRefresh } from './lib/cron/refresh-logs';
import { runScheduledRefresh } from './lib/cron/scheduled';

export default {
  fetch: handle,
  async scheduled(controller) {
    await runScheduledRefresh(controller.cron, {
      refresh: () => runRefresh(new URL('https://hidden-lodge.com/api/cron/refresh?skipRaiders=1&skipLogs=1')),
      raiders: () => runRaidersRefresh(new URL('https://hidden-lodge.com/api/cron/refresh-raiders')),
      logs: () => runLogsRefresh(new URL('https://hidden-lodge.com/api/cron/refresh-logs')),
    });
  },
} satisfies Pick<ExportedHandler<Env>, 'scheduled'> & { fetch: typeof handle };
