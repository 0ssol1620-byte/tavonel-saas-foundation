# What gets a changelog entry

The public changelog at `/changelog`, and its Atom feed at `/changelog/feed.xml`, are built from
one list: `nextjs/lib/changelog.ts`. This page is the rule for adding to that list. The same rule
is in the module's header comment, so an author editing the list reads it there.

Source: `ENABLEMENT-GAP-2026-10-17.md` §4d (ux-program-20261017).

## Cadence

Entries follow deployments, not the calendar. A production deployment that changes any item in
the list below gets an entry. The entry is dated with the Asia/Seoul calendar day the deployment
reached tavonel.com. Set `releasedAt` to the deployment's exact UTC READY time whenever a receipt
for it exists. The site makes no public promise about how often entries appear.

## An entry

- A public page or its wording, whether added, changed or removed.
- A published contract change: the OpenAPI document, an error code or a response shape. The
  entry names the new `info.version` in `apiVersion`, which renders as the "API …" chip. A
  breaking change also sets `breaking` and `migration`, using the existing migration rule.
- A developer asset change: any file under `/developer/`. If `channel.json`'s `version` moved,
  the entry names the new version in `version`, which renders as the "Release …" chip.
- A change to a limit or a format tier.
- A change to price wording, using only the strings the founder set.
- A manual revision, a re-recorded guide video, or a newly published benchmark or negative
  result.

Group each entry's bullets under Added, Improved and Fixed, and tag it with the surfaces it
touched (Workspace, API, Developer tools, Website, Billing). Write it as what a reader can now do
or must now change, not as a record of our own work.

## Not an entry

- Internal refactors.
- CI changes.
- Documentation typo fixes.
- Style changes nobody can see on screen.
- Research that has not been published.

## What a test holds

`nextjs/lib/changelog.test.ts` checks two things without reading a clock:

- the `version` that `nextjs/public/developer/channel.json` serves appears as some entry's
  `version`, and that entry is tagged Developer tools;
- the `info.version` that `GET /api/openapi` serves (`nextjs/app/api/openapi/route.ts`, value
  from `nextjs/lib/api-version.ts`) appears as some entry's `apiVersion`, and that entry is
  tagged API.

So if either version moves without an entry, the build fails. The same file checks that each
anchor matches the date its entry shows, that entries run newest first, and that the feed carries
every entry. Whether an entry is *true* is still checked by a person.
