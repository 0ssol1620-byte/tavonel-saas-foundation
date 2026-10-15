# HANDOFF — layout lane (codex/hr-layout-20261015)

Brief: `REDESIGN-BRIEF-2026-10-15.md` moves 3, 4, 10, 2(a) and §4. Everything below is for the
integrator and the other lanes. Nothing here is built or screenshot-verified: the lane did not
run `next build`/`next dev`. Cascade claims in §4 are expectations to check in the built browser.

## 1. Changes another lane must make (exact text)

### 1a. Hero lane — drop the now-ignored `compact` prop (landing-page.tsx)

`RecompileScene` and `TrustScene` ignore `compact` now (the prop stays in their types, documented
as ignored). Remove it at the call site:

```diff
           data={data.recompile}
           sectionId="s4"
           sceneIndex={4}
-          compact
         />
-        <TrustScene locale={locale} copy={copy.trust} sectionId="s5" sceneIndex={5} compact />
+        <TrustScene locale={locale} copy={copy.trust} sectionId="s5" sceneIndex={5} />
```

After that lands, delete the `compact?: boolean;` member and its doc comment from both
`components/landing-v2/scenes/recompile.tsx` and `components/landing-v2/scenes/trust.tsx`.

### 1b. Hero lane — consent card

The lane removed the three `body:has([data-marketing-consent-panel])` compensations from
`source-first-home.module.css` (header `margin-bottom: 0 !important`, `#s1 padding-top: 32px`,
mobile `#s1 padding-top: 24px`). `#s1` now always reserves the fixed header (112px desktop,
96px mobile). Two consequences for `components/marketing-consent.module.css`:

- If the card becomes bottom-fixed, delete the `:global(body):has(.panel) :global(header.nav)
  { position: sticky; ... margin-bottom: -64px; }` rule as well, so the header stays fixed.
  (If it is kept, Home is still correct: sticky + -64px overlays the hero exactly like fixed.)
- The bottom safe-area allowance belongs to the card itself (the existing BQ-055 `:has()`
  page padding), e.g. `padding-bottom: calc(<card height> + env(safe-area-inset-bottom))` on the
  body/footer while the card is open. The layout lane did not add one because the card height is
  the hero lane's.

### 1c. Hero lane / integrator — font on the consent card (Geist check)

On Home, `--f-sans` is redefined on `source-first-home .home` (Wanted Sans Variable) and the
header has its own Wanted Sans `--f-sans` (`public-site-chrome.module.css`), so main, header and
footer resolve to Wanted Sans. The one Home surface outside `.home` is the consent panel, which
the root layout renders; it inherits `:root --f-sans` = Geist. If the built browser shows Geist
on it, add to `components/marketing-consent.module.css`:

```css
:global(body:has([data-home-ia])) .panel { font-family: "Wanted Sans Variable", Arial, "Malgun Gothic", sans-serif; }
```

No other Geist use on Home was found (`var(--font-geist)` is referenced only by the `:root`
`--f-sans` token in `app/tavonel.css`). No font files were added.

### 1d. Optional (integrator decides) — "Read the record" disclosure (landing-page.tsx 434–455)

The gap report's c7 row lists "Read the record" as an orphan in a wide right column. Move 3's
explicit list does not name it, so the lane did not change it. If it should be expanded too:

```diff
-              <details className={heroStyles.receiveNotes}>
-                <summary>{korean ? "기록 읽기" : "Read the record"}</summary>
+              <div className={heroStyles.receiveNotes}>
                 <ul className={heroStyles.noteList}>
 ...
                 <p className={heroStyles.rights}>{page.receive.rights}</p>
-              </details>
+              </div>
```

If it stays folded, it already gets a visible marker (see §4), and a more specific label pair is
`"What this record carries — 3 properties, 3 steps"` / `"이 기록에 담긴 것 — 속성 3개, 단계 3개"`.

### 1e. Test to add (test files are outside this lane) — `lib/landing-v2-page.test.ts`

Verified in the lane against a throwaway copy: passes on this branch, fails (2/2) on 0969755b.

