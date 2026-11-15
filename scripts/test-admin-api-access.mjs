// Checks the /api/admin/* middleware decision: admin-only by default, officer exceptions by list.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/admin-api-access.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { decideAdminApiAccess, OFFICER_ADMIN_API_PATHS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const user = { id: 1 };
const roles = {
  anonymous: [null, false, false],
  nonmember: [user, false, false],
  member: [user, false, false], // guild member without officer rank looks the same to this guard
  officer: [user, false, true],
  admin: [user, true, true],
};
const decide = (path, role) => decideAdminApiAccess(path, ...roles[role]);

const officerRoutes = [...OFFICER_ADMIN_API_PATHS];
const adminOnly = [
  '/api/admin/cache/refresh',
  '/api/admin/death-analysis/refresh',
  '/api/admin/settings/purge-sim-data',
  '/api/admin/roster-teams/create-team',
  '/api/admin/applications/12/set-status',
  '/api/admin/some-new-route-without-checks',
  '/api/admin',
];

for (const path of officerRoutes) {
  assert.equal(decide(path, 'anonymous'), 'unauthorized', path);
  assert.equal(decide(path, 'nonmember'), 'forbidden', path);
  assert.equal(decide(path, 'member'), 'forbidden', path);
  assert.equal(decide(path, 'officer'), 'allow', path);
  assert.equal(decide(path, 'admin'), 'allow', path);
}
for (const path of adminOnly) {
  assert.equal(decide(path, 'anonymous'), 'unauthorized', path);
  assert.equal(decide(path, 'nonmember'), 'forbidden', path);
  assert.equal(decide(path, 'member'), 'forbidden', path);
  assert.equal(decide(path, 'officer'), 'forbidden', path);
  assert.equal(decide(path, 'admin'), 'allow', path);
}

// Path variants can't dodge the guard or widen the officer list.
for (const path of ['/api/admin/', '/api//admin/cache/refresh', '/api/%61dmin/cache/refresh', '/API/Admin/cache/refresh', '/api/admin/cache/refresh/']) {
  assert.equal(decide(path, 'anonymous'), 'unauthorized', path);
  assert.equal(decide(path, 'officer'), 'forbidden', path);
}
for (const path of ['/api/admin/bench/set-flag/', '/api/admin/bench/set-flag/extra', '/api/admin/bench/%73et-flag', '/api/admin/bench/set-flag%2F..%2F..%2Fcache']) {
  if (path === '/api/admin/bench/set-flag/') assert.equal(decide(path, 'officer'), 'allow', path);
  else assert.equal(decide(path, 'officer'), 'forbidden', path);
}

// Everything else is untouched: public, officer-facing non-admin API, cron, desktop, admin pages.
for (const path of ['/', '/api/raid-composition/clear', '/api/cron/refresh-logs', '/api/desktop/sync', '/api/administrator', '/admin', '/admin/log-matching', '/api/adminx/foo']) {
  for (const role of Object.keys(roles)) assert.equal(decide(path, role), 'not-admin-api', `${role} ${path}`);
}

// Drift check: any admin API handler that admits non-admins must be in the officer list.
const apiRoot = fileURLToPath(new URL('../src/pages/api/admin', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
});
const officerPattern = /isOfficer|isGuildOfficer|canManageLogMatching|can_override/;
for (const file of walk(apiRoot)) {
  const route = '/api/admin/' + relative(apiRoot, file).split(sep).join('/').replace(/\.ts$/, '');
  if (officerPattern.test(readFileSync(file, 'utf8'))) {
    assert.ok(OFFICER_ADMIN_API_PATHS.has(route), `${route} accepts officers but is missing from OFFICER_ADMIN_API_PATHS`);
  }
}
for (const route of OFFICER_ADMIN_API_PATHS) {
  const file = join(apiRoot, route.slice('/api/admin/'.length) + '.ts');
  assert.ok(statSync(file).isFile(), `${route} is listed but has no handler`);
}

console.log('admin API access checks passed');
