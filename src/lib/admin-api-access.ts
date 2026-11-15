// Middleware-level authorization for /api/admin/*. Admin-only by default (fail closed); only the
// routes in OFFICER_ADMIN_API_PATHS also admit rank-3 officers. Routes keep their own checks too.

// Keep in sync with the "Officer access" note in AGENTS.md. Every /api/admin route whose handler
// deliberately accepts officers (rank 0-3) must be listed, or the middleware rejects them with 403.
export const OFFICER_ADMIN_API_PATHS: ReadonlySet<string> = new Set([
	'/api/admin/bench/refresh',
	'/api/admin/bench/reset-absent',
	'/api/admin/bench/role-override',
	'/api/admin/bench/set-flag',
	'/api/admin/death-analysis/log-override',
	'/api/admin/attendance/log-candidates',
	'/api/admin/attendance/log-matching',
	'/api/admin/attendance/toggle-bench',
]);

export type AdminApiDecision = 'not-admin-api' | 'allow' | 'unauthorized' | 'forbidden';

function normalize(path: string): string {
	return path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

function isAdminApiPath(path: string): boolean {
	const p = normalize(path).toLowerCase();
	return p === '/api/admin' || p.startsWith('/api/admin/');
}

export function decideAdminApiAccess(
	pathname: string,
	user: { id: number } | null,
	isAdmin: boolean,
	isOfficer: boolean
): AdminApiDecision {
	let decoded = pathname;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		// Undecodable paths are still classified on the raw form below.
	}
	// Classify on both forms so encoded variants can't dodge the guard; an officer exception
	// applies only when the raw and decoded paths agree and match the list exactly.
	if (!isAdminApiPath(pathname) && !isAdminApiPath(decoded)) return 'not-admin-api';
	if (!user) return 'unauthorized';
	if (isAdmin) return 'allow';
	const exact = normalize(pathname);
	if (isOfficer && exact === normalize(decoded) && OFFICER_ADMIN_API_PATHS.has(exact)) return 'allow';
	return 'forbidden';
}