```ts
describe("Home substance renders expanded (redesign brief 2026-10-15, move 3)", () => {
  for (const korean of [false, true]) {
    it(`${korean ? "/ko" : "/"} prints the affected objects, the four scopes and the formats unfolded`, () => {
      const html = renderToStaticMarkup(createElement(LandingPage, { korean }));
      const scene = (id: string, end: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(end));
      const s1 = scene("s1", 'id="s2"');
      const s4 = scene("s4", 'id="s5"');
      const s5 = scene("s5", "data-home-reader-guide");
      expect(s4).not.toContain("<details");
      expect(s4).toContain('id="lv2-recompile-objects"');
      expect(s4).toContain('id="lv2-recompile-counts"');
      expect(s5).not.toContain("<details");
      expect(s5.match(/class="lv2-proof-note/g)).toHaveLength(4);
      expect(s1).not.toMatch(/<summary>(Supported source formats|지원하는 원문 형식)<\/summary>/);
      expect(s1).toContain(korean ? "업로드에서 허용하는 형식" : "Accepted at upload");
    });
  }
});
```

## 2. Global-sheet changes

None. `app/*.css` is untouched. Every change is in a Home module
(`source-first-home.module.css`, `landing-hero.module.css`, `scenes/recompile.*`, `scenes/trust.tsx`)
except `components/marketing-story.module.css` (`.boundary summary`, used by `/product` only),
which the task named.

The site-wide `summary { display: inline-flex }` (ledger major 4) lives in
`app/tavonel.css` `@layer overrides` → `@media (pointer: coarse), (max-width: 1079px)`. It was not
changed; each Home summary that stays folded is given `display: list-item` by a rule that
outranks it (unlayered module rule, or same-layer higher specificity).

## 3. Dead CSS found (not deleted beyond what the brief named)

Every `.home …` selector in `components/landing-v2/landing-hero.module.css` is dead: CSS modules
hash `.home` per file, and the Home wrapper carries `source-first-home`'s `.home`, never this
module's. Likewise `section.hero`, `.intro`, `.actionsBlock`, `.bench*` hero variants there
match nothing on `/` or `/ko` (`landing-page.tsx` uses `sourceStyles.intro`). The lane deleted
only the hero-support chain (7 rules), the dead `.home .film { width: min(100%, 1040px) … }`
and the dead `.home .contextDisclosure/.receiveNotes` lines. A follow-up can delete the rest
(about 200 lines); `lib/one-path-contract.test.ts` pins `section.hero .layout { display: grid }`,
so keep or update that test with it.

## 4. Cascade expectations — verify in the built browser (memory rule)

