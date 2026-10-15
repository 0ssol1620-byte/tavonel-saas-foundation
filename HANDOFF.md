# HANDOFF — film lane (Release 2, 2026-10-15)

Branch `codex/hr-film-20261015`, fast-forwarded to `codex/home-redesign-20261015` 9a52e48 before work.

## Nothing required outside this lane

No edit outside the owned files is needed for these changes to work. The tab-row change is a class
(`readingStyles.tabs`) the player adds only when `storyLayout` is set, styled in
`components/landing-v2/film-reading-layer.module.css` (unlayered, `@media (min-width: 900px)`), so it
outranks the layered `.compile-film-stages` grid in `app/tavonel.css` without touching that file.
`app/ux-polish.css` no longer exists (folded into `app/tavonel.css`); no `.compile-film-*` rule there
was changed.

## e2e — no existing spec breaks; suggested additions (not written, e2e/ is not this lane's)

No spec selects on the old reading strings ("Site visit notes", "Look for", "패널에서 볼 것") or on
`data-mobile-focus-pane`. Suggested assertions for `e2e/hero-home-responsive.spec.ts`, inside the
existing per-width loop after `geometry` is read:

```ts
if (width >= 900) {
  // Compact left-aligned tab group: labels start at the container's left and sit 32-40px apart.
  const rects = geometry.tabs.map(tab => tab.rect);
  for (let i = 1; i < rects.length; i++) {
    const gap = rects[i]!.left - rects[i - 1]!.right;
    expect(gap).toBeGreaterThanOrEqual(32);
    expect(gap).toBeLessThanOrEqual(40);
  }
  for (const rect of rects) expect(rect.width).toBeGreaterThanOrEqual(44);
}
// Reading line under the film, >= 15px, at every width and under reduced motion.
const reading = film.locator("[data-film-reading] p");
await expect(reading).toBeVisible();
expect(parseFloat(await reading.evaluate(node => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);
```

and repeat the last three lines after the existing `page.emulateMedia({ reducedMotion: "reduce" })`
+ `page.reload()` in the same test.

## For the integrator's visual QA (not run in the lane: no next dev/build allowed)

- 1440: tab row reads "Files  Organize  Updates  Use with AI" left-aligned, ~36px apart, cobalt
  underline only under the active label; caption sits under it.
- 390/1440 reduced motion: poster, then the pane strip and the reading line under it; caption above.
- The pane strip is now Wanted Sans 13px (was mono 12px); "CHANGED" / "nodes lit" quotes are sans
  600, "WORKING COPY.md" / "# Payment terms" stay mono.

## Founder items (not decided here)

Poster Tier 1 candidates: `outputs/tavonel-research-replan-20261013/resume-20261015/redesign-r2-20261015/poster-candidates/CANDIDATES.md`
(ai-knowledge-compiler). Stage 1 has no overprint-free frame in the sampled pool.
