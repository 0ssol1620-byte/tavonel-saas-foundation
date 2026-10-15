# HANDOFF -- layout lane, Home redesign Release 2 (2026-10-15)

Branch `codex/hr-layout-20261015`. Everything below is outside this lane's files and needs the
owner (or the integrator) to apply it. Each item gives the exact replacement.

## 1. WebKit weight (blocker 4): mount the font outline probe -- app/layout.tsx owner

Root cause (receipt: `outputs/tavonel-research-replan-20261013/resume-20261015/redesign-r2-20261015/webkit-weight/WEIGHT-PROOF.json`):
Playwright WebKit on Windows applies Wanted Sans Variable's wght axis to advances but draws every
outline at the 400 default, so every 560/600 on Home renders as 400 there. The @font-face blocks
are correct (`font-weight: 400 1000`, loaded, no fallback winning). Safari on Apple hardware was
not available to this lane and is not claimed either way.

The CSS half is committed (`components/landing-v2/source-first-home.module.css`, block between
`WEIGHT-HOOK-START` and `WEIGHT-HOOK-END`): under `html[data-static-wght="1"]` it adds a
`-webkit-text-stroke` equal to this font's stem difference (0.038em for 600, 0.03em for 560).
Nothing sets that attribute until this probe is mounted.

New file `nextjs/components/font-outline-probe.tsx`:

```tsx
"use client";
import { useEffect } from "react";

/*
  Sets html[data-static-wght="1"] only where the engine does not draw the wght axis of Wanted Sans
  Variable (measured: Playwright WebKit on Windows). It draws one glyph at 400 and at 1000 and
  compares the ink; where the axis draws, 1000 has far more ink and nothing is set.
  The CSS that reads the flag is the WEIGHT-HOOK block in source-first-home.module.css.
*/
export default function FontOutlineProbe() {
  useEffect(() => {
    const family = '"Wanted Sans Variable"';
    let live = true;
    Promise.all([document.fonts.load(`400 48px ${family}`), document.fonts.load(`1000 48px ${family}`)]).then(([a, b]) => {
      if (!live || !a.length || !b.length) return; // face absent: the fallback has real bold cuts
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      const ink = (weight: number) => {
        context.clearRect(0, 0, 64, 64);
        context.font = `${weight} 48px ${family}`;
        context.fillText("l", 24, 52);
        const data = context.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum;
      };
      if (ink(1000) < ink(400) * 1.3) document.documentElement.dataset.staticWght = "1";
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return null;
}
```

`nextjs/app/layout.tsx`: add `import FontOutlineProbe from "@/components/font-outline-probe";`
beside the `MarketingConsent` import, and render `<FontOutlineProbe />` as the first child of
`<body>` (before `<SkipLink />`). It renders nothing, needs no inline script (CSP unchanged) and
adds no dependency.

Proof that this exact logic flags WebKit and leaves Chromium alone: `webkit-weight/static-proof/`
and `webkit-weight/static-home/` (static pages, same font files; no Next build in a lane).

## 2. s3 right column shows only "Read the record" -- components/landing-v2/landing-page.tsx owner

The column's content (notes, method, rights) is folded behind one summary. Print it. Replace

```tsx
              <details className={heroStyles.receiveNotes}>
                <summary>{korean ? "기록 읽기" : "Read the record"}</summary>
                <ul className={heroStyles.noteList}>
```

with

```tsx
              <div className={heroStyles.receiveNotes}>
                <ul className={heroStyles.noteList}>
```

and the matching close, directly after `<p className={heroStyles.rights}>{page.receive.rights}</p>`,

```tsx
              </details>
```

with

```tsx
              </div>
```

The CSS is already in place (`landing-hero.module.css`: `.noteList` rows on 1px `--home-rule`,
`.method` is a ruled block, no stone fill). No test or e2e spec references "Read the record" /
"기록 읽기". Suggested pin for `lib/landing-v2-page.test.ts` ("Home substance renders expanded"):
`expect(scene("s3", 'id="lv2-recompile-title"')).not.toContain("<summary>Read the record</summary>")`
-- or, simpler, `expect(html).not.toMatch(/<summary>(Read the record|기록 읽기)<\/summary>/)`.

## 3. Consent card radius -- hero/consent owner

No change needed: `components/marketing-consent.module.css` `.panel` is already
`border-radius: 8px`, which is now the one card radius on Home (record sheet, recompile cards,
revision card, region buttons, passage match, page window, film viewport). Keep it at 8px.
Its buttons keep `var(--r-inst, 6px)` -- controls, not cards.

## 4. e2e

No spec change is required by this lane's diff. Selectors that still hold:
`#s2 article[data-case-status]`, `#s2 [data-page-window]`, `#s3 article details` (Source details
stays a disclosure inside the record), `#s5 .lv2-proof` (4), `#s5 a.lv2-inline-link` (4, now the
"Read" links; their accessible names are `Read: <title>` / `읽기: <title>`).
If item 2 lands and a spec wants to pin it: `page.locator("#s3")` must contain no
`summary:has-text("Read the record")`.

## 5. What this lane did not touch (left for its owner)

- `components/landing-v2/film-reading-layer.module.css` (hero lane): the four pane cells under the
  film are still mono uppercase 12px with a 2px top rule (they act as stage markers, like tabs).
- `components/landing-v2/landing-hero.module.css` still carries the old `.home …` `!important`
  block at the end of the file. It is dead: `heroStyles.home` is not applied to any element (the
  Home root carries `source-first-home.module.css`'s `.home`), so none of those rules match.
  Deleting it is a safe cleanup for a later pass; it was left to keep this diff to the critic items.
