// Single source of truth for what search engines may index. The sitemap
// (/sitemap.xml), robots.txt (/robots.txt), and the per-page noindex meta in
// Layout.astro all read from here, so the three can't drift apart.
//
// Self-contained on purpose (no imports): scripts/test-site-routes.mjs transpiles
// and runs this file directly.

/** Canonical origin; every absolute URL we publish uses it. Matches `site` in astro.config.mjs. */
export const SITE_ORIGIN = 'https://hidden-lodge.com';

/**
 * Path prefixes that must never be indexed: admin, API, auth, and member-only
 * (or feature-gated) surfaces. They redirect or 403 for anonymous visitors, but
 * the URLs shouldn't be advertised either. Drives robots.txt Disallow lines and
 * the noindex meta tag. A prefix matches itself and anything beneath it.
 */
export const NOINDEX_PREFIXES = [
	'/admin',
	'/api',
	'/auth',
	'/profile',
	'/raiders',
	'/raid-composition',
	'/signup',
	'/feedback',
	'/trinkets',
	'/professions',
	'/loot-history',
	'/upgrades',
	'/death-analysis',
	'/mechanics-analysis',
	'/parse-analysis',
	'/group-size-analysis',
] as const;

/** True when `pathname` is one of the NOINDEX_PREFIXES or lives beneath one. */
export function isNoindexPath(pathname: string): boolean {
	return NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

type FeatureFlags = Readonly<Record<string, boolean>>;

export interface PublicRoute {
	path: string;
	/** Feature flags that must all be on for the page to be reachable. */
	requires?: readonly string[];
	/** Which real content timestamp (if any) the page's lastmod comes from. */
	lastmodFrom?: 'latestArticle';
}

/**
 * Indexable public pages: anonymous visitors get a 200 and real content.
 *
 * Deliberately not listed:
 * - everything in NOINDEX_PREFIXES (admin, API, auth, member-only tools)
 * - /articles/:slug: each 301-redirects to the post on orboro.net, so listing
 *   them would submit off-site URLs. Only the /articles index is listed.
 * - /hiatus: a transient between-seasons notice, not durable content
 * - /404 and other error pages
 *
 * When adding a public page, add it here (and gate it with `requires` if it sits
 * behind a feature flag in src/lib/feature-flags.ts).
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
	{ path: '/', lastmodFrom: 'latestArticle' }, // home shows the three newest articles
	{ path: '/raiding' },
	{ path: '/roster' },
	{ path: '/leadership' },
	{ path: '/articles', lastmodFrom: 'latestArticle' },
	{ path: '/links' },
	{ path: '/lore' },
	{ path: '/privacy' },
];

/** Public routes whose required feature flags are all enabled. */
export function listIndexableRoutes(flags: FeatureFlags): PublicRoute[] {
	return PUBLIC_ROUTES.filter(
		(route) => (route.requires ?? []).every((flag) => flags[flag] === true) && !isNoindexPath(route.path)
	);
}

/** Absolute canonical URL for a path. */
export function canonicalUrl(path: string): string {
	return new URL(path, SITE_ORIGIN).href;
}

/** Newest valid publishedAt among posts, as an ISO string, or null when none is usable. */
export function latestPublishedAt(posts: ReadonlyArray<{ publishedAt: string | null }>): string | null {
	let latest = -Infinity;
	for (const post of posts) {
		const time = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
		if (Number.isFinite(time) && time > latest) latest = time;
	}
	return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * sitemap.xml body. `latestArticleAt` is the newest Orboro post date, or null
 * when the feed is unavailable or empty; lastmod is omitted whenever its source
 * is unknown, never guessed.
 */
export function buildSitemapXml(flags: FeatureFlags, latestArticleAt: string | null): string {
	const entries = listIndexableRoutes(flags).map((route) => {
		const lastmod = route.lastmodFrom === 'latestArticle' ? latestArticleAt : null;
		return [
			'  <url>',
			`    <loc>${escapeXml(canonicalUrl(route.path))}</loc>`,
			...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
			'  </url>',
		].join('\n');
	});
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries,
		'</urlset>',
		'',
	].join('\n');
}

/** robots.txt body: allow the public site, disallow every NOINDEX prefix, point at the sitemap. */
export function buildRobotsTxt(): string {
	return [
		'User-agent: *',
		'Allow: /',
		'',
		'# Admin, API, auth, and member-only surfaces (NOINDEX_PREFIXES in src/lib/site-routes.ts).',
		'# They redirect or 403 for anonymous visitors; this keeps the URLs out of search results too.',
		...NOINDEX_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
		'',
		`Sitemap: ${canonicalUrl('/sitemap.xml')}`,
		'',
	].join('\n');
}
