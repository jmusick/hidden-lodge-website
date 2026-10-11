# Archived September 2026 audits

Recovered 2026-10-11 from the local pre-consolidation TODO backup dated 2026-10-04. The original September 17 security/SEO/accessibility audit and September 20 design audit are preserved below as historical evidence. Check [the current reconciliation](../BACKLOG.md) before acting: several unchecked items below have since shipped or were superseded by [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md). Source paths and line numbers in this historical report may have moved.

# TODO — HiddenLodgeWebsite

Astro SSR app on Cloudflare Workers (`output: 'server'`) for the guild site: Blizzard OAuth
login, D1-backed roster / attendance / loot / sim tooling, and an admin surface.

Local working checklist — gitignored, not a deliverable.
**Audit: 2026-09-17** · security / accessibility / SEO · static source review only (no build,
no dev server, no live header probes, no `npm audit`).

**Effort** — S: under an hour · M: half a day · L: a day or more
**Impact** — High: real exposure, or visitors/search see it · Medium · Low: polish

| # | Item | Area | Impact | Effort |
|---|------|------|--------|--------|
| 1 | Session cookie is written by client-side JS, so it can't be `HttpOnly` | Security | High | M |
| 2 | No security response headers at all | Security | High | M |
| 3 | Rich-text sanitizer is regex-based and misses `javascript:` URLs | Security | Medium | M |
| 4 | Homepage has no `<h1>` | SEO / A11y | Medium | S |
| 5 | No skip link on any page | A11y | Medium | S |
| 6 | `/api/admin/*` isn't guarded in middleware, only per-route | Security | Medium | S |
| 7 | Hand-maintained `sitemap.xml`, no `lastmod` | SEO | Low | S |
| 8 | Four dead 410-stub API routes | Cleanup | Low | S |

Because this is `output: 'server'`, almost every response comes from the Worker rather than
the static asset layer — which is why items 1 and 2 are bigger jobs here than on the
marketing sites.

---

## Do first — high impact

### 1. The session cookie is written by client-side JavaScript

`src/pages/raiding.astro:1142` and `:1152` set the session cookie from a `postMessage`
handler:

```js
document.cookie = 'hl_session=' + encodeURIComponent(event.data.sessionId) + '; path=/; …'
```

A cookie written via `document.cookie` **cannot** be `HttpOnly`. So while
`src/lib/auth.ts:110` correctly issues `hl_session` with `HttpOnly` on the server path, this
second path issues the same cookie without it — and the weaker one wins, because it's the
one that lands on the login flow visitors actually use.

The consequence: any XSS anywhere on the site can read the session cookie and take over the
account. That's the specific thing `HttpOnly` exists to prevent, and it's currently
defeated. The session ID also passes through JS memory and the `postMessage` channel before
it gets there.

To be fair to the existing code, the origin check is correct — `event.origin !==
window.location.origin` returns early (`raiding.astro:1136`), so this isn't
trivially exploitable from a third-party page. The problem is the cookie's own flags, not
the message handling.

The fix is to stop passing the session ID to the client at all. The OAuth callback
(`src/pages/auth/callback.ts`) already runs server-side and already knows how to set a
proper cookie — it should `Set-Cookie` there and have the popup simply signal "done, reload"
rather than shipping the ID across.

- [ ] Set `hl_session` in `auth/callback.ts` with `HttpOnly` via the existing
      `sessionCookie()` helper in `src/lib/auth.ts`
- [ ] Reduce the `postMessage` payload to a bare `{ type: 'blizzard-session-ready' }` — no
      `sessionId`
- [ ] Delete both `document.cookie` writes in `raiding.astro`
- [ ] Keep `applyBlizzardData(event.data)` working for the battletag/display data, which is
      non-sensitive and fine to pass
- [ ] Re-test the full popup login flow in both Chrome and Firefox; the reload timing
      (`setTimeout(…, 100)`) exists because of the old cookie write and may need revisiting

### 2. No security response headers

The site ships **zero** security headers: no CSP, no HSTS, no `X-Content-Type-Options`, no
`X-Frame-Options` / `frame-ancestors`, no `Referrer-Policy`, no `Permissions-Policy`. There
is no `public/_headers` file and `src/middleware.ts` sets none.

`public/_headers` alone will not fix this. The site is `output: 'server'`, so every page and
API route is rendered by the Worker, not served from the static-asset layer that `_headers`
covers. The headers have to be set in middleware.

