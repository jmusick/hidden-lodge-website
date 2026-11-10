// Baseline security headers for every response the site serves.
//
// The middleware applies these to SSR pages, API routes, redirects, and its own
// early-return responses. Static files served straight from the Workers assets
// binding never reach the middleware, so `public/_headers` repeats the same
// values for them: keep the two in sync when changing anything here.
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
	// No `preload`: submitting the domain to the HSTS preload list is a
	// one-way decision for the site owner.
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
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
