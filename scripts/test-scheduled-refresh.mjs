import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/cron/scheduled.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { CRON_JOBS, runScheduledRefresh } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
for (const [cron, expected] of Object.entries(CRON_JOBS)) {
  assert.ok(config.includes(JSON.stringify(cron)), 'Every handler schedule must be configured');
  const called = [];
  const jobs = Object.fromEntries(['refresh', 'raiders', 'logs'].map(job => [job, async () => {
    called.push(job);
    return Response.json({ success: true });
  }]));
  await runScheduledRefresh(cron, jobs);
  assert.deepEqual(called, [expected], 'Only the selected job should run');
}
const failure = () => Promise.resolve(Response.json({success: false, failed: ['deathAnalysis']}));
const jobs = {refresh: failure, raiders: failure, logs: failure};
await assert.rejects(runScheduledRefresh('10 */2 * * *', jobs), /deathAnalysis/);
await assert.rejects(runScheduledRefresh('unknown', jobs), /Unexpected cron/);
jobs.refresh = async () => Response.json({success: false}, {status: 500});
await assert.rejects(runScheduledRefresh('0,15,30,45 * * * *', jobs), /500/);
console.log('Scheduled refresh dispatch and failure checks passed.');