**orboro has already solved exactly this problem** on the same stack — see
`orboro/src/middleware.ts`, which sets the static headers on every response and builds a
nonce-based CSP. Read `orboro/AGENTS.md` (§ "Security response headers") and
`orboro/TODO.md` § S1 before starting; the notes there record which parts were fiddly.

A caveat worth knowing up front: this codebase has a lot of inline `<script is:inline>`
blocks (`raiding.astro`, `RaiderSimTools.astro`, several admin pages). A nonce-based CSP
means threading a nonce through every one of them, which is the bulk of the work. Doing the
non-CSP headers first is a legitimate cheap win — they're independent.

- [ ] Set `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options`, `Permissions-Policy` in `src/middleware.ts` (quick, do this first)
- [ ] Add `public/_headers` for genuinely static assets
- [ ] Then tackle CSP: generate a per-request nonce, expose it on `Astro.locals`, and
      thread it through every inline script/style
- [ ] Ship CSP as `Content-Security-Policy-Report-Only` first — but decide where reports go
      before you do, or it collects nothing (this is the trap orboro is currently sitting in)
- [ ] Origins to allowlist: WarcraftLogs, Raidbots, `wowhead.com`, Blizzard OAuth, and
      whatever the sim tooling calls

### 3. The rich-text sanitizer is regex-based

`src/pages/api/admin/raiding/update-content.ts:9` sanitizes admin-submitted Quill HTML with
three regexes: strip `<script>…</script>`, strip quoted `on*=` handlers, strip unquoted
`on*=` handlers. That output is stored in D1 and rendered to **every public visitor** via
`set:html` on `src/pages/raiding.astro:362,375,396`.

Regex HTML sanitizers leak. The clearest gap here is that nothing touches URL schemes, so
this survives untouched and fires on click for every visitor to `/raiding`:

```html
<a href="javascript:/* anything */">Raid schedule</a>
```

`<iframe src="javascript:…">`, `<object data=…>` and entity-encoded handler attributes
(`onerror&#61;`) are in the same category.

Realistically this requires a malicious or compromised admin, so it's not an open door —
which is why it's Medium rather than High. But "we sanitize it" is currently doing less work
than it looks like it is.

Note that a working CSP (item 2) neutralises most of this, so there's an argument for
sequencing 2 before 3.

- [ ] Replace the regexes with an allowlist sanitizer — permit only the tags and attributes
      Quill actually emits (`p`, `br`, `strong`, `em`, `u`, `s`, `ol`, `ul`, `li`, `a[href]`,
      `h2`–`h4`, `blockquote`), drop everything else
- [ ] Validate `a[href]` against an explicit scheme allowlist (`https:`, `http:`, `mailto:`)
      rather than trying to block bad ones
- [ ] Sanitize on **render** as well as on write — existing rows in D1 went through the old
      sanitizer and were never re-checked

### 4. The homepage has no `<h1>`

`src/pages/index.astro` starts its document outline at `<h2>` (first heading is at line 70).
There is no `<h1>` anywhere on it.

This is the site's most linked-to page. The `<h1>` is a primary relevance signal for search,
and for a screen-reader user the outline reads as though it begins mid-document.

- [x] Add a single `<h1>` to `index.astro` — the guild name, or the hero line already
      rendered there, promoted from `<h2>` (added as a visually-hidden `<h1>The Hidden
      Lodge</h1>` ahead of the header image — there was no existing hero text to promote)
- [x] Check the rest of the outline still descends by one level after the change (h1 →
      the page's h2s: Latest Articles / Latest Videos / Raid Schedule / Guild Rules /
      Guild Links — all still h2, unaffected)

### 5. No skip link

No page has a skip link — `grep` for `skip-link` across `src/` returns nothing. Keyboard and
screen-reader users tab through the full site nav on every page load before reaching
content. The nav here is large, so this costs more than it does on a small site.

All four marketing sites in this workspace already do this; `SimonRook/src/layouts/Layout.astro`
has the markup and `universal.css` has the `.skip-link` styles to copy.

- [ ] Add `<a class="skip-link" href="#main">Skip to content</a>` as the first child of
      `<body>` in `src/layouts/Layout.astro`
- [ ] Confirm the `<main>` in that layout has `id="main"`
- [ ] Do the same in `src/layouts/AdminLayout.astro`
- [ ] Test: load a page, press Tab once, confirm the link appears and moves focus

---

## Lower priority

### 6. `/api/admin/*` is not guarded in middleware

`src/middleware.ts:47` computes `isAdminApi` but only ever uses it to set cache headers
(`:70`). The actual guard at `:50` fires on `isAdminPage` alone, so `/api/admin/*` routes
are protected only by their own per-route checks.

