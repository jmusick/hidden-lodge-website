import type { HTMLRewriter as HTMLRewriterClass } from '@cloudflare/workers-types';

/**
 * Allowlist sanitizer for admin-authored rich HTML (the Quill editors on /admin/raiding).
 *
 * Uses the Workers runtime's HTMLRewriter (a real HTML parser) instead of regexes, so
 * malformed or obfuscated markup can't slip past tag matching. Elements in DROPPED_TAGS are
 * removed with their content; anything else not in ALLOWED_ATTRIBUTES is unwrapped (tag
 * removed, text kept). Every attribute not explicitly allowed is stripped, including on*
 * handlers, style, and class.
 */

const ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [],
  ol: [], ul: [], li: [], span: [], blockquote: [], pre: [], code: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  a: ['href', 'target', 'rel'],
};

const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'noscript', 'noembed', 'noframes', 'template', 'svg', 'math', 'xmp', 'plaintext',
  'form', 'input', 'textarea', 'button', 'select', 'option',
  'link', 'meta', 'base', 'title', 'head',
  'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas',
]);

/**
 * Only absolute http(s)/mailto links, root-relative paths, and fragments pass. The check runs
 * on the raw attribute text, so an entity-encoded scheme (`javascript&colon;`) fails it rather
 * than being decoded into something executable by the browser.
 */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#)/i;

declare const HTMLRewriter: typeof HTMLRewriterClass;

export async function sanitizeRichHtml(html: string): Promise<string> {
  if (!html.trim()) return '';

  const rewriter = new HTMLRewriter()
    .onDocument({
      comments(comment) {
        comment.remove();
      },
    })
    .on('*', {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (DROPPED_TAGS.has(tag)) {
          element.remove();
          return;
        }

        const allowed = ALLOWED_ATTRIBUTES[tag];
        if (!allowed) {
          element.removeAndKeepContent();
          return;
        }

        for (const [name] of [...element.attributes]) {
          if (!allowed.includes(name.toLowerCase())) element.removeAttribute(name);
        }

        if (tag === 'a') {
          // Strip leading whitespace/control characters the way browsers do before resolving.
          const href = (element.getAttribute('href') ?? '').replace(/^[\u0000- ]+/, '');
          if (!href || !SAFE_HREF.test(href)) element.removeAttribute('href');

          if (element.getAttribute('target') === '_blank') {
            element.setAttribute('rel', 'noopener noreferrer');
          } else {
            element.removeAttribute('target');
            element.removeAttribute('rel');
          }
        }
      },
    });

  // The DOM and Workers Response types differ only nominally; the runtime object is the same.
  const transformed = rewriter.transform(new Response(html) as never) as unknown as Response;
  return transformed.text();
}
