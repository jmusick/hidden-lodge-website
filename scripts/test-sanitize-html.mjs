// Runs src/lib/sanitize-html.ts inside workerd (HTMLRewriter isn't available in Node) and checks
// that Quill's output survives while scripts, handlers, unsafe links, and malformed or encoded
// markup don't.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

// [input, expected output]; output is checked exactly.
const exact = [
  // What Quill's getSemanticHTML() emits for the editor's toolbar (bold/italic/underline, lists, links).
  [
    '<p><strong>Thu</strong> &amp; <em>Fri</em> <u>9pm</u>&nbsp;ET</p><ul><li>Flasks</li><li>Food</li></ul><ol><li>One</li><li>Two</li></ol>'
      + '<p><a href="https://discord.gg/example" rel="noopener noreferrer" target="_blank">Discord</a> or <a href="mailto:officers@example.com">email</a></p><p><br></p>',
    '<p><strong>Thu</strong> &amp; <em>Fri</em> <u>9pm</u>&nbsp;ET</p><ul><li>Flasks</li><li>Food</li></ul><ol><li>One</li><li>Two</li></ol>'
      + '<p><a href="https://discord.gg/example" rel="noopener noreferrer" target="_blank">Discord</a> or <a href="mailto:officers@example.com">email</a></p><p><br></p>',
  ],
  ['<ul><li>Outer<ul><li>Nested</li></ul></li></ul>', '<ul><li>Outer<ul><li>Nested</li></ul></li></ul>'],
  ['<p><a href="/raiders">Raiders</a> <a href="#signup">Sign up</a></p>', '<p><a href="/raiders">Raiders</a> <a href="#signup">Sign up</a></p>'],
  ['', ''],
  ['   ', ''],

  // Dropped elements lose their content too.
  ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
  ['<p>a<img src=x onerror=alert(1)>b</p>', '<p>ab</p>'],
  ['<svg><script>alert(1)</script></svg><p>ok</p>', '<p>ok</p>'],
  ['<math><mi><a href="javascript:alert(1)">x</a></mi></math>', ''],
  ['<iframe src="https://evil.example"></iframe><style>p{}</style><p>ok</p>', '<p>ok</p>'],
  ['<form action="/x"><input name="a"><button>Go</button></form>', ''],
  ['<textarea><p onclick="alert(1)">x</p></textarea>', ''],
  ['<!-- <script>alert(1)</script> --><p>ok</p>', '<p>ok</p>'],

  // Unknown elements are unwrapped, keeping their text.
  ['<div class="x"><p>Kept</p></div>', '<p>Kept</p>'],
  ['<p><font color="red">red</font></p>', '<p>red</p>'],

  // Attributes outside the allowlist are stripped.
  ['<p onclick="alert(1)" style="color:red" class="ql-align-center" data-x="1">t</p>', '<p>t</p>'],
  ['<strong ONMOUSEOVER="alert(1)">b</strong>', '<strong>b</strong>'],
  ['<a href="https://example.com" onclick="alert(1)" title="t">x</a>', '<a href="https://example.com">x</a>'],

  // Unsafe or obfuscated link schemes lose their href.
  ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
  ['<a href="  JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
  ['<a href="java&#x09;script:alert(1)">x</a>', '<a>x</a>'],
  ['<a href="javascript&colon;alert(1)">x</a>', '<a>x</a>'],
  ['<a href="&#106;avascript:alert(1)">x</a>', '<a>x</a>'],
  ['<a href="data:text/html,<script>alert(1)</script>">x</a>', '<a>x</a>'],
  ['<a href="vbscript:msgbox(1)">x</a>', '<a>x</a>'],
  ['<a href="">x</a>', '<a>x</a>'],

  // target/rel: only _blank survives, and it always gets noopener noreferrer.
  ['<a href="https://example.com" target="_blank" rel="opener">x</a>', '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'],
  ['<a href="https://example.com" target="_self" rel="opener">x</a>', '<a href="https://example.com">x</a>'],

  // Encoded markup stays text.
  ['<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'],
];

// Malformed input whose exact output depends on parser recovery: check that nothing executable survives.
const malformed = [
  '<p><scr<script>ipt>alert(1)</script></p>',
  '<<script>script>alert(1)<</script>/script>',
  '<p>open <strong>bold <em>both',
  '<a href="https://example.com"<img src=x onerror=alert(1)>x</a>',
  '<a href=\'https://example.com" onmouseover="alert(1)\'>x</a>',
  '<p title="a" title="b" onclick="alert(1)" onclick="alert(2)">t</p>',
  '<img/src=x/onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<a href="javascript:alert(1)" href="https://example.com">x</a>',
  '</p><script>alert(1)</script><p>',
  '<p>\u0000<script>alert(1)</script></p>',
  // workerd parses <noscript> as raw text, like a browser with scripting on; stray end tags remain.
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
];

const harness = createTestHarness({
  workers: [{ configPath: fileURLToPath(new URL('./sanitize-html-test-worker/wrangler.jsonc', import.meta.url)) }],
});
try {
  await harness.listen();
  const inputs = [...exact.map(([input]) => input), ...malformed];
  const response = await harness.fetch('/', { method: 'POST', body: JSON.stringify(inputs) });
  assert.equal(response.status, 200, await response.clone().text());
  const outputs = await response.json();

  exact.forEach(([input, expected], i) => {
    assert.equal(outputs[i], expected, `sanitizeRichHtml(${JSON.stringify(input)})`);
  });

  malformed.forEach((input, i) => {
    const output = outputs[exact.length + i];
    const message = `sanitizeRichHtml(${JSON.stringify(input)}) returned ${JSON.stringify(output)}`;
    // Parse the output the way a browser would: any surviving tag must be allowlisted, with
    // only allowlisted attributes, and no href outside the safe schemes.
    for (const [, name, attrs] of output.matchAll(/<([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
      assert.match(name.toLowerCase(), /^(p|br|strong|b|em|i|u|s|ol|ul|li|span|blockquote|pre|code|h[1-6]|a)$/, message);
      for (const [, attr] of attrs.matchAll(/([^\s"'=/]+)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)) {
        assert.ok(name.toLowerCase() === 'a' && ['href', 'target', 'rel'].includes(attr.toLowerCase()), message);
      }
    }
    for (const [, doubleQuoted, singleQuoted, unquoted] of output.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      assert.match(doubleQuoted ?? singleQuoted ?? unquoted, /^(?:https?:\/\/|mailto:|\/|#)/i, message);
    }
    assert.doesNotMatch(output, /<script|javascript:/i, message);
  });
} finally {
  await harness.close();
}

console.log(`Rich HTML sanitizer checks passed (${exact.length + malformed.length} cases).`);
