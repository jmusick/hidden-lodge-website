// Checks the generated sitemap.xml and robots.txt (src/lib/site-routes.ts): well-formed XML,
// canonical absolute URLs, feature-flag handling, honest lastmod, and that no protected path leaks.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const load = async (path) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const routes = await load('../src/lib/site-routes.ts');
const { FEATURE_FLAGS } = await load('../src/lib/feature-flags.ts');
const { SITE_ORIGIN, NOINDEX_PREFIXES, PUBLIC_ROUTES, buildSitemapXml, buildRobotsTxt, isNoindexPath, latestPublishedAt, listIndexableRoutes } = routes;

const parse = (xml) => {
  // Minimal well-formedness check: prolog, one urlset root, balanced elements, no stray '&' or '<'.
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
  assert.ok(xml.trimEnd().endsWith('</urlset>'));
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  for (const [, close, name] of body.matchAll(/<(\/?)([a-zA-Z]+)[^>]*>/g)) {
    if (close) assert.equal(stack.pop(), name, `Unbalanced </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'All elements must be closed');
  const text = body.replace(/<[^>]*>/g, '');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(text) && !text.includes('<'), 'Unescaped markup characters');
  return [...body.matchAll(/<url>\s*<loc>([^<]*)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?\s*<\/url>/g)].map(([, loc, lastmod]) => ({ loc, lastmod }));
};

const latest = '2026-10-30T14:05:00.000Z';
const entries = parse(buildSitemapXml(FEATURE_FLAGS, latest));
assert.ok(entries.length >= 5, 'Sitemap should list the public pages');
assert.equal(entries.length, (buildSitemapXml(FEATURE_FLAGS, latest).match(/<url>/g) ?? []).length, 'Every <url> must parse');
assert.equal(new Set(entries.map((e) => e.loc)).size, entries.length, 'No duplicate URLs');
for (const { loc, lastmod } of entries) {
  const url = new URL(loc);
  assert.equal(url.origin, SITE_ORIGIN, `${loc} must use the canonical origin`);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.href, loc, `${loc} must be in normalized form`);
  assert.ok(!url.search && !url.hash, `${loc} must not carry a query or fragment`);
  assert.ok(!isNoindexPath(url.pathname), `${loc} is a protected path`);
  assert.ok(!/^\/articles\/.+/.test(url.pathname), `${loc} is an off-site redirect`);
  for (const prefix of ['/admin', '/api', '/auth', '/profile', '/signup', '/raiders', '/raid-composition', '/hiatus', '/404']) {
    assert.ok(url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`), `${loc} must not be in the sitemap`);
  }
  if (lastmod) assert.equal(new Date(lastmod).toISOString(), lastmod, 'lastmod must be a valid ISO timestamp');
}
const byPath = Object.fromEntries(entries.map((e) => [new URL(e.loc).pathname, e]));
assert.equal(byPath['/articles'].lastmod, latest);
assert.equal(byPath['/'].lastmod, latest);
assert.equal(byPath['/privacy'].lastmod, undefined, 'Pages without a content timestamp get no lastmod');

// No timestamp available: lastmod omitted everywhere, never fabricated.
assert.ok(!buildSitemapXml(FEATURE_FLAGS, null).includes('lastmod'));
assert.equal(latestPublishedAt([]), null);
assert.equal(latestPublishedAt([{ publishedAt: null }, { publishedAt: 'garbage' }]), null);
assert.equal(latestPublishedAt([{ publishedAt: '2026-01-02T00:00:00Z' }, { publishedAt: '2026-03-04T00:00:00Z' }, { publishedAt: null }]), '2026-03-04T00:00:00.000Z');

// Feature flags: a route requiring a disabled flag is dropped, and kept when the flag is on.
const original = PUBLIC_ROUTES.slice();
PUBLIC_ROUTES.push({ path: '/flagged', requires: ['someFlag'] });
assert.ok(!listIndexableRoutes({ someFlag: false }).some((r) => r.path === '/flagged'));
assert.ok(!listIndexableRoutes({}).some((r) => r.path === '/flagged'));
assert.ok(listIndexableRoutes({ someFlag: true }).some((r) => r.path === '/flagged'));
PUBLIC_ROUTES.splice(0, PUBLIC_ROUTES.length, ...original);
// A protected path can never be listed, even if added to the inventory by mistake.
PUBLIC_ROUTES.push({ path: '/admin/users' }, { path: '/api/foo' });
assert.ok(listIndexableRoutes({}).every((r) => !isNoindexPath(r.path)));
PUBLIC_ROUTES.splice(0, PUBLIC_ROUTES.length, ...original);

// robots.txt shares the exclusion list and points at the canonical sitemap.
const robots = buildRobotsTxt();
for (const prefix of NOINDEX_PREFIXES) assert.ok(robots.includes(`Disallow: ${prefix}\n`), `robots.txt must disallow ${prefix}`);
assert.ok(robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml\n`));

// Member-only/gated pages must be noindex.
for (const path of ['/admin', '/api/x', '/auth/login', '/profile', '/signup', '/raiders/1', '/raid-composition', '/feedback', '/group-size-analysis']) {
  assert.ok(isNoindexPath(path), `${path} must be noindex`);
}

// The static files these endpoints replaced must not come back to shadow them.
const publicDir = new URL('../public/', import.meta.url);
assert.ok(!existsSync(new URL('sitemap.xml', publicDir)) && !existsSync(new URL('robots.txt', publicDir)), 'public/ must not shadow the generated endpoints');
assert.ok(readdirSync(new URL('../src/pages/', import.meta.url)).includes('sitemap.xml.ts'));
assert.equal(readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8').match(/site:\s*'([^']+)'/)?.[1], SITE_ORIGIN, 'astro.config site must equal SITE_ORIGIN');

console.log('Sitemap and robots checks passed.');
