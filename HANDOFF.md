# HANDOFF — hero lane, Release 2 (codex/hr-hero-20261015)

Everything below is outside this lane's files. Each item gives the exact change.

## 1. Korean H1 differs from the orchestrator's string — decision needed

The brief said use exactly `AI가 믿고 쓰는 지식.`. That string fails
`lib/landing-v2-page.test.ts > writes /ko with the site's own Korean spellings`, because
`lib/ko-terms.ts` (`KO_AMBIGUOUS`, decision D12 / BQ-116) bars `쓰는 지식`: 쓰다 means both
"use" and "write", so the headline also reads as "knowledge the AI writes". The lane shipped
**`AI가 믿고 사용하는 지식.`** (D12's own `instead`). The measurement harness shows 2 lines at
360/390/412 and 1 line at 1440, in both chromium and webkit.

To use the original string anyway, delete the `쓰는 지식` entry from `KO_AMBIGUOUS` in
`lib/ko-terms.ts` and fix `lib/ko-terms.test.ts:46`. Then change `headline:` under `ko:` in
`components/landing-v2/landing-page.tsx` and line 274 of `lib/landing-v2-page.test.ts`. Making
that call belongs to the founder or the orchestrator, not to this lane.

## 2. e2e asserts on the old H1

- `e2e/evidence-first.spec.ts:29` → `.toContainText("Knowledge your AI can trust.")`
- `e2e/evidence-first.spec.ts:104` → `.toContainText("AI가 믿고 사용하는 지식.")`
- `e2e/landing-v2.spec.ts:145` → `.toBe("Knowledge your AI can trust.")`

Metadata title/description did not repeat the old H1, so they are unchanged.

## 3. Consent prompt copy (EN only) — needed for the ≤96px phone card at 360

`lib/marketing-analytics.ts`, `CONSENT_COPY_EN.prompt`:

```ts
  prompt: "Google Analytics cookies measure visits and clicks on public pages, never workspace content.",
```

Measured with the scratch harness (Wanted Sans from `public/fonts`, the lane's phone CSS, both
engines):

| Copy | 360 | 390 | 412 |
| --- | --- | --- | --- |
| Current EN | 110.8 px | 95.2 px | 95.2 px |
| Proposed EN | 95.2 px | 95.2 px | 95.2 px |
| Current KO, unchanged | 95.2 px | 95.2 px | 95.2 px |

The proposed sentence keeps all four facts: vendor, cookies, what is measured, and what is
excluded. `lib/marketing-analytics.test.ts` pins only the Korean sentence, so it passes either
way. Also update the comment above `CONSENT_COPY_EN`: its "56px bar … three 11px lines" text is
out of date.

## 4. `e2e/marketing-consent.spec.ts` — new assertions (the delayed card is the orchestrator's decision)

The prompt is no longer server-rendered or on the first paint. It appears after the first scroll
past 200px, or 8 s after mount, whichever comes first. It also appears at once when the footer's
Analytics preferences button opens it (`CONSENT_REVEAL` in `components/marketing-consent.tsx`).
GA still loads only after consent.

Add at the top of the file:

```ts
const PANEL = { name: /^(Optional analytics|선택 분석)$/ };
async function revealConsent(page) {
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.getByRole("region", PANEL);
  await expect(panel).toBeVisible();
  return panel;
}
```

Test 1 ("analytics remains optional…"):
- Replace the `serverResponse … toContain('aria-label="Optional analytics"')` assertion with
  `.not.toContain('data-marketing-consent-panel')` (message: "the prompt is not on the first paint").
- (a) After `page.goto("/")`:
  `await page.waitForTimeout(1_500); await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);`
  (scroll is 0 and well under 8 s).
- (b) Then `const panel = await revealConsent(page);`, and keep the existing fixed / inside-viewport / ≤25% /
  `body padding-bottom 0px` assertions. Add:
  `expect(bounds!.y + bounds!.height).toBeGreaterThan(page.viewportSize()!.height - 40);` (at the bottom)
  and, below 900px wide, `expect(bounds!.height).toBeLessThanOrEqual(96);`.
  At 900px and wider, add `expect(bounds!.width).toBeLessThanOrEqual(360); expect(bounds!.x).toBeLessThanOrEqual(24);` (bottom-left).
- Keep the rest unchanged: refusal, reload, `toHaveCount(0)`, the footer button, `googleRequests` equal to
  `[]`, and the footer reopen showing the panel at once without a scroll.

Test 2 ("never covers homepage or pricing actions"):
- (d) For `/`: at scroll 0, before 8 s, assert
  `await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0)` and that
  `#s1 h1`, `#s1 .lv2-hero-support` and `#s1 a[href="/explore"]` are visible. Nothing can intersect them,
  because the card is absent.
- (e) For `/pricing`: delete the `.plan-action a` intersection assertion. Then `revealConsent(page)`
  and assert the card's bottom is greater than `viewport height - 40`. Keep the scroll-to-1000
  "stays at the viewport bottom" and stuck-header checks for both routes. Call `revealConsent`
  on `/` before them.

Test 3 (Escape): insert `await revealConsent(page);` after `goto("/")`. Everything else is unchanged (c).

Test 4 (consented measurement): insert `await page.evaluate(() => window.scrollTo(0, 300));` before
`expect(... "Allow analytics").toBeVisible()`. The rest is unchanged.

Test 5 (lead event, `page.clock.install()`): before the "No thanks" click, insert
`await page.evaluate(() => window.scrollTo(0, 300));`. A scroll is more reliable here than
`clock.fastForward(8_000)`.

Test 6 (Korean): insert `await revealConsent(page);` after `goto("/ko")`.

Brief move 6's acceptance line "the card is the first interactive element in Tab order" no longer
applies. The card still mounts first in the DOM, but it appears after the reader has started
reading.

## 5. Other e2e specs that expect the card at once

These specs wait for the card right after `goto` (5 s default expect timeout, 8 s reveal), so they
will time out or measure without it. For each, replace the immediate visibility wait with a scroll
of 300px, then wait for the card, then scroll back to 0 where first-screen geometry is measured:

- `e2e/hero-home-responsive.spec.ts:8, :27`
- `e2e/compiler-contract.spec.ts:264-267`
- `e2e/premium-craft.spec.ts:3-10` (`dismissConsent`) and `:154-155`. In the `consentVisible`
  loop, the "banner clears title and action" check now runs only after a scroll, so measure it
  after `scrollTo(0, 300)` or drop it.
- `e2e/hero-four-stage-restoration.spec.ts:5` (`dismissConsent`)
- `e2e/public-package-proof.spec.ts:28-31`
- `e2e/dialog-focus-audit.spec.ts:38`, `e2e/explore-guided-entry.spec.ts:35`,
  `e2e/failure-states-audit.spec.ts:164`. These use `if visible then click`, which now does
  nothing. The card can then appear 8 s into a long test and cover a target. For specs that are
  not about consent, seed a refusal:
  `await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));`

## 6. Footer at ≤480px — conflict with the footer height budget

The phone footer is now a real 2-column grid. Each group is one column of links under its
heading, so headings in a row share a top edge. Legal keeps one row of three. The legal row is a
2-column grid with no dots, and separators are separate `aria-hidden` spans that sit only between
items. This is taller than the old 2×2 sub-grid. From the R1 390 capture (footer ≈ 758px):
group rows 7 + 5 + 1 links × 44px plus headings ≈ 670px against ≈ 510px before, so the footer is
**≈ 900–950px at 390×844**. `e2e/public-layout-balance.spec.ts:137` (`footerHeight < 0.9 ×
viewport` = 760px) will fail at 390 and 360. This number is an estimate, not measured on the real
build. The options, which are the orchestrator's call:
- (a) Keep the grid and re-derive the budget from a fresh measurement, e.g. `toBeLessThan(viewport × 1.2)`,
  and record it as a deliberate layout change, not a raise to make the test pass.
- (b) Keep the budget. Change `public-site-chrome.module.css`'s ≤480 block to make each group
  span both columns with links in a uniform 2-column sub-grid (171px cells fit every label). That
  measures taller still (13 link rows), so the budget would still need (a).
- (c) Revert the ≤480 block to the R1 sub-grid. This drops critic item "390 footer ragged".

Line 135 (`columns === 2`), the overlap checks and the 44px link heights still hold.

## 7. Header CTA on /explore

`/explore` renders its own header (`components/explore/explore-stage.tsx`), not
`PublicSiteHeader`, so the filled header CTA was never on that route. `/ko/explore` is a 404,
and the 404 page's CTA points at `/explore`, not at itself. The header CTA is now `HeaderCta`
(client, `usePathname`) and returns nothing when the path is `/explore` or `/ko/explore`, as a
guard. If the critic saw a self-link on /explore, it was the explore stage's own exit links
(`EXIT_LINKS`), which belong to another lane. Suggested e2e:
`await page.goto("/pricing"); await expect(page.locator('header.nav .nav-actions a.btn')).toHaveAttribute("href", "/explore");`

## 8. Mobile Menu control

The control is a borderless 44×44 icon with three CSS lines that cross when open, at every width
below 1250px. "Menu"/"메뉴" stays as the accessible name in a visually hidden span. Focus is a
2px `#244ac8` ring. `e2e/launch-qa-mobile-nav.spec.ts:114` (`outline-width 2px`) and
`e2e/mobile-landing.spec.ts` (wordmark left of menu) need no change. No spec asserts the visible
word "Menu".
