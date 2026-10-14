# Reconciled backlog

Reconciled 2026-10-11 against source, the empty local TODO, the recovered September security/SEO/accessibility and design audits, the existing design-system plan, the Vault technical note, and all existing GitHub issues (all prior issues were closed). GitHub issues own live task status; this file records the audit disposition and index.

P1 = high impact; P2 = normal; P3 = lower priority/deferred. No evidence supported a P0 emergency. The prior audit was static source review, not a live penetration test or accessibility certification.

## Open work

| ID | Category | Priority | Issue |
| --- | --- | --- | --- |
| S1 | security | P1 | [Remove session IDs from popup JavaScript and preserve HttpOnly cookies](https://github.com/jmusick/hidden-lodge-website/issues/16) |
| S2 | security | P1 | [Apply baseline security headers to SSR, API, and static responses](https://github.com/jmusick/hidden-lodge-website/issues/17) |
| S3 | security | P2 | [Roll out nonce-based Content Security Policy with useful reports](https://github.com/jmusick/hidden-lodge-website/issues/18) |
| S4 | security | P2 | [Replace rich-text regex sanitization with an HTML allowlist](https://github.com/jmusick/hidden-lodge-website/issues/19) |
| S5 | security | P2 | [Make admin API authorization fail closed without breaking officer routes](https://github.com/jmusick/hidden-lodge-website/issues/20) |
| A1 | accessibility | P2 | [Add a working skip-to-content link for public and admin pages](https://github.com/jmusick/hidden-lodge-website/issues/21) |
| E1 | seo | P3 | [Generate a sitemap with real timestamps and shared indexing exclusions](https://github.com/jmusick/hidden-lodge-website/issues/22) |
| C1 | maintenance | P3 | [Retire unused admin API stubs and duplicate Blizzard callback](https://github.com/jmusick/hidden-lodge-website/issues/23) |
| D4 | design-system | P2 | [Finish page migration to shared design primitives and focus treatment](https://github.com/jmusick/hidden-lodge-website/issues/24) |
| D5 | design-system | P3 | [Finish spacing, typography, and radius scale adoption](https://github.com/jmusick/hidden-lodge-website/issues/25) |
| D6 | design-system | P3 | [Add a CSS guardrail and document completed design-system adoption](https://github.com/jmusick/hidden-lodge-website/issues/26) |
| F1 | enhancement (deferred) | P3 | [Plan Discord raid signups after restoring the website signup workflow](https://github.com/jmusick/hidden-lodge-website/issues/27) |

## Completed or superseded

- Homepage heading (audit item 4): completed; src/pages/index.astro has a single sr-only h1. No issue recreated.
- Design tokens, type/space/radius scales, shared base styles, focus ring, and component primitives (tranches 1–3): implemented. D4/D5 cover remaining adoption and verification, not recreating these foundations.
- Design tranche 4: partial, not unstarted; parse-analysis/group-size views, article cards, 404, feedback and shared history components already reference primitives. A page inventory belongs to D4.
- Global focus ring exists; remaining local override/contrast/keyboard review is merged into D4. Skip navigation stays separate as A1.
- Design audit breakpoint consolidation: superseded by the settled DESIGN-SYSTEM.md decision to preserve nav breakpoints.
- Pull Score/Parse Analysis plan: shipped and later revised to WCL bracketPercent on kills only. Current README, AGENTS and code own the formula; the original relative-to-role-median scoring plan is obsolete. No implementation issues recreated.
- Companion API/Season 2 loot allowlist audit: the tracked raid allowlist fix shipped. Updating that allowlist for a future season remains an operational convention in AGENTS, not an unresolved past bug.
- Hosting rename and native cron: complete; cron-job.org jobs retired 2026-10-13. See [deployment.md](deployment.md) for cutover and native cron evidence.

## Source records

- [Recovered September audits](audits/2026-09-source-review.md) — historical findings, line numbers and unchecked boxes do not represent current status.
- [Settled design-system spec](../DESIGN-SYSTEM.md) — wins over the earlier design audit where decisions differ.
- [Deferred Discord plan](plans/discord-raid-signups.md) — one planning epic, no duplicate issue per paragraph.
- [Operations history moved from Obsidian](operations-history.md) — dated history, not current deployment instructions.
- [TODO entrypoint](../TODO.md) — points here instead of maintaining another work list.
