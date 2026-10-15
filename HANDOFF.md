# HANDOFF — Release 3 lane `measurement-band` (move 7)

Branch `codex/r3-band-20261015`, from `codex/home-release3-20261015` (= main `dbe22b1e`).
Receipts: `outputs/tavonel-research-replan-20261013/resume-20261015/redesign-r3-20261015/band/`.

## What changed, and why

Judges' gap 3 was "no customer logos under the hero". There are no customers, so the band shows
measured facts with denominators and receipts instead. It is a separate labelled `<section>`
between `#s1` (hero + film) and `#s2` (workbench). It is not a scene: s1–s6 stay as they were.

| fact on the band | claims-pack id | receipt (served) | evidence sha256 |
|---|---|---|---|
| **0** broken links in compiled output. Of 1,000 documents offered, 596 compiled and 404 were refused. Structure only. | `compilation-guarantees` | R-02 (already published) | `936b859c484fb54a8bdff3175d89d2fd47d695d48ec93b99fcfd93ac53ee2e25` |
| **80.6** olmOCR-Bench score with recovery, 53.7 with only recovery switched off. Same pipeline, 1,403 documents, 8,413 checks. | `recovery-contribution-olmocr` | R-01 (already published) | `1f5b6220c1fa569e8e33530d933a16eb7ad6b856c56e22f1744f8fa96efe33e0` |
| **36.9%** of checks passed on low-quality scans, 194 of 526: the weakest document type. Standard digital documents: 1,380 of 1,394 (99.0%). | `accuracy-by-document-type` | **R-03 (new)** | `4d75ae96e70c7c1c425b991df0f1c356ec6393e73914aaed27f5f54b0048a559` |

Each fact links to `/research/notes#R-0x`. That page already existed; its articles now carry the
receipt id as their `id`. It prints the full digest and a download link for byte-identical receipt
files. The EN and KO bands have the same three facts, in the same order, with the same links.

Files:
- `nextjs/lib/home-measures.ts`: the data module. It imports `content/evidence/public-claims-pack.json`,
  which is a **byte-identical copy** of `docs/evidence/folynta-public-claims-pack.json`
  (sha256 `ff6f9f6b…065e`, evidence repo `cf53916`, pinned as `CLAIMS_PACK_SHA256`). For each fact the
  module looks up an approved claim by id. It then **throws** unless the claim's `evidence_sha256`
  is the digest of a receipt this site serves (`lib/evidence-record.ts`).
  - Headline figures come from the claim's `numbers`.
  - Denominators the claim does not carry come from the receipt bytes bound to the same sha:
    R-01 `held_constant` gives 1,403/8,413, and R-02 `vault_compilation` gives 596/404.
  - Every figure is printed through one formatter.
- `nextjs/components/landing-v2/home-measures.tsx` and `home-measures.module.css`: the band.
  - It is a server component, so it adds no client JS.
  - Styling is paper, ink and a 1px ink rule over each fact. Cobalt appears only on the three receipt links.
  - Figures are 56px at 1440 and 40px on phones, with `tabular-nums`. There is no motion.
  - Layout is three columns at 900px and above, one column below.
- `nextjs/components/landing-v2/landing-page.tsx`: one mount line after `#s1`.
- `nextjs/public/research/receipts/R-03-olmocr-bench-evaluation-2026-08-04.json`: a byte-identical copy of
  `docs/evidence/artifacts/folynta-mineru344-public-core-official-evaluations-r1-2026-08-04__olmocr-bench__evaluation-summary.json`.
  - These are the bytes R-01 already names as `with_recovery.summary_sha256`.
  - They contain evaluator output only: pass rates, counts, revision and hashes. No mechanism detail.
