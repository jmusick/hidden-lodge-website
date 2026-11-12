// Test-only Worker: POST a JSON array of HTML strings, get back the sanitized strings.
import { sanitizeRichHtml } from '../../src/lib/sanitize-html.ts';

export default {
  async fetch(request) {
    const inputs = await request.json();
    return Response.json(await Promise.all(inputs.map((html) => sanitizeRichHtml(html))));
  },
};