I checked all 39 routes under `src/pages/api/admin/` and **every one is correctly guarded**
— there is no live hole here today. Five had no `isAdmin` reference, and all five turned out
to be fine: four are `410 Gone` stubs (item 8) and `applications/[id]/delete.ts:19` gates on
a hardcoded battletag instead.

So this is purely defence-in-depth: right now, a new admin API route that forgets its guard
ships unprotected, and nothing catches it.

- [ ] Extend the middleware guard from `isAdminPage` to `isAdminSurface` so `/api/admin/*`
      fails closed by default
- [ ] Return `403` JSON rather than a redirect for the API branch — a redirect to
      `/auth/login` is a confusing response to an XHR

### 7. `sitemap.xml` is hand-maintained

`public/sitemap.xml` is a static file listing 8 URLs with no `<lastmod>` on any of them. The
URL selection is actually correct — the member-only surfaces are deliberately excluded and
match the `Disallow` list in `robots.txt` — but nothing keeps the two in sync as pages come
and go, and without `lastmod` crawlers get no recrawl signal for updated content.

- [ ] Replace with a generated `src/pages/sitemap.xml.ts` route — `orboro/src/pages/sitemap.xml.ts`
      is the working example on this same stack
- [ ] Emit real `lastmod` values from the D1 content timestamps
- [ ] Keep the exclusion list derived from one shared constant alongside `NOINDEX_PREFIXES`,
      so `robots.txt`, the sitemap and the `noindex` meta can't drift apart

### 8. Dead 410-stub API routes

Four routes are now nothing but `return new Response('Gone', { status: 410 })`:

- `src/pages/api/admin/assign-character.ts`
- `src/pages/api/admin/unassign-character.ts`
- `src/pages/api/admin/create-profile.ts`
- `src/pages/api/admin/update-profile.ts`

Returning 410 was the right call when they were retired. Enough time has probably passed to
just delete them — and they're the reason the guard audit in item 6 needed manual
follow-up.

- [ ] Confirm nothing still calls them (check the desktop app and any addon integration, not
      just this repo), then delete

---

## Verified good — don't re-audit these

Checked this pass and found nothing to fix:

- **Admin authorization is complete.** All 39 routes under `src/pages/api/admin/` are
  guarded, and every `/admin` *page* is guarded centrally in middleware. See item 6 — that's
  about future-proofing, not a current gap.
- **Client-side table rendering is properly escaped.** `RaiderSimTools.astro` builds a lot
  of HTML via `innerHTML`, but every interpolation goes through the `esc()` helper at
  `:364`, which covers `&`, `<`, `>`, `"` and `'`. I checked the call sites, not just the
  helper.
- **The `postMessage` handler validates `event.origin`** against
  `window.location.origin` (`raiding.astro:1136`). Item 1 is about the cookie's flags, not
  this check.
- **Admin pages already set `Cache-Control: no-store` + `Vary: Cookie`** in middleware
  (`:70-74`), so authenticated pages don't land in shared caches.
- **SQL is parameterized.** The handful of template literals in `raiders.ts`, `sim-api.ts`,
  `upgrades.ts` and `loot-history.astro` interpolate only generated `?` placeholder lists and
  compile-time table/column constants — never request data.
- **Secrets are properly gitignored.** `.env` and `.dev.vars` are both ignored, and the
  `.example` files contain placeholders rather than live values.
- **`robots.txt` is thorough** and deliberately kept in sync with `NOINDEX_PREFIXES`, with a
  comment saying so.
- **Legacy `/articles/<slug>` URLs are handled correctly for SEO** — `rewrite` to a real 404
  for unknown slugs (avoiding a soft-404) and a `301` for known ones.
- Accessibility baseline is reasonable outside the skip link: `<html lang="en">`,
  `:focus-visible` in 17 files, `aria-live` regions in 7, `aria-label` in 27, no images
  missing `alt`.

---
---

# Design system pass — typography, spacing, components

**Audit: 2026-09-20** · visual consistency / CSS architecture · static source review only
(no build, no dev server, no visual diffing — every number below is counted from `src/**/*.astro`).

Separate concern from the security audit above, so items are numbered `D1`–`D8` to keep the
two lists from colliding.

## What's actually there

There is no design system. There is no `src/styles/` directory and not one `.css` file in the
repo — all **~15,000 lines of CSS** live in 41 per-file `<style>` blocks, the largest being
`raiders/[charId].astro` (1,335 lines), `signup.astro` (1,168) and `raid-composition.astro`
(1,089). The only shared visual component, `src/components/SectionCard.astro`, is used exactly
twice, both on `index.astro`.

