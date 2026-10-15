# HANDOFF — example lane, Release 2 (2026-10-15)

Branch `codex/hr-example-20261015`. Everything below touches files this lane does not own.
Each item gives the exact replacement. Paths are relative to `nextjs/`.

## 1. Mount the Evidence Line in the workbench (brief move 5) — `components/landing-v2/hero-source-card.tsx`

The overlay (`WorkbenchEvidenceLine`, `components/landing-v2/evidence-connector.tsx`) and the label
(`evidenceLineLabel`, `lib/home-evidence-view.ts`) are done and unit-tested. Nothing draws until the
workbench mounts them.

1a. Imports. Replace

```tsx
import { caseStatus, displayableRegions, publishableClaims, type EvidenceCase, type EvidenceRegion } from "@/lib/home-evidence-view";
import styles from "./landing-hero.module.css";
import { SourceRegionCrop } from "./source-region";
```

with

```tsx
import { caseStatus, displayableRegions, evidenceLineLabel, publishableClaims, type EvidenceCase, type EvidenceRegion } from "@/lib/home-evidence-view";
import styles from "./landing-hero.module.css";
import { WorkbenchEvidenceLine } from "./evidence-connector";
import { SourceRegionCrop } from "./source-region";
```

1b. Labels. After the `where` arrow function (the line ending `` `${korean ? `${region.page}쪽` : `p.${region.page}`} · bbox ${region.bbox1000.join(",")}`; ``), add

```tsx
  /* Brief move 5: one data-derived label per region, by the letter the workbench prints beside it. */
  const lineLabels = Object.fromEntries(
    regions.map((region, index) => [region.id, evidenceLineLabel(source, region, letter(index), korean)]),
  );
  const activeLabel = lineLabels[active.id]!;
```

1c. Passage card is a line origin. Replace

```tsx
        <div className={`${styles.passagePane} ${styles.step}`} data-step={t.steps.passage} id={passageId} aria-live="polite">
          <p className={styles.paneLabel}>
            <span className={styles.extracted}>{t.existing}</span>
            <span>{t.roles[active.role]}</span>
          </p>
```

with

```tsx
        <div className={`${styles.passagePane} ${styles.step}`} data-step={t.steps.passage} id={passageId} aria-live="polite" data-line-region={active.id}>
          <p className={styles.paneLabel}>
            <span className={styles.extracted}>{t.existing}</span>
            <span>{t.roles[active.role]}</span>
          </p>
          {/* Where no line can be drawn (below 960px the grid stacks), the line's label sits on the card. */}
          <p className={styles.lineLabel} data-derived="1" data-evidence-card-label="">
            <span>{activeLabel.human}</span> <code>{activeLabel.coordinates}</code>
          </p>
```

1d. Region buttons are line origins. In the region `<button>`, after `aria-controls={passageId}` add

```tsx
                  data-line-region={region.id}
```

1e. Mount. Replace the closing of the article

```tsx
      </footer>
    </article>
```

with

```tsx
      </footer>
      <WorkbenchEvidenceLine labels={lineLabels} />
    </article>
```

1f. CSS — `components/landing-v2/landing-hero.module.css`. In the `.bench { ... }` rule add
`position: relative;` (the overlay is `position: absolute; inset: 0` and should cover the workbench
exactly). Then add:

```css
/* Brief move 5: the Evidence Line's label on the passage card, where the line itself is not drawn. */
.lineLabel {
  margin: 0.5rem 0 0;
  color: var(--home-cobalt);
  font: 500 0.75rem/1.45 var(--home-mono);
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.lineLabel span { font-family: var(--f-sans); color: var(--home-ink); }
.lineLabel code { font: inherit; }
@media (min-width: 960px) { .lineLabel { display: none; } }
```

Why 960 and not 900: the overlay is enabled from 900px, but it also refuses to draw unless the card
sits wholly to the right of the page box, and `.benchGrid` only goes side by side at 960px. Between
900 and 959 the grid is stacked, so the card label has to stay visible there.

## 2. s2 trailing dead space (critic BLOCKER 3, brief move 3) — `components/landing-v2/landing-page.tsx`

