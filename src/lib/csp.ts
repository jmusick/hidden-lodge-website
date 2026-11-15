// Content-Security-Policy, currently sent as Report-Only (see AGENTS.md, "Security
// headers"; tracked in GitHub issue #18).
//
// The middleware (src/middleware.ts) generates a nonce per request, exposes it as
// `Astro.locals.cspNonce` for inline `<script nonce={...}>` tags, and calls
// `applyCspHeaders` on HTML responses. Only HTML responses get the header; API
// responses and static assets don't render documents.
//
// To allow a new origin, add it to the matching directive below and note it in
// AGENTS.md. Violations show up in the Workers logs as `[csp-report]` lines from
// /api/csp-report.

export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp-endpoint';

// Google Analytics / Tag Manager (Layout.astro).
const GOOGLE_ANALYTICS_SCRIPT = ['https://www.googletagmanager.com', 'https://www.google-analytics.com'];
const GOOGLE_ANALYTICS_CONNECT = [
	'https://www.googletagmanager.com',
	'https://www.google-analytics.com',
	'https://*.google-analytics.com',
	'https://*.analytics.google.com',
	'https://stats.g.doubleclick.net',
	'https://www.google.com', // GA4 page_view beacons go to www.google.com/g/collect (seen in Report-Only logs)
];

// Wowhead tooltips (https://wow.zamimg.com/js/tooltips.js) and its data/icons.
const WOWHEAD_SCRIPT = ['https://wow.zamimg.com'];
const WOWHEAD_CONNECT = ['https://nether.wowhead.com', 'https://www.wowhead.com', 'https://wow.zamimg.com'];

// Quill rich-text editor on /admin/raiding.
const QUILL_CDN = 'https://cdn.jsdelivr.net';

export function generateCspNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string): string {
	const directives: Record<string, string[]> = {
		'default-src': ["'self'"],
		// No 'strict-dynamic': Astro's bundled page scripts are external same-origin
		// files without a nonce, and 'strict-dynamic' would make browsers ignore 'self'.
		'script-src': ["'self'", `'nonce-${nonce}'`, ...WOWHEAD_SCRIPT, ...GOOGLE_ANALYTICS_SCRIPT, QUILL_CDN],
		// Component <style> blocks and style="" attributes are pervasive, and
		// Wowhead's tooltip script injects styles, so inline styles stay allowed.
		'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', QUILL_CDN, ...WOWHEAD_SCRIPT],
		// Item/character/spell art comes from many CDNs (Blizzard render, zamimg,
		// rpglogs, raider.io, Google favicons, YouTube thumbnails); any https image
		// is allowed until the reports show what can be tightened.
		'img-src': ["'self'", 'data:', 'https:'],
		'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', ...WOWHEAD_SCRIPT],
		'connect-src': ["'self'", ...WOWHEAD_CONNECT, ...GOOGLE_ANALYTICS_CONNECT],
		// The homepage YouTube embed.
		'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
		'object-src': ["'none'"],
		'base-uri': ["'self'"],
		// All forms post to this site; oauth.battle.net covers redirects out of a form POST.
		'form-action': ["'self'", 'https://oauth.battle.net'],
		'frame-ancestors': ["'none'"],
		'report-uri': [CSP_REPORT_PATH],
		'report-to': [CSP_REPORT_GROUP],
	};
	return Object.entries(directives)
		.map(([name, values]) => `${name} ${values.join(' ')}`)
		.join('; ');
}

/**
 * Adds the Report-Only policy (and the Reporting-Endpoints group `report-to`
 * names) to HTML responses. Anything else is left untouched.
 */
export function applyCspHeaders(response: Response, nonce: string): void {
	const contentType = response.headers.get('Content-Type') ?? '';
	if (!contentType.toLowerCase().includes('text/html')) return;
	try {
		response.headers.set('Content-Security-Policy-Report-Only', buildContentSecurityPolicy(nonce));
		response.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
	} catch {
		// Immutable headers (a redirect or proxied response): not an HTML page we rendered.
	}
}