The design tokens that do exist are 6 colors and 2 font families in `src/layouts/Layout.astro:287`.
Everything else is a literal, re-typed per page:

| Measured | Count |
|---|---|
| Distinct color literals (hex / rgba) | **807** in 1,984 occurrences |
| `rgba(214, 176, 106, ...)` — the `--gold` token, hand-expanded | **537** occurrences at **55** distinct alphas |
| Distinct dark surface fills | **186** |
| Distinct `font-size` values | **60+** |
| Distinct `border-radius` values | **38** |
| Distinct `gap` values | **45** |
| Distinct `padding` shorthands | **224** |
| Distinct `@media` breakpoints | **26** |
| `var(--token)` usages, all tokens combined | ~370 |

That last row is the headline: the codebase reaches for a raw literal **five times more often**
than it reaches for a token.

The duplication is structural, not incidental — the same primitive is redefined per page:

| Primitive | Defined in | Agree? |
|---|---|---|
| `.empty-state` | **12** files | No — 6 different colors, italic optional |
| `.page-header` | **10** files | No — flex vs block, 3 heading sizes |
| `.sort-btn` | **8** files | No — 2 unrelated visual treatments |
| `.table-wrap` | **8** files | Mostly |
| `.btn` | **5** files | No — see D5 |
| `*-card` | **~30** class names across 23 files | No |

## How this has to ship under Astro

This constrains the whole plan, so settle it before writing any CSS.

Astro scopes every `<style>` block to its own component by appending an `.astro-<hash>` class to
selectors. Two consequences, both verified against the built output in `dist/_astro/`:

1. **`:root` is left alone.** Grepping `:root` in `dist/_astro/*.css` returns a bare `:root{`, so
   the tokens in `Layout.astro:287` genuinely are global. **Adding tokens there is zero-risk and
   reaches every page** — that's why D1 is first and can land on its own.
2. **Class rules are not.** A `.card` defined in `Layout.astro`'s `<style>` would become
   `.card.astro-<hash>` and never match markup on `roster.astro`. So shared component classes
   **cannot** go in a layout's scoped style block.

The fix is a real global stylesheet: `.css` files under `src/styles/`, imported from
`Layout.astro`'s frontmatter. Astro treats imported CSS as global and bundles it once.

A useful side effect for migration: scoped page rules carry the extra `.astro-<hash>` class, so
they have **higher specificity** than an unscoped global rule of the same shape. A page keeps
rendering exactly as it does today until its local block is deleted — which means D5–D8 can be
migrated one page at a time with no flag and no big-bang cutover.

Worth folding in while we're here: `raid-composition.astro` carries **59** `:global()` escapes and
`death-analysis.astro` **12**, both because they render chips client-side and scoped rules
silently don't apply (there's a comment saying exactly that at `death-analysis.astro:818`). Those
rules are already global in effect — moving them into the shared stylesheet removes the escape
hatch rather than adding one.

---

## D1. Token vocabulary — the foundation

`Layout.astro:287` defines `--bg`, `--bg-soft`, `--bg-panel`, `--gold`, `--gold-bright`, `--steel`,
`--text`, `--muted`, `--border`, and two font families. That's it. There is no token for spacing,
radius, elevation, motion, or any state color.

The single worst offender is gold transparency. `--gold` is `#d6b06a` = `rgb(214 176 106)`, and the
codebase hand-expands it **537 times across 55 distinct alpha values** — 0.02, 0.03, 0.04, 0.05,
0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.18, 0.2, ... There is no way 55
steps are meaningful; they're drift. Collapse them to a semantic ladder of ~6 and the difference
won't be visible, but the vocabulary becomes sayable.

Prefer **semantic** names over raw ramps — `--border-subtle` tells you where it goes,
`--gold-a18` doesn't.

- [ ] Add `--gold-rgb: 214 176 106` so alpha variants derive (`rgb(var(--gold-rgb) / 0.2)`) instead
      of being retyped
- [ ] Add a border ladder: `--border-subtle` (~0.12), `--border` (~0.2, already exists at 0.4 —
      check what it should be), `--border-strong` (~0.35), `--border-focus` (~0.55)
- [ ] Add a surface ladder: `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-hover`,
      `--surface-active` — this is what replaces the 186 one-off dark fills
- [ ] Add state colors: success / warning / danger / info. These exist today only as page-local
      literals (`#f47e7e`, `rgba(0, 180, 80, 0.12)`, `rgba(36, 86, 42, 0.25)`, ...)
