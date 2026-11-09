# Decision log — 2026-11-09 (founder decisions, global exposure)

## Provenance
On 2026-11-09 the founder decided the items below and the orchestrating session relayed them to the
implementation lane that carries this file (branch `codex/global-exposure-20261109`). They are the
founder's own decisions, not delegated ones. A reversal is a new entry in a later log.

## Decisions
| id | decision | where it is implemented |
|---|---|---|
| GX-01 | **AI crawlers may read the public marketing pages.** GPTBot, Google-Extended, anthropic-ai, ClaudeBot, Claude-SearchBot, CCBot, Applebot-Extended and Meta-ExternalAgent are allowed, with the same private-path list the search crawlers have. **Bytespider stays disallowed everywhere.** Reverses FD-61's training block for every token it named except Bytespider; SD-05's ClaudeBot placement is unchanged. | `nextjs/app/robots.ts`, `nextjs/public/llms.txt`, `docs/policy/CRAWLER_POLICY.md`, pinned by `nextjs/lib/seo-surface.test.ts` |
| GX-02 | **Global-only presentation.** The site is presented in English. Korean readers use browser translation. The footer language switch is removed, every `/ko` URL answers 308 with its English equivalent, `/ko` leaves the sitemap and `llms.txt`, and pages keep a self-canonical with no hreflang alternates. The Korean-document specimen cell leaves Home; its receipt stays committed and verified. The `app/ko` sources stay in the tree, unreachable, until a separate change deletes them. | `nextjs/next.config.mjs` (redirects), `nextjs/app/sitemap.ts`, `nextjs/lib/specimen-sources.ts` (`HOME_SPECIMEN_SLOTS`) |
| GX-03 | **Cookieless Vercel Web Analytics page views.** Page views on public marketing pages are counted without a cookie and without waiting for a choice, and stop when a visitor declines analytics. Interaction events and Google Analytics keep the existing opt-in. The consent banner is unchanged. Still behind `NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED`, which stays unset until Web Analytics is switched on for the Vercel project. | `nextjs/components/marketing-consent.tsx`, `nextjs/components/vercel-collector.tsx`, `/privacy` cookie table row |
| GX-04 | **IndexNow and search-result titles** (Bing Webmaster recommendations). A public IndexNow key is served at `/<key>.txt` and `nextjs/scripts/indexnow-ping.mjs` submits the live sitemap by hand after a production deploy. Titles and descriptions of the public marketing pages are brought to Bing's recommended lengths using only what each page already says. | `nextjs/public/7a0ff86c91c02b35a358cdf2761b2512.txt`, `nextjs/scripts/indexnow-ping.mjs` (`nextjs/lib/indexnow.test.ts`), `nextjs/lib/seo-title-lengths.test.ts`, runbook `docs/runbooks/RELEASE_ORDER.md` |