- `nextjs/lib/evidence-record.ts`: a new `measured` entry R-03 ("Results by document type, weakest
  row included"). It renders on /research/notes, and its title and takeaway render on /benchmarks.
  - The takeaway has no percentage, because `e2e/benchmarks.spec.ts` allows only "36.9%" on /benchmarks.
  - It does not use the word "accuracy" (`benchmarks-page.test.ts`).
- `nextjs/app/research/notes/page.tsx`: `id={entry.receipt?.id}` on each article. This is the anchor.
- `.gitattributes`: `nextjs/content/evidence/*.json -text`, the same rule the receipts use, so the
  pack copy hashes identically on Windows and Linux.
- `docs/LANDING_V2_2026-09-19.md`: a 2026-10-15 amendment naming the new component. The
  traceability test requires every `components/landing-v2` file to be named.

## Test changes, with reasons

- **`lib/landing-v2-page.test.ts`: the entry-page numeral test is extended, not loosened.**
  - `undeclaredText` first runs `claimBoundStripped`. A figure leaves the digit walk only when all of these hold:
    1. Its `<span data-claim data-claim-sha>` names a claim on the literal `HOME_CLAIM_ALLOWLIST`
       (claim id → receipt sha256), with that sha.
    2. That claim is `approved` in the pinned pack copy, with exactly that `evidence_sha256`.
    3. The served receipt file hashes to that sha.
    4. Every number in the span is a value of the claim or of the receipt bytes. Integers must
       match exactly; fractions must match at the printed precision, so 80.6 passes and 81 does not.
  - Receipt links (`a[data-receipt]`) must name their id, date and sha prefix. Any other digit in
    the link text stays in the walk.
  - Every other digit on `/` and `/ko` fails exactly as before. `data-derived` is unchanged.
  - New failure-path tests prove the walk still refuses: an unbound figure; an approved claim not on
    the list (`completion-rate`); an allowlisted claim under another receipt's sha; a number the
    receipt does not carry (81, 92.4); and a digit typed into a receipt link.
  - New composition test: the band sits between s1 and s2, has three claim ids in allowlist order,
    links R-02/R-01/R-03 on `/research/notes`, includes the low-quality-scan row, does not contain
    "accuracy", and does not contain 99.98.
  - The h2 count goes from 7 to 8 because the band has its own heading (six scenes, the band, the FAQ).
- `lib/trust-page-answers.test.ts`: the published-receipt count goes from 2 to 3. R-03 is hashed
  against its served bytes like the other two, so this adds a check and removes none.
- `lib/home-measures.test.ts` (new):
  - The pack copy's sha256 equals `CLAIMS_PACK_SHA256`.
  - The printed EN/KO strings equal the pack's values with their denominators.
- `e2e/home-measures.spec.ts` (new):
  - Order s1 → band → s2, three facts, receipt hrefs, the weakest row, type floor ≥12px, figure ≥40px, tabular-nums.
  - Phones at 360, 390, 412 and 430 (EN and KO): one column, no overflow, nothing clipped, 15px or more of right gutter.
  - Reduced motion: no animations or transitions in the band.
  - Receipt click lands on `/research/notes#R-03`. Each R-0x article's printed digest equals
    sha256 of the bytes its download link serves.

## Measurements (build 7, `o6GLAPkf23E0Np1TCUsf1`, port 3123)

All receipt files are under `.../redesign-r3-20261015/band/`.

- `pnpm check` passes: brand:verify, type floor 12px, tsc and eslint (`check-2.log`).
- Full vitest passes: 405 files, 5,965 tests (`vitest-full-1.log`). Release 2 had 404 files and 5,955 tests.
- E2E on chromium (system Chrome wrapper `scratchpad/r3/band/pw-chrome.config.mjs`), projects 1440, 390, 360, reduced-motion and audit:
  - `home-measures`, `landing-v2`, `evidence-first` and `benchmarks`: 138 passed. The one failure was
    the first draft of my reduced-motion assertion; it is fixed in `e2e-2.log`, where all 7 band tests pass.
  - premium-craft, hero-home-responsive, public-layout-balance, mobile-landing, home-evidence-line,
    home-source-routes, landing-hero-mobile, marketing-consent and overflow-audit: 179 passed, 0 failed (`e2e-3.log`).
  - WebKit 390 with reduced motion, `home-measures`: 3 passed (`e2e-webkit.log`).
- Geometry from `measure-2.json` and `shots-2/band-{en,ko}-{1440,1024,390,360}.png`:
  - At 1440, three columns at x=120/536/952, each 368px wide. The band h2 left edge is 120, the same as the `#s2` h2. Band height is 469px (EN) and 445px (KO). Figures are 56px, weight 600, tabular-nums.
  - At 1024, three columns of 292px. The receipt link wraps between its two halves, never inside the hash.
  - At 390 and 360, one column at x=20 (20px gutters), 0px overflow, figures 40px. Band height is 1,021px (EN) and 948–1,021px (KO).
  - At 412 and 430, the e2e checks one column and no overflow.
  - Receipt links are at least 44px tall, cobalt, mono 13px. Hangul falls through to Wanted Sans instead of a wide system mono.
  - Accent area is limited to the three receipt links (well under 6%).
- `/` first-load JS is 135 kB, with a page segment of 270 B. The band is a server component and adds no client JS.
- Films and posters were not touched (no `public/film` change).
- `/research/notes#R-03` lands on the new R-03 article (`shots-2/notes-R-03-1440.png`).

### Build-environment finding, for the orchestrator

- Builds 2–5 crashed in "Collecting page data" with worker exit `3221226505` (0xC0000409).
- The demo and polish lanes crashed at the same minutes: 00:38, 00:43, 01:03 and 01:34.
- Every compiled route module loads cleanly on its own (`scratchpad/r3/band/probe-collect.cjs`: 204 of 204).
- Build 7 passed once no other lane was in its collect phase.
- Likely cause: three or more lanes running the collect phase at the same time on this machine,
  all through the shared junctioned `node_modules`. This is not this diff.
- Recommendation: serialize `next build` across lanes.

## Not done, and why

- **Completion 99.98% (5,131 of 5,132) and recovery 99.94% (1,796 of the 1,797 that failed) are
  not on the band. They are marked not shippable.**
  - Both are approved claims, ids `completion-rate` and `recovery-rate`, receipt sha `3dcaf2ae…`.
  - Their only receipt is the completion ledger, and this site does not serve it.
  - Serving it byte-identically would also publish recovery tree and round names (retry round,
    paddle and deepseek collections). The recovery mechanism is on the disclosure registry's
    publication freeze with `review_before_publish: true`, and that is LEGAL-HOLD precedence.
  - To ship them, either clear publication of the ledger, or have the receipt generator emit a
    redacted ledger. A redacted ledger means a new sha, so the claims pack must be regenerated first.
  - After that, the change is one claim id on `HOME_CLAIM_ALLOWLIST`, one `bound(...)` entry, and one EVIDENCE receipt.
- GPU cost per 1,000 pages ($1.23) is left out. It is a conditional claim that needs its two
  conditions beside it, and it must never sit beside a price; the header links to Pricing.
- GDP 27 vs 31 is left out. It is a different evaluation and already lives on /benchmarks/gdp-pdf.
- **Design-authority conflict, for the founder to see.** `DESIGN_MASTER_V3.md` lists "홈에 벤치마크
  수치 표" (a benchmark number table on Home) as an anti-pattern, and bars "수치 배지" in the hero.
  - The band is not in the hero and is not a table. It is three receipted facts with the weakness included.
  - The brief marked move 7 as a founder decision. It was built under the orchestrator's lane order.
  - Removing it is one line in `landing-page.tsx` and the h2 count in the test.
- Not checked: real-device Safari. Playwright WebKit at 390 was checked.
- Not judged: whether the band moves the blind score. That is a decision for the next judging round, not this lane.