- [ ] Add `--focus-ring` — see D8, half the interactive surface has no focus style
- [ ] **Leave WoW class/quality colors alone.** `#1eff00`, `#0070dd`, `#a335ee`, `#ff8000` are
      Blizzard's item-quality palette and are correct as literals — but move them to one named
      block (`--quality-uncommon`, ...) so they stop being re-typed per page
- [ ] Add `--transition-fast`. Today the same hover effect is written at 120ms, 140ms, 150ms **and**
      160ms depending on the file

## D2. Type scale

**60+ distinct font sizes** for what is realistically a 7-step scale. The dense middle of the
distribution is the giveaway — `0.82rem` (49x), `0.9rem` (47x), `0.8rem` (46x), `0.78rem` (44x),
`0.85rem` (40x), `0.88rem` (37x), `0.72rem` (34x), `0.95rem` (29x). Nobody chose `0.78` over `0.8`
for a reason; those are eight neighbours of one intended size.

Note `html { font-size: 18px }` at `Layout.astro:321`, so `1rem` = 18px and `0.78rem` is about
14px. Keep the 18px base — just stop subdividing it 60 ways.

Separately: **`<h1>` has no global size.** `Layout.astro:324` sets `font-family` and
`letter-spacing` on `:global(h1,h2,h3)` but never `font-size`. **20 pages** render a bare `<h1>`
with no page-level rule, so they fall through to the UA default (2em = 36px), while styled pages
use `clamp(2rem, 3.1vw, 2.95rem)` (about 36–53px). Two different h1 sizes on the same site, by
accident.

- [ ] Define a scale as tokens — roughly `--text-2xs` .68 / `--text-xs` .74 / `--text-sm` .82 /
      `--text-base` .9 / `--text-md` 1 / `--text-lg` 1.15 / `--text-xl` 1.5 / `--text-2xl` clamp(...)
- [ ] Snap all 60+ existing sizes to the nearest step (see *Open decisions* — this shifts pixels)
- [ ] Give `h1`/`h2`/`h3` real global sizes in the base stylesheet so bare headings are correct
      by default, and drop the per-page h1 rules that only restate it
- [ ] Standardize the uppercase-label treatment. It recurs constantly (`font-size` ~.78,
      `text-transform: uppercase`, `letter-spacing: .06em`) with drifting values — make it one
      `.label` / `--text-label` pattern
- [ ] Set a global `line-height`. It's currently declared ad hoc and often not at all
- [ ] This item pairs with security-audit item 4 (homepage has no `<h1>`) — do them together

## D3. Spacing, radius and breakpoints

- **45 distinct `gap` values** and **224 distinct `padding` shorthands.** The gap distribution has
  the same shape as the type scale — `0.5` (62x), `1` (47x), `0.75` (36x), `0.45` (35x), `0.35`
  (31x), `0.4` (30x). `0.35` / `0.4` / `0.45` are one value wearing three hats.
- **38 distinct `border-radius` values**, including `0.42rem`, `0.28rem`, `0.32rem`, `0.375rem`,
  `0.16rem`, `0.62rem` — plus a mix of `rem` and `px` (`4px`, `3px`, `2px`, `8px`, `16px`).
- **26 distinct breakpoints**: 480, 520, 560, 600, 620, 640, 700, 720, 760, 768, 800, 860, 900,
  980, 1000, 1040, 1080, 1100, 1120, 1200, 1310, 1320 px *and* 36rem, 54rem, 62rem. The 760/768
  and 1310/1320 pairs are almost certainly the same intent typed twice.

- [ ] Define a 4-step-ish space scale (`--space-1` ... `--space-8`) on a consistent ratio and snap to it
- [ ] Define `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` (`999px` is already
      used 53x and is consistent — keep it, just name it)
- [ ] Pick 4–5 named breakpoints and a rule for when each applies; converge the 26
- [ ] Convert the stray `px` radii to `rem`

## D4. Tables

**12 pages render a `<table>`; there are at least 4 unrelated implementations.** Compare:

| | `roster.astro:841` | `raiders.astro:1322` | `loot-history.astro:1167` | `death-analysis.astro:651` |
|---|---|---|---|---|
| Selector | `.roster-table` | `.raiders-table` | bare `table` / `thead th` | `.review-table` |
| Cell padding | `.58rem .65rem` | `.58rem .65rem` | `.55rem` | `.78rem .72rem` |
| Divider | `border-bottom` @ .18 | `border-bottom` @ .18 | `border-bottom` @ .28/.14 | **`border-top`** @ .12 |
| Cell font | `.95rem` | `.95rem` | `.92rem` | inherit |
| Header | sticky, `rgba(15,28,43,.88)` | sticky, same | sticky, uppercase muted | **not sticky**, gold uppercase |
| Row hover | gold .08 | gold .08 | gold .06 | — |
| Zebra | — | — | gold .03 | — |