Both summaries already have visible markers (`.detailsSummary::before` triangle; `.contextDisclosure > summary`
is `display: list-item`). The ~130px under them is the shared `.lv2-scene` bottom padding (120px at
desktop, `source-first-home.module.css:61`) after two one-line summaries. Move 3 says substantive
content is expanded by default; "The context this passage needs" is substantive (the three
difficulties and the region links). Replace

```tsx
            <details className={heroStyles.contextDisclosure}>
```

with

```tsx
            <details className={heroStyles.contextDisclosure} open>
```

The section then ends on content instead of an empty band. If the scene must stay short, the
alternative is `.home.home :global(#s2.lv2-scene) { padding-bottom: 72px; }` in
`source-first-home.module.css` — but that leaves the folded-label look the critic flagged.
Also visible in the 1440 capture: the workbench footer draws two rules back to back (`.record`
`border-top` 1px ink, then `.details` `border-top` 1px rule, ~32px apart). Dropping
`border-top` from `.record .details` would leave one.

## 3. FAQ sentence (EN/KO) — `components/landing-v2/home-reader-guide.tsx`

The "What you receive" rule now also excludes boilerplate (`lib/home-evidence-view.ts`, rules 5–7).
The quoted claim changed from the safe-harbour sentence to the first claim passing all seven rules:
"Unless otherwise stated, all information presented herein is based on the Company’s fiscal
calendar, …" (`claim-25ec53e23c1c4f8d059e0a25ea4928e7`, 10-K p.4, bbox 30,234,971,268).

EN — replace

```
The record under What you receive is picked by a fixed rule, not by how it reads: the first claim in the sample that is one complete sentence with no heading run into it.
```

with

```
The record under What you receive is picked by a fixed rule, not by how it reads: the first claim in the sample, in document order, that is one complete sentence with no heading run into it, has at least 12 words, and is not boilerplate (forward-looking or safe-harbour language, or a fragment opening “For example,” or “Such as”).
```

KO — replace

```
받게 되는 것 아래의 기록은 읽기 좋은지가 아니라 정해진 규칙으로 고릅니다. 샘플에서 제목이 본문에 붙지 않은 완결된 한 문장인 첫 번째 진술입니다.
```

with

```
받게 되는 것 아래의 기록은 읽기 좋은지가 아니라 정해진 규칙으로 고릅니다. 샘플에서 문서 순서상 처음 나오는 진술 중 제목이 본문에 붙지 않은 완결된 한 문장이고, 12단어 이상이며, 상투 문구(미래 예측·면책 조항 문구, 또는 “For example,”·“Such as”로 시작하는 조각)가 아닌 것입니다.
```

Note for the s3 owner: the new claim is 49 words, so `record.claim.excerpt` is cut by the
existing excerpt limit and `excerptTruncated` is `true`; s3 renders it with a trailing "…". The
claim text itself is unchanged in the World and the snapshot.

## 4. e2e (do not edit specs in a lane; selectors for the spec owner)

- Keyboard (1440, chromium + webkit): Tab to the first `#s2 [data-line-region]` region button,
  then A→B→C. After each focus, `#s2 [data-evidence-line]` equals that button's `data-line-region`,
  and `#s2 [data-evidence-line-label]` contains `SOURCE · 10-Q · p.4 · [`. The first exposure also
  contains `page 4 · region A` (KO: `4쪽 · 영역 A`).
- Hover `#s2 [data-line-region]` on the passage card: `[data-evidence-line]` equals the active region id.
- Reduced motion (`reducedMotion: "reduce"`): after focus, `document.getAnimations().length === 0`
  for the `[data-evidence-line] line` element.
- 390 / 360: `#s2 [data-evidence-line]` stays `none` after focusing a region button, and
  `#s2 [data-evidence-card-label]` is visible.
- CLS: layout-shift entries while tabbing A→B→C sum to 0.
- Crop: `#s2 [data-bbox1000]` still equals the region's record bbox; the display window is
  `data-crop1000` (16 raster px wider each side, clamped to the page).
