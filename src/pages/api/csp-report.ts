import type { APIRoute } from 'astro';

export const prerender = false;

// Receives Content-Security-Policy violation reports (`report-uri` sends
// `application/csp-report`; the Reporting API / `report-to` sends
// `application/reports+json`). Reports are logged compactly to the Workers logs and
// dropped: no database, no auth (browsers send them without cookies), always 204.

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_LOGGED = 10;
const MAX_FIELD_LENGTH = 200;

function clip(value: unknown): string | undefined {
	if (typeof value !== 'string' || value === '') return undefined;
	// Collapse whitespace/control characters so a report can't forge extra log lines.
	const flat = value.replace(/[\s\u0000-\u001f\u007f]+/g, ' ');
	return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH)}...` : flat;
}

function summarize(report: unknown): Record<string, string> | null {
	if (!report || typeof report !== 'object') return null;
	const raw = report as Record<string, unknown>;
	// Legacy format wraps the fields in "csp-report"; the Reporting API wraps them in "body".
	const body = (raw['csp-report'] ?? raw.body ?? raw) as Record<string, unknown>;
	if (!body || typeof body !== 'object') return null;

	const pick = (...keys: string[]) => {
		for (const key of keys) {
			const value = clip(body[key]);
			if (value) return value;
		}
		return undefined;
	};

	const summary: Record<string, string | undefined> = {
		directive: pick('effectiveDirective', 'effective-directive', 'violatedDirective', 'violated-directive'),
		blocked: pick('blockedURL', 'blocked-uri', 'blockedUri'),
		document: pick('documentURL', 'document-uri', 'documentUri'),
		source: pick('sourceFile', 'source-file'),
		line: pick('lineNumber', 'line-number') ?? (typeof body.lineNumber === 'number' ? String(body.lineNumber) : undefined),
		disposition: pick('disposition'),
		sample: pick('scriptSample', 'script-sample'),
	};
	const entries = Object.entries(summary).filter((entry): entry is [string, string] => entry[1] !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export const POST: APIRoute = async ({ request }) => {
	const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
	const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
	const acceptable = contentType.includes('application/csp-report') || contentType.includes('application/reports+json') || contentType.includes('application/json');

	if (acceptable && !(declaredLength > MAX_BODY_BYTES)) {
		try {
			const text = await readCapped(request);
			if (text !== null) {
				const parsed: unknown = JSON.parse(text);
				const reports = Array.isArray(parsed) ? parsed : [parsed];
				for (const report of reports.slice(0, MAX_REPORTS_LOGGED)) {
					const summary = summarize(report);
					if (summary) console.log('[csp-report]', JSON.stringify(summary));
				}
			}
		} catch {
			// Malformed report: nothing useful to log.
		}
	}

	return new Response(null, { status: 204 });
};

/** Reads the body, giving up (null) once it exceeds MAX_BODY_BYTES. */
async function readCapped(request: Request): Promise<string | null> {
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
