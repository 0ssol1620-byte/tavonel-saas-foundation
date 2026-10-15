# HANDOFF — lane `example` (brief move 8)

Branch `codex/hr-example-20261015`. The lane committed the parts it owns:

- `nextjs/lib/home-evidence-view.ts`: `isClaimWithoutHeadingRunOn` / `selectReceiveClaim`. This is the
  claim-selection rule, documented in the code comment.
- `nextjs/components/landing-v2/source-region.tsx`: `SourceRegionCrop`. It crops the committed page
  raster to the record's `bbox1000` using inline CSS background size and position. It adds no asset,
  no canvas and no `<img>`, and it writes the coordinates back as `data-bbox1000`.
- Tests in `lib/home-evidence-view.test.ts` and `lib/landing-v2-runtime.test.ts`.

On `/` and `/ko` the real render path runs through files this lane does not own:

| Part | Renders on Home in | Owner |
| --- | --- | --- |
| "Follow a passage" workbench | `components/landing-v2/hero-source-card.tsx` + `landing-hero.module.css` | not this lane |
| "What you receive" record | `components/landing-v2/landing-page.tsx` (`record` from `buildEvidenceRecord()`) | not this lane |
| the record's data | `lib/landing-v2-proof.ts` → `lib/landing-v2-snapshot.json` (generated) | not this lane |

`scenes/sources.tsx`, `scenes/evidence.tsx` and `source-page.tsx` do not render on Home; only tests import
them. This lane left them unchanged.

## 1. Apply `HANDOFF-move8.diff` (exact replacement text, LF, repo-relative)

It touches `hero-source-card.tsx`, `landing-hero.module.css`, `landing-page.tsx`, `landing-v2-page.test.ts`,
`landing-v2-proof.ts`, `landing-v2-runtime.ts` and `landing-v2-runtime.test.ts`. The last two belong to this
lane, but they cannot land before the snapshot carries `receive`.

The worktrees use `core.autocrlf=true`, so apply the diff to the index and then refresh the working tree:

```sh
git apply --cached HANDOFF-move8.diff        # verified: `git apply --check --cached` passes on 8884523's tree
git checkout -- nextjs/components/landing-v2/hero-source-card.tsx nextjs/components/landing-v2/landing-hero.module.css \
  nextjs/components/landing-v2/landing-page.tsx nextjs/lib/landing-v2-page.test.ts nextjs/lib/landing-v2-proof.ts \
  nextjs/lib/landing-v2-runtime.ts nextjs/lib/landing-v2-runtime.test.ts
```

If the layout or hero lane has already changed one of these files, apply the hunks for that file by hand.
The hunks are small.

What the diff does:

- **Workbench** (`hero-source-card.tsx`): the passage pane wraps the quote in `.passageMatch`. The
  `SourceRegionCrop` of the active region sits directly above the quote and is cut from `page.image.src`,
  the raster the page view already serves. Selecting a region moves the crop along with the passage. The
  card still has a single `<img>`, so `hero-source-card.test.tsx` and the e2e `source.locator("img")`
  strict-mode checks stay valid.
- **CSS** (`landing-hero.module.css`): `.quote` changes to `font: 0.9375rem/1.6 var(--home-mono)` (15 px) and
  `white-space: pre-wrap`, and the < 640 px override becomes `0.875rem` (14 px). `.passageMatch` and `.crop`
  join the crop and the quote into one bordered unit.
- **"What you receive"**: `landing-v2-proof.ts` adds `buildReceiveRecord()` and `ReceiveRecord`.
  `landing-v2-runtime.ts` adds the `receive` snapshot field and getter. `landing-page.tsx` reads
  `buildReceiveRecord()`. `buildEvidenceRecord()` and `/explore`'s `chooseExploreEntryProof` do not change,
  so Scene 04, `/explore`, `compiler-specimen.test.ts` and `landing-v2-proof.test.ts` are unaffected.
- **Tests**: `landing-v2-page.test.ts` now asserts that the s3 `<blockquote>` equals the receive record's
  excerpt byte for byte.

## 2. Regenerate the snapshot (generated file; never hand-edit it)

From `nextjs/`, outside CI:

```sh
TAVONEL_UPDATE_LANDING_SNAPSHOT=1 pnpm exec vitest run lib/landing-v2-runtime.test.ts
pnpm exec vitest run lib/landing-v2-runtime.test.ts lib/landing-v2-page.test.ts lib/home-evidence-view.test.ts components/landing-v2/hero-source-card.test.tsx lib/landing-v2-proof.test.ts lib/compiler-specimen.test.ts
```

This adds `receive` to `lib/landing-v2-snapshot.json` and changes nothing else. Expected claim (pinned in
`landing-v2-runtime.test.ts`; 10-K p.4, region `…888d9f3b`, bbox 30,97,971,217):

> For example, statements in this Form 10-K regarding the potential future impact of macroeconomic conditions
> and tariffs and other measures on the Company’s business and results of operations are forward-looking
> statements.

## 3. "About the sample" sentence (EN and KO change together)

This copy belongs to the hero lane / `home-reader-guide.tsx`. Append it to the answer of the first FAQ item
("Has this demonstration been verified?"). Do not add it as a fourth item: `landing-v2-page.test.ts`
expects exactly three disclosures.

- EN: `The record under What you receive is picked by a fixed rule, not by how it reads: the first claim in the sample that is one complete sentence with no heading run into it.`
- KO: `받게 되는 것 아래의 기록은 읽기 좋은지가 아니라 정해진 규칙으로 고릅니다. 샘플에서 제목이 본문에 붙지 않은 완결된 한 문장인 첫 번째 진술입니다.`

## Not verified by this lane

The lane did not apply the diff to its own worktree, so it was not type-checked or run against tests
there. Temporarily editing files outside the lane was refused. Only `git apply --check --cached` was run.
The crop math was checked visually on a static page rendered from the same raster and formulas, using the
10-Q p.4 regions.
