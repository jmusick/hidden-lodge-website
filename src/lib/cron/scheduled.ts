export const CRON_JOBS = {
  '0,15,30,45 * * * *': 'refresh',
  '5,20,35,50 * * * *': 'raiders',
  '10 */2 * * *': 'logs',
} as const;

type Job = (typeof CRON_JOBS)[keyof typeof CRON_JOBS];

/** Share the endpoint work, without HTTP authentication or a network self-request. */
export async function runScheduledRefresh(cron: string, jobs: Record<Job, () => Promise<Response>>): Promise<void> {
  const job = CRON_JOBS[cron as keyof typeof CRON_JOBS];
  if (!job) throw new Error(`Unexpected cron expression: ${cron}`);
  const startedAt = Date.now();
  const response = await jobs[job]();
  const result = await response.json() as { success?: boolean; failed?: string[] };
  const success = response.ok && result.success === true;
  console.log(JSON.stringify({ event: 'scheduled-refresh', job, cron, success, tookMs: Date.now() - startedAt, result }));
  // Partial refresh failures must show as failed Cron Events, even when HTTP returns 200.
  if (!success) throw new Error(`Scheduled ${job} refresh failed (${response.status}): ${result.failed?.join(', ') ?? 'see Worker logs'}`);
}