`roster` and `raiders` are a copy-paste pair; the other two were each written from scratch. Note
`loot-history` styles the bare `table`/`thead th`/`tbody td` elements, which only works because
Astro scoping contains it — that rule would collide the moment it went global.

`.sort-btn` is worse: defined in **8 files**, in two visually unrelated treatments. `roster.astro`
renders it full-width, uppercase, gold, `0.78rem`, no affordance; `loot-history.astro` and
`death-analysis.astro` render it `font: inherit` with an up/down indicator via `::after`. Same
interaction, same page family, different product.

- [ ] Build one `.data-table` in the shared stylesheet — padding, dividers, sticky header, hover,
      optional `.data-table--zebra` and `.data-table--compact`
- [ ] Build one `.sort-btn` with the sort-direction affordance (it's the better of the two — the
      roster variant gives no indication the column is sortable at all)
- [ ] Consolidate `.table-wrap` (8 copies, and these mostly already agree — cheap win, do it first)
- [ ] Decide the horizontal-overflow story. `min-width` is set per table at 860px, 980px, `58rem`
      — under one wrapper these should share a rule
- [ ] Migrate: `roster` -> `raiders` -> `gear-summary` -> `loot-history` -> `death-analysis` ->
      `professions` -> `admin/log-matching` -> `admin/roster-teams` -> `signup` ->
      `raid-composition` -> `raiders/[charId]` -> `RaiderSimTools`
- [ ] `RaiderSimTools.astro` has the most table CSS (15 rules) **and** builds rows via `innerHTML`
      — it needs global classes rather than scoped ones, so do it last, and don't disturb the
      `esc()` escaping the security audit signed off on

## D5. Buttons

`.btn` is defined **5 times and no two match**:

| File | Radius | Font size | Padding | Weight | Case |
|---|---|---|---|---|---|
| `admin/mains.astro:1148` | `.4rem` | `.85rem` | `.3rem .7rem` | 600 | normal |
| `admin/raid-signups.astro:919` | `.3rem` | `.82rem` | `.35rem .65rem` | — | **UPPER** |
| `admin/raiding.astro:405` | `.4rem` | `.88rem` | `.42rem .9rem` | 600 | normal |
| `admin/roster-teams.astro:1370` | `.45rem` | `.85rem` | `.42rem .75rem` | 700 | normal |
| `signup.astro:1790` | `.28rem` | `.74rem` | `.3rem .45rem` | 700 | **UPPER** |

On top of that there are ~25 one-off modifier classes (`btn-sign`, `btn-tentative`, `btn-late`,
`btn-note`, `btn-mini`, `btn-subtle`, `btn-compact`, `btn-set-main`, ...), and `loot-history` and
`raiding` define `.btn` too without a matching base.

- [ ] One `.btn` base + variants `--primary` / `--secondary` / `--danger` / `--subtle` and sizes
      `--sm` / `--lg`. `btn-primary` (16x), `btn-danger` (5x) and `btn-sm` (6x) already suggest the shape
- [ ] Audit the ~25 one-offs — most are a base variant plus a semantic color and should collapse
- [ ] Keep genuinely meaningful ones (`btn-sign` / `btn-tentative` / `btn-late` encode signup
      state and carry their own green/amber/red) but drive them off the D1 state tokens
- [ ] Decide uppercase-or-not once and apply it everywhere (currently 2 of 5 files)
- [ ] Include `:disabled` in the base. `raid-composition` server-renders controls `disabled` for
      non-officers, so this state is load-bearing, not decorative

## D6. Cards and panels

**~30 distinct `*-card` class names across 23 files** — `resource-card`, `podium-card`,
`link-card`, `feed-card`, `overview-card`, `summary-card`, `spec-card`, `profile-card`,
`item-card`, `char-card`, `article-card`, `stat-card`, `spotlight-card`, `team-card`, `story-card`,
`raid-card`, `app-card`, `prompt-card`, `feedback-card`, `notfound-card`, `vault-option-card`,
`role-strip-card` ... Each re-specifies border, background, radius, padding and shadow, which is
where most of the **186 distinct dark surface fills** come from.

`SectionCard.astro` is the closest thing to a real card component and it's used twice, on one page.
It's also not token-driven — it hardcodes `rgba(214, 176, 106, 0.38)`, `rgba(10, 20, 30, 0.78)`,
`#d6b06a`, `#e4c27a`, `#d8e1e7`, `0.7rem`.

