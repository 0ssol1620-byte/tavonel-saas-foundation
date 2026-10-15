# HANDOFF — hero lane (codex/hr-hero-20261015)

Changes this lane needs in files it does not own. Each item names the owner, the exact text to
remove and the exact text to put in its place. Paths are relative to `nextjs/`.

## 1. Layout lane — `components/landing-v2/source-first-home.module.css` (REQUIRED with this lane)

The consent notice is no longer a document-flow band above the header; it is a bottom-fixed card
(`components/marketing-consent.module.css`), and the header stays `position: fixed` while it is
shown. The three compensations below now shrink `#s1`'s top padding under a fixed 56/64px header,
so the H1 would sit under the header on every first visit. Delete them.

Delete line 36:

```css
  :global(body:has([data-marketing-consent-panel])) .home.home > header { margin-bottom: 0 !important; }
```

Delete line 51:

```css
  :global(body:has([data-marketing-consent-panel])) .home.home :global(#s1) { padding-top: 32px; }
```

Delete lines 154–155:

```css
    /* Pending consent puts the header in normal flow: do not reserve its fixed-header space twice. */
    :global(body:has([data-marketing-consent-panel])) .home.home :global(#s1) { padding-top: 24px; }
```

## 2. Layout lane — the hero support sentence (brief move 1, §4.4)

`HeroStatement` now renders `<p class="lv2-hero-support lv2-body-l">` directly after the H1 and
before the actions. Only the global `app/landing-v2.css` rule styles it today (margin `22px auto 0`,
no bottom margin), so on Home it touches the action row. Add inside the `@layer overrides { … }`
block, right after the `.home.home :global(.lv2-hero-h1) { … }` rule (line ~54–57):

```css
  .home.home :global(.lv2-hero-support) { max-width: 40ch; margin: 0 auto 28px; color: var(--home-muted); font: 400 20px/1.55 var(--f-sans); text-wrap: balance; }
  .home[lang="ko"].home :global(.lv2-hero-support) { word-break: keep-all; }
```

and inside the existing `@media (max-width: 767px)` block (after the `.lv2-hero-h1` rules, ~line 157):

```css
    .home.home :global(.lv2-hero-support) { font-size: 18px; line-height: 1.6; margin-bottom: 24px; }
```

## 3. Integrator — two unit tests pinned the old hero/close (not this lane's files)

`lib/landing-v2-page.test.ts` (4 failures) and `lib/landing-v2-start.test.ts` (4 failures) assert
the hidden support line and the old EN/KO close pair. The patch below was applied in this worktree,
both files passed (106/106), and the files were restored. Apply it with `git apply` from the repo root.

```diff
diff --git a/nextjs/lib/landing-v2-page.test.ts b/nextjs/lib/landing-v2-page.test.ts
--- a/nextjs/lib/landing-v2-page.test.ts
+++ b/nextjs/lib/landing-v2-page.test.ts
@@ -576,7 +576,11 @@ describe("landing v2 -- the lead and the workbench", () => {
     const actionsAt = hero.indexOf('data-testid="landing-hero-actions"');
     expect(actionsAt).toBeGreaterThan(hero.indexOf('</h1>'));
     expect(filmAt).toBeGreaterThan(actionsAt);
-    expect(hero).not.toContain('class="lv2-hero-support lv2-body-l"');
+    // Brief 2026-10-15 move 1: the one support sentence sits between the H1 and the actions.
+    const supportAt = hero.indexOf('class="lv2-hero-support lv2-body-l"');
+    expect(supportAt).toBeGreaterThan(hero.indexOf('</h1>'));
+    expect(supportAt).toBeLessThan(actionsAt);
+    expect(readable(hero)).toContain(locale === "ko" ? "원문에서, 사람과 AI가 사용하는 지식으로." : "Your sources, connected for people and AI.");
     expect(hero).toContain("/film/poster-1-hero-2x.webp");
     expect(elements(hero, "button").filter(open => attr(open, "role") === "tab")).toHaveLength(4);
     expect(hero).toContain('data-mobile-view="fit"');
@@ -622,10 +626,9 @@ describe("landing v2 -- hero actions by commercial state", () => {
       expect(secondary).not.toBeNull();
       expect(attr(secondary![0], "href")).toBe(locale === "ko" ? "/ko/evaluation" : "/evaluation");
       expect(readable(secondary![1]!).trim()).toBe(locale === "ko" ? "내 문서 평가 상담" : "Evaluate your documents");
-      // The close is not remapped: Korean keeps the localized contact route, English its price link.
+      // Brief 2026-10-15 move 1: the close fills the hero's public-sample action beside the price link, in both languages.
       const close = elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href"));
-      expect(close).toContain(locale === "ko" ? "/ko/contact" : "/pricing");
-      expect(close).not.toContain(locale === "ko" ? "/ko/evaluation" : "/evaluation");
+      expect(close).toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
     }
   );
 
@@ -643,9 +646,9 @@ describe("landing v2 -- hero actions by commercial state", () => {
         locale === "ko" ? KO_CHROME.cta[SELF_SERVE_CTA.href] : SELF_SERVE_CTA.label
       );
       expect(main).not.toMatch(/href="(?:\/ko)?\/evaluation"/);
-      if (locale === "ko") {
-        expect(elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href"))).toContain(SELF_SERVE_CTA.href);
-      }
+      // The close does not change with commercial posture (brief move 1).
+      expect(elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href")))
+        .toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
     }
   );
 });
diff --git a/nextjs/lib/landing-v2-start.test.ts b/nextjs/lib/landing-v2-start.test.ts
--- a/nextjs/lib/landing-v2-start.test.ts
+++ b/nextjs/lib/landing-v2-start.test.ts
@@ -53,15 +53,15 @@ describe("landing scene 09 -- start", () => {
     expect(html).toContain('tabindex="-1"');
   });
 
-  it.each(LOCALES)("%s offers one next action, the commercial one, as the filled control", (locale) => {
+  it.each(LOCALES)("%s offers one next action, the public sample, as the filled control", (locale) => {
     const html = render(locale);
     expect(html.match(/data-scene-next="start"/g)).toHaveLength(1);
-    // The marked action, the filled button and the destination are one element. Matched on the
-    // whole tag rather than on an attribute order no renderer promises.
+    // Brief 2026-10-15 move 1: the close fills the hero's and header's action, in both languages.
     const tag = html.match(/<a[^>]*data-scene-next="start"[^>]*>/)?.[0] ?? "";
-    expect(tag).toContain(`href="${locale === "ko" ? "/ko/contact" : "/pricing"}"`);
+    expect(tag).toContain(`href="${EXPLORE_CTA.href}"`);
     expect(tag).toContain('class="btn lv2-cta');
-    expect(text(html)).toContain(locale === "ko" ? "이용 문의" : "See pricing");
+    expect(text(html)).toContain(actionsFor(locale).exploreLabel);
+    expect(text(html)).toContain(locale === "ko" ? "요금 보기" : "See pricing");
   });
 
   it.each(LOCALES)("%s names Explore from the constant and never by a retired name", (locale) => {
@@ -75,7 +75,7 @@ describe("landing scene 09 -- start", () => {
   it.each(LOCALES)("%s carries the price line and links only to routes this site publishes", (locale) => {
     const html = render(locale);
     const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
-    expect(hrefs).toEqual(locale === "ko" ? ["/ko/contact", "/ko/pricing"] : ["/pricing", EXPLORE_CTA.href]);
+    expect(hrefs).toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
   });
 
   it.each(LOCALES)("%s keeps deployment detail on Pricing rather than in the closing scene", (locale) => {
```

