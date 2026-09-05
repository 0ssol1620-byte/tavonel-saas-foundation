<!--
Fill in every section. A checkbox left unchecked is a "no" that must be explained in "Notes",
not silence. See CLAUDE.md and README.md#development for what each gate covers.
-->

## What changed and why

<!-- One or two sentences on the change. Link the issue or task if one exists. -->

## Gates

Report the real command and its real exit code for each gate that applies to this change. A gate
you did not run is left unchecked with a reason in Notes — never checked without having run it.

- [ ] `pnpm check` (tsc + eslint) — root workspace and/or `nextjs/`, whichever this PR touches
- [ ] `pnpm test` (vitest) — pass/fail counts included in Notes
- [ ] `pnpm build` — succeeds, static page count included in Notes if `nextjs/` changed
- [ ] Playwright (`pnpm test:e2e` / `pnpm qa:launch`) — projects run and result included in Notes,
      if this PR touches `app/` or `components/` under `nextjs/`
- [ ] A Preview deployment exists for this branch (Vercel comments the PR automatically) and has
      been opened at least once
- [ ] No fabricated data: every number, hash, count or "PASS" this PR adds is derived from a
      committed fixture under test or a receipt with a hash — never typed by hand
- [ ] `nextjs/lib/brand-copy.test.ts` passes if this PR adds or changes public copy, and any new
      copy surface is added to `COPY_SURFACES` in that file

## Notes

<!-- Skipped gates and why. Anything a reviewer should look at closely. Screenshots for visual
changes. Founder decisions this PR surfaces but does not make (see CLAUDE.md, "What is not an
agent's call"). -->

## Reviewer checklist

- [ ] Files touched are owned by this change (no edit to another lane's/owner's exclusive files
      without a flagged conflict)
- [ ] No PR merges itself: this box is not for the author to check
