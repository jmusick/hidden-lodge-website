import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { runRefresh } from '../../../lib/cron/refresh';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const provided = request.headers.get('X-Cron-Secret');
  if (!env.CRON_SECRET || !provided || provided !== env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  return runRefresh(new URL(request.url));
};
