import type { APIRoute } from 'astro';
import { FEATURE_FLAGS } from '../lib/feature-flags';
import { ARTICLES_CATEGORY, fetchOrboroPostsByCategory } from '../lib/orboro-posts';
import { buildSitemapXml, latestPublishedAt } from '../lib/site-routes';

export const prerender = false;

export const GET: APIRoute = async () => {
	// lastmod for the pages that show articles comes from the Orboro feed's newest
	// post date. If the feed is down we omit lastmod rather than invent one.
	let latestArticleAt: string | null = null;
	try {
		latestArticleAt = latestPublishedAt(await fetchOrboroPostsByCategory(ARTICLES_CATEGORY));
	} catch {
		// leave null
	}
	return new Response(buildSitemapXml(FEATURE_FLAGS, latestArticleAt), {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=600',
		},
	});
};
