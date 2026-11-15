// @ts-check
import { defineConfig } from 'astro/config';
import { sessionDrivers } from 'astro/config';
import astroIcon from 'astro-icon';
import cloudflare from '@astrojs/cloudflare';
import { fileURLToPath } from 'node:url';

// https://astro.build/config
export default defineConfig({
	site: 'https://hidden-lodge.com', // keep equal to SITE_ORIGIN in src/lib/site-routes.ts
	output: 'server',
	adapter: cloudflare({
		imageService: 'compile',
	}),
	session: {
		driver: sessionDrivers.lruCache(),
	},
	vite: {
		build: {
			// Never inline hoisted <script> bundles into the HTML: Astro-generated inline
			// scripts carry no nonce, so the Content-Security-Policy would block them.
			assetsInlineLimit: 0,
		},
		server: {
			allowedHosts: true,
			port: 4321,
			strictPort: true,
		},
		resolve: {
			alias: {
				debug: fileURLToPath(new URL('./src/lib/debug-shim.ts', import.meta.url)),
			},
		},
		ssr: {
			noExternal: ['debug'],
		},
	},
	integrations: [astroIcon()],
});