- [ ] Define one `.card` / `.panel` surface in the shared stylesheet, plus the variants that turn
      out to be real (`--flush`, `--interactive`, `--accent`)
- [ ] Decide whether the gold top-edge gradient (`SectionCard.astro`'s `::before`) is the house
      card style or a one-page flourish
- [ ] Rewrite `SectionCard.astro` on the tokens and widen its use, **or** retire it in favour of
      the plain class — two usages doesn't justify a component
- [ ] Work through the 23 files, mapping each `*-card` onto the shared surface; keep only the
      genuinely page-specific parts (grid placement, class coloring)
- [ ] `admin/*` pages use a warmer panel (`rgba(30,14,4,.6)`, `AdminLayout.astro:90`) than the
      public site's blue-grey — confirm that's intentional before flattening it

## D7. Page chrome

`.page-header` is defined in **10 files**, `.empty-state` in **12**. Both should be identical
everywhere and neither is.

`.page-header`: `admin/applications` and `admin/feedback` make it a plain block with
`margin-bottom` (1.5rem vs 1.2rem) and an `h1` at `1.6rem`; the other eight make it a
`display: flex` / `space-between` / `flex-wrap` row with the `h1` at a different size again.

`.empty-state`: **6 different colors** across 12 definitions — `#7a96a8` (applications, feedback),
`var(--muted)` (raid-signups, raiding, roster-teams, articles, death-analysis, profile), `#aea99f`
(raid-composition), inherit (mains); `font-style: italic` on 7 of 12; `margin: 0` on some,
`margin: .75rem 0 0` on one, unset on others.

- [ ] One `.page-header` (flex row with optional actions slot — the majority shape) + `.page-desc`
- [ ] One `.empty-state`. Pick `var(--muted)`, italic, `margin: 0` and delete the other 11
- [ ] Consolidate `.pill` (3 files) and `.chip` — `raid-composition`'s raider chips and
      `death-analysis`'s `.cd-chip` are the same object and are both already `:global`
- [ ] Consider a `PageHeader.astro` component rather than a bare class, since the markup
      (`h1` + `.page-desc` + actions) repeats as reliably as the styling does

## D8. Focus states — the one accessibility item in this pass

**18 of 36** files containing interactive elements define any `:focus-visible` style. The other
half rely on the UA default outline, which against this dark background is close to invisible on
the custom-styled buttons and chips.

This overlaps the security audit's "accessibility baseline is reasonable" note — that was counting
files that *have* the rule, not coverage of elements that need one.

- [ ] Define `--focus-ring` in D1 and apply a global `:focus-visible` in the base stylesheet so
      every interactive element is covered by default
- [ ] Audit the 18 files that already set one and reconcile them to the shared treatment
- [ ] Check contrast of the ring against both the blue-grey public panels and the warmer admin ones
- [ ] Verify by tabbing through `signup`, `raid-composition` and `admin/roster-teams` — the three
      densest interactive pages

---

## Sequencing

Each tranche is independently shippable. **1 and 2 are pure addition** — nothing changes visually
until a page opts in — so they can land immediately and low-risk.

| Tranche | Contents | Effort | Visual risk |
|---|---|---|---|
| 1 | D1 tokens into `Layout.astro:287`'s `:root` | S | None (additive) |
| 2 | `src/styles/` + import from `Layout.astro`; base/reset, type scale, global `:focus-visible` (D2, D8) | M | Low — bare `h1`s change size, by design |
| 3 | Primitives written but not yet adopted: `.data-table`, `.btn`, `.card`, `.empty-state`, `.page-header` | M | None (nothing references them yet) |
| 4 | Migrate the primitives page by page (D4–D7) | **L** | Per-page, contained |
| 5 | Snap spacing/radius/breakpoints (D3) and delete the dead local CSS | M | Low, but broad |
| 6 | Guardrail script + docs | S | None |

Tranche 4 is the bulk of the work and the only part that genuinely needs a day-or-more. Suggested
page order — cheapest and most-visited first, so the system gets exercised before it hits the
hard pages:

`404` / `privacy` / `hiatus` -> `articles` / `links` / `feedback` -> `leadership` / `professions` /
`trinkets` -> `admin/*` (they share the most structure) -> `roster` / `raiders` /
`gear-summary` -> `loot-history` / `death-analysis` / `mechanics-analysis` -> `index` / `lore` ->
`upgrades` / `profile` -> `signup` -> `raiders/[charId]` -> `raid-composition` -> `RaiderSimTools`.

The last four are ~5,400 lines of CSS between them and each deserves its own session.

## Verification

There are no tests and no visual regression tooling, so **the only safety net is looking at the
page**. That's the real argument for migrating one page per commit.

- [ ] Screenshot each page before and after its migration commit (`npm run dev`, or the `/run` skill)
- [ ] `npm run typecheck` after each tranche — `astro check` reports unused-selector hints, which is
      genuinely useful here for finding local CSS left behind after a migration. AGENTS.md notes the
      repo is at 0 errors / 0 warnings; keep it there
- [ ] Check the built CSS shrinks. Baseline today: **276 KB across 23 files** in `dist/_astro/`.
      If tranche 4 isn't reducing it, local CSS is being left behind rather than deleted
- [ ] Re-check the responsive behaviour the last two releases were specifically about — v2.27.2
      fixed header nav crowding at iPad portrait widths, and the nav breakpoints (900/1200/1310px)
      are load-bearing. Don't fold them into the D3 breakpoint consolidation without testing
- [ ] Check logged-out, guild-member, officer and admin views — large parts of the UI only render
      for one of them
- [ ] Verify the client-rendered surfaces specifically (`raid-composition` chips,
      `death-analysis` cooldown chips, `RaiderSimTools` tables). These build markup in JS, so a
      class rename breaks them silently with no build error

## Guardrails

Without one, this regresses to 807 literals within a few features.

- [ ] Add an `npm run lint:css` script — grep-based is enough — that fails on a raw
      `rgba(214, 176, 106, ...)`, a `font-size` off the scale, or a new `.btn`/`.empty-state`/
      `.page-header` definition outside `src/styles/`
- [ ] Document the system in `AGENTS.md` — where the tokens live, where the shared stylesheet
      lives, the Astro scoping constraint from the top of this section, and "use the primitive,
      don't redefine it"
- [ ] Note it in `README.md` and the Vault Hidden Lodge notes per the usual docs-upkeep rule

## Decisions — settled 2026-09-20

Taken as recommended. Revisitable, but the plan above assumes all four; changing one means
re-reading the tranche it affects.

1. **Snap to scale.** ~60 font sizes collapse to ~8 steps and ~45 gaps to a single space scale,
   accepting that values shift by a pixel or two site-wide. Some of those shifts *will* be visible
   in dense tables (`roster`, `raiders`, `loot-history`) — that's expected, not a regression to
   chase. The rejected alternative, a token per existing value, is a rename rather than a system.
   **Affects D2, D3.** The practical consequence: screenshot diffs in tranche 5 will be noisy
   everywhere, so don't use "did anything move?" as the check — use "does it still read cleanly
   at the same breakpoints?"
2. **Admin keeps its warmer palette**, but expressed as a token override, not literals. The
   brown-tint (`AdminLayout.astro:90`) is a useful "you are in the admin area" signal and stays.
   **Affects D1, D6.** Implementation: the semantic surface/border tokens get redefined on the
   `.admin-wrapper` scope rather than each admin page hardcoding warm values — so admin pages use
   the same `.card` / `.data-table` primitives as everywhere else and inherit the tint for free.
   This is the one place the token layer needs to support scoped overrides, so design D1's surface
   ladder with that in mind from the start.
3. **Classes, not components** — for tables, buttons and cards. They migrate incrementally and, in
   particular, they work for the three pages that build rows in JS (`RaiderSimTools`,
   `raid-composition`, `death-analysis`), which a component cannot help.
   **Affects D4, D5, D6, D7.** The single exception is `PageHeader.astro` in D7, where the markup
   (`h1` + `.page-desc` + actions) repeats as reliably as the styling does — that one is worth a
   component. `SectionCard.astro` goes the other way and retires in favour of the plain `.card`
   class; two usages don't justify keeping it.
4. **`raid-composition` and `RaiderSimTools` go last**, and only after confirming neither has
   active feature work in flight. ~1,600 lines of CSS and 71 `:global()` escapes between them, and
   v2.25–v2.27 all touched `raid-composition`. **Affects the tranche 4 page order** (already
   written that way). Note the upside of deferring: by the time they're reached, the primitives
   will have been exercised on ~20 simpler pages, and their `:global()` rules mostly *become* the
   shared stylesheet rather than needing to be rewritten against it.

### What this unblocks

Tranches 1–3 are now fully specified and additive — nothing renders differently until a page opts
in. Tranche 1 (D1 tokens into `Layout.astro:287`) is the S-effort, zero-risk starting point.

---
---

