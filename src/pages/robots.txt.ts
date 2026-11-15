import type { APIRoute } from 'astro';
import { buildRobotsTxt } from '../lib/site-routes';

export const prerender = false;

export const GET: APIRoute = () =>
	new Response(buildRobotsTxt(), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