| Element (route) | Expected winner (file → selector) | Expected computed value |
|---|---|---|
| `#s1..#s6 .lv2-wrap`, reader guide `.lv2-wrap` | source-first-home → `.home.home .lv2-wrap` (overrides layer) | width = `min(1200px, 100% - 2·clamp(20px,2.5vw,32px))`; 1440 → left 120 / right 1320; 390 → 20 / 370 |
| header row | chrome-v2 `.nav.chrome-v2-header` padding-inline using `--chrome-measure`/`--chrome-gutter`, now `var(--page-max)`/`var(--page-pad)` from source-first-home `.home` | logo left 120 at 1440, 20 at 390 (`public-site-chrome.module.css` sets no header padding of its own) |
| `#s1 figure.lv2-film-story` | source-first-home → `.home.home #s1 .lv2-film-story` | width 1200 at 1440 (was 1040); margin 0, border 0 (`!important` beats unlayered `.film` in landing-hero) |
| `#s1 .compile-film-viewport` | source-first-home → `#s1 .compile-film-viewport` over landing-v2 `.lv2-film .compile-film-viewport` | width = `min(100%, 1200px)`; background `#0e1013` |
| `section.lv2-scene` (s1–s6; s2/s3 backgrounds also come from the unlayered `section.difficulty` / `section.receive`, both paper) | source-first-home → `.home.home .lv2-scene` | background `#faf9f6`; border-top 0; border-bottom `1px solid #d8ddd9`; padding-block 120px (72px ≤767) |
| `#s2` (`section.difficulty`) | landing-hero unlayered `section.difficulty` | background `#faf9f6` (was stone) |
| `#s5` (`.lv2-surface`) | source-first-home `.lv2-scene` `border-block: 0` over landing-v2 `.lv2-surface` | no dark top border |
| reader guide `[data-home-reader-guide]` | landing-hero unlayered `.readerGuide` | padding-block 120/72, border-bottom 1px rule |
| `h1.lv2-hero-h1` | source-first-home `.home.home .lv2-hero-h1` (no other live rule; landing-hero's are dead) | 80px at 1440, weight 600, line-height 0.98 (KO 1.08), letter-spacing −0.035em (KO −0.02em); 40px ≤767 |
| `p.lv2-hero-support` (when the hero lane shows it) | source-first-home `.home.home .lv2-hero-support` — the only live rule | 20px/1.55 (18px/1.6 ≤767; KO line-height 1.75), `#58606a`, centered, max 40rem |
| `.lv2-h2` (s2–s6) | source-first-home `.home.home .lv2-h2` (landing-hero `.splitHead/.receiveHead .lv2-h2` size rules deleted) | 52px at 1440 (`clamp(32px,3.6vw,52px)`), 600, 1.04, −0.03em; KO −0.015em / 1.2 |
| reader guide `h2` | landing-hero unlayered `.readerHead h2, .readerFaq h2` | same 52px / 600 / 1.04 / −0.03em |
| `main .lv2-meta` | source-first-home `.home.home main .lv2-meta` over landing-v2 `.lv2-meta` | Wanted Sans 500 13px, letter-spacing 0; `[data-derived="1"]` (arrival dates) stays IBM Plex Mono |
| KO `.lv2-meta`, `[class*=eyebrow]`, stage tabs | source-first-home `.home[lang="ko"].home :is(...)` and `.home[lang="ko"].home #s1 .compile-film-stages button` | letter-spacing 0px, text-transform none |
| KO recompile `.objectState` | recompile.module.css `.objectState:lang(ko)` (unlayered) | text-transform none, letter-spacing 0 |
| `#s4` fan / object rail | source-first-home `#s4, #s5 { --relation: var(--home-rule-strong) }` | neutral 32%-ink line, not violet `#a996ff` |
| folded summaries: `.contextDisclosure > summary`, `.receiveNotes > summary`, `.readerFaq summary` | landing-hero unlayered rule beats tavonel's layered `summary { inline-flex }` | `display: list-item`, visible ▸/▾ marker at 390 and 1440 |
| hero-source-card / receive "Source details" | landing-hero `.detailsSummary` (unchanged) | its own rotating chevron |
| `/product` `.boundary summary` | marketing-story `.boundary summary` (overrides layer, (0,1,1) > `summary`) | list-item marker, ≥44px tall |

## 5. Deviations from the brief, stated

- `--source` (#795400) was not declared under that name: `--source` is already a shared token
  (`#7da7ff`) that drives the Home focus ring and region boxes, so redefining it on `.home` would
  turn every focus ring amber. The source colour stays `--home-amber-ink: #795400`, which is the
  brief's value. `#s4` keeps its existing `--source: #244ac8` for its links' focus ring.
- KO line-heights were not specified in §4.5 for H1/H2; 0.98 is too tight for Hangul, so KO H1 is
  1.08 (1.16 at ≤767, as before) and KO H2 1.2.
- `--space-1..9` were not introduced as tokens; the values used (16, 24, 32, 48, 72, 120) are on
  that scale.
- The footer's inner width (`.one-path-wrap`) was not aligned to `--page-w`; the brief's
  alignment list is header, hero, film and sections.

## 6. Environment notes

- `nextjs\node_modules` did not exist in this worktree. The lane created it as an NTFS junction to
  `D:\CodexProjects\uskc-lanes\site-rc\nextjs\node_modules` (the tree `tsf-home-20261015` uses);
  no install was run.
- `tsc --noEmit` reports two errors that are identical on clean `0969755b` with this junction:
  `Cannot find module '@vercel/functions/oidc'` in `app/api/internal/cdr/identity/route.ts` and
  `app/api/internal/probe/route.ts`. The shared tree lacks that package; not caused by this lane.
