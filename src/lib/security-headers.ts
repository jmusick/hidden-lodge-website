// Baseline security headers for every response the site serves.
//
// src/worker.ts applies these to every response the Worker returns (SSR pages,
// API routes, middleware redirects and 403s, and error responses). Static files
// served straight from the Workers assets binding never reach the Worker, so
// `public/_headers` repeats the same values for them: keep the two in sync when
// changing anything here.
//
// Content-Security-Policy is deliberately not set here (tracked separately in
// GitHub issue #18).

// Features the site never uses. Left out on purpose because the site relies on
// them: clipboard-write (Raid Comp's "Export to Addon" copy button), and
// autoplay, encrypted-media, picture-in-picture, and fullscreen (delegated to
// the homepage's YouTube embed).
const DISABLED_FEATURES = [
	'accelerometer',
	'camera',
	'display-capture',
	'geolocation',
	'gyroscope',
	'hid',
	'magnetometer',
	'microphone',
	'midi',
	'payment',
	'serial',
	'usb',
	'xr-spatial-tracking',
];

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	// No `includeSubDomains` or `preload`: both commit every hidden-lodge.com
	// subdomain to HTTPS for the max-age and can't be withdrawn quickly, so
	// they're the site owner's call once the zone's other hosts are checked.
	'Strict-Transport-Security': 'max-age=31536000',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// Nothing frames this site's pages (the OAuth flow uses a popup window).
	'X-Frame-Options': 'DENY',
	'Permissions-Policy': DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', '),
};

function setSecurityHeaders(headers: Headers): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(name, value);
	}
}

/**
 * Adds the baseline security headers to `response`. Responses with immutable
 * headers (e.g. `Response.redirect()` or a proxied `fetch()` response) are
 * rebuilt first, so the returned response always has mutable headers.
 */
export function withSecurityHeaders(response: Response): Response {
	try {
		setSecurityHeaders(response.headers);
		return response;
	} catch {
		const rebuilt = new Response(response.body, response);
		setSecurityHeaders(rebuilt.headers);
		return rebuilt;
	}
}
