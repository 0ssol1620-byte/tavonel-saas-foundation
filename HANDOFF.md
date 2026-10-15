# film lane handoff (codex/hr-film-20261015)

Changes this lane needs outside its owned files, with exact text.

## 1. KO fitted hint reads as browser fullscreen (parity fixture owner)

The KO pair for the Fit/Focus toggle now reads "전체 프레임 보기" (button). The SR-only hint
still says "전체 화면", which is the browser-fullscreen word. It is in the non-Home SSR parity
fixture, so this lane left it unchanged.

- `nextjs/components/compile-stage-player.tsx` (MOBILE_FILM_VIEW.ko.fittedHint)
  - from: `전체 화면 · 작은 글자는 세부 내용 확대에서 확인하세요.`
  - to:   `전체 프레임 · 작은 글자는 세부 내용 확대에서 확인하세요.`
- `nextjs/scripts/fixtures/home-player-main304-ssr.json`, fixture `korean`: the same one-string
  replacement inside `html` (it is the only occurrence).
- `nextjs/components/compile-stage-player.mobile-view.test.tsx` line with
  `expect(fit).toContain("전체 화면 · 작은 글자는 세부 내용 확대에서 확인하세요.")`: the same replacement.

## 2. `app/ux-polish.css` does not exist on main 0969755b

The `.compile-film-*` rules live in `app/landing-v2.css`, `app/one-path.css` and
`components/landing-v2/source-first-home.module.css`. This lane edited none of them; the reading
layer's styles are in the new `components/landing-v2/film-reading-layer.module.css`.

## 3. Layout lane (film width)

The reading layer uses `width: min(100%, var(--lv2-film-w, 100%))` and `grid-column: 1 / -1`, so
it follows the film when `#s1 .lv2-film { --lv2-film-w }` is widened to 1200px. Nothing to change
here; it is placed by grid auto-placement after the viewport (row 4 on desktop/fit, row 5 in
phone Focus).

## 4. Digits in the reading line (integrator decision)

Stages 3 and 4 quote frame strings with digits: `+ fourteen (14) days’ written notice` and
`handbook-2026.pdf  p.12`. They are film content, not TAVONEL figures. The SSR digit walk in
`lib/landing-v2-page.test.ts` only sees stage 1 (`Site visit notes`) and passes. If an e2e walk
clicks through stages and flags undeclared digits, decide whether the quote needs a marker; do not
mark it `data-derived` (it is not read from the compiled World).

## 5. QA the integrator build must do (lane did not build)

- Computed `font-size` of `[data-film-reading] q` (15px) and its `p` (16px, 15px at <=767px),
  4 stages x EN/KO x 1440/390.
- 390 Focus details: first screen is ORIGINAL (Files), MARKDOWN (Organize, Updates), TERMINAL
  (Use with AI); the pane strip buttons pan and `aria-current` follows a swipe.
- Reduced motion: reading line visible under the poster.
- The strip cells line up under the four panes in Fit at 1440 and 390.

## 6. Environment

`nextjs/node_modules` was missing in this worktree; the lane created an NTFS junction to
`D:\CodexProjects\uskc-lanes\site-rc\nextjs\node_modules` (same target as the hero lane).
`tsc --noEmit` there reports 2 errors, both `Cannot find module '@vercel/functions/oidc'`
(app/api/internal/cdr/identity/route.ts, app/api/internal/probe/route.ts): the package is absent
from that shared tree, unrelated to this lane.
