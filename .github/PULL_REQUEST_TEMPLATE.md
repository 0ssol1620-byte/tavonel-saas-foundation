<!--
Fill in every section. A checkbox left unchecked is a "no" that must be explained in "Notes",
not silence. The "Development" section of the repository's root README.md describes what each
gate below covers and how to run it.
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
      if this PR touches `nextjs/app/` or `nextjs/components/`
- [ ] A Preview deployment exists for this branch (Vercel comments the PR automatically) and has
      been opened at least once
- [ ] No fabricated data: every number, hash, count or "PASS" this PR adds is derived from a
      committed fixture under test or a receipt with a hash — never typed by hand. This includes
      command output quoted in documentation: if a doc shows `$ some-command` and its result, that
      command was actually run and that is actually what it printed
- [ ] Documentation references resolve: for every file this PR touches, each `](relative/path)`
      link AND each backtick-quoted repository path names something that exists in this repository
      at this commit. A link checker alone does not cover the second half
- [ ] `nextjs/lib/brand-copy.test.ts` passes if this PR adds or changes public copy, and any new
      copy surface is added to `COPY_SURFACES` in that file

## Notes

<!-- Skipped gates and why. Anything a reviewer should look at closely. Screenshots for visual
changes. Owner decisions this PR surfaces but does not make — repository settings, branch
protection, tags and releases, adding a LICENSE, publishing a benchmark or a competitor
comparison, pricing copy, and anything touching billing, secrets or database migrations. -->

## Reviewer checklist

- [ ] Files touched are in scope for this change; anything edited outside that scope is called out
      in Notes rather than left for the reviewer to find
- [ ] Every checked gate box above has a real command and a real exit code behind it in Notes
- [ ] No PR merges itself: this box is not for the author to check