After this lands, `StartActions.accessLabel/accessHref` (`components/landing-v2/scenes/start.tsx`)
are unused by the scene; drop them together with `actionsFor`'s two fields and `startActions`'
two fields in `landing-page.tsx` (still read by `heroStart`, so keep the `access` resolution).

## 4. Integrator — e2e specs that assert the old chrome (not editable by lanes)

Not run here (no `next build`/`dev` in a lane). Each line below asserts what the brief removes:

- `e2e/hero-home-responsive.spec.ts` (two places): selector
  `#s1 h1 + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]`
  → `#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]`.
- `e2e/marketing-consent.spec.ts` test 1: `toHaveCSS("position", "relative")` → `"fixed"`; replace
  "consent must end before the public header begins" with: panel bottom ≤ viewport height and panel
  height ≤ 25% of viewport height. Test 2: replace the "above the header" and "scrolls away" checks
  with: panel does not intersect `#s1 h1`, `#s1 .lv2-hero-support` or `#s1 a[href="/explore"]` at
  1440/390/360, and after `scrollTo(0, 1000)` the panel is still at the viewport bottom. Add: Escape
  inside the panel closes it and stores a refusal; GA request count stays 0.
- Header Pricing below 1250px moved into the sheet (`a.mobile-nav-direct[href="/pricing"]`, last
  section row, `/ko/pricing` on Korean pages); `.nav-actions` is `display:none` below 1250px:
  `e2e/mobile-landing.spec.ts` 59–66 (row geometry now wordmark + Menu only), 76–83 (`direct`
  count 4 → 5 with "Pricing" last; header pricing count assertions go), 117 (click the sheet row);
  `e2e/production-hardening.spec.ts` 31–36 (same); `e2e/site-nav.spec.ts` 226, 236 (390 cases:
  sheet row); `e2e/site-chrome-v2.spec.ts` 198 (390: sheet row).
- `e2e/site-chrome-v2.spec.ts` 70–99: "filled controls in the bar" `toHaveLength(0)` → exactly one,
  with text "Explore the public sample" (brief move 1 asks for the filled header CTA). Pricing's
  computed `font-weight` is now 400.
- `e2e/landing-v2.spec.ts` 117, 149–158, 167–171: `#s6 [data-scene-next="start"]` now points at
  `/explore` (both languages); the Korean close no longer goes to `/ko/contact` or `/login`. The
  "요금 보기 → /ko/pricing" assertion still holds. `/explore` matches `^\/[a-z]` and is not `/ko`.
- `e2e/launch-qa-mobile-nav.spec.ts` 55 still passes (`nav-actions` is still in the HTML).

## 5. Film lane — `components/compile-stage-player.tsx` ~160 (brief move 6)

KO label "전체 화면 보기" → "전체 프레임 보기" (matches Fit's meaning; ledger minor). Not done here.

## 6. Notes

- The header CTA renders on every public page through `PublicSiteHeader`, including `/explore`,
  where it links to the page itself. If that should be suppressed there, the header needs a prop.
- `pnpm exec tsc --noEmit` reports two errors that predate this lane:
  `app/api/internal/{cdr/identity,probe}/route.ts` cannot resolve `@vercel/functions/oidc`; the
  shared `node_modules` junction target (`uskc-lanes/site-rc`) has no `@vercel/functions`,
  which `package.json` declares at 3.9.7. The integrator's tree should have it.
