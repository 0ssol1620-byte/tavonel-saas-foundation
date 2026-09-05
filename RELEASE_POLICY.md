# Release Policy

**Status:** No release has been tagged on this repository yet (`git tag`, `gh api .../releases`,
and `gh api .../tags` are all empty at time of writing). This document describes the policy this
repository intends to follow once release management is turned on, and links the exact steps to
turn it on. Enabling any part of this — protecting `main`, cutting the first tag, publishing a
release — is a founder decision, not something an agent does unilaterally
(`CLAUDE.md`, "What is not an agent's call"; lane contract §7).

## Versioning

Semantic versioning: `v<major>.<minor>.<patch>`.

- **major** — a breaking change to a public contract: the REST API (`/openapi.json`), the MCP
  tool surface, the signed export package format, or a documented environment-variable contract
  in `nextjs/README.md`.
- **minor** — a backward-compatible addition: a new endpoint, a new MCP tool, a new export format,
  a new public page.
- **patch** — a fix that changes no public contract: bug fixes, copy corrections, dependency
  bumps, internal refactors.

A tag is cut only from a commit on `main` that has already passed CI, Launch QA and CodeQL. A tag
is never cut from a branch, and never backdated to a commit that has since been superseded on
`main`.

## What a release note contains

- The tag and the exact commit SHA it points to.
- What changed, grouped by the categories above (breaking / added / fixed), each item linking the
  PR that introduced it.
- Any change to a claim state (`nextjs/lib/claim-state.ts`) or a capability
  (`nextjs/lib/capabilities.ts`) — a capability moving from `Direction` to shipped, or from `open`
  to `closed`, is always called out explicitly, never left to be inferred from a diff.
- Any change to the exported package format, the OpenAPI schema, or an MCP tool's signature.
- Known issues carried into the release, stated plainly rather than omitted.
- A reproduction pointer: the exact commands in [`README.md`](README.md#development) needed to
  rebuild this tag from source and get the same `pnpm check && pnpm test && pnpm build` result CI
  got.

Release notes accumulate at `/changelog` on the site (`nextjs/app/changelog`,
`nextjs/lib/changelog.ts`); a tagged release and a changelog entry are expected to be created
together, not one without the other.

## Target: signed tags and build provenance

Once release management is turned on, the target — not yet implemented — is:

- **Signed tags.** Tags are created with `git tag -s`, verifiable against a published maintainer
  key, so a tag's authenticity does not depend on trusting whoever's local machine ran the command.
- **Build provenance.** The artifact a tag refers to (the deployed `nextjs/` build, and any
  downloadable developer artifact such as the CLI or MCP server under `/developer/`) carries a
  provenance attestation binding it back to the exact commit, workflow run and dependency lock
  file that produced it — the same principle the signed export package
  (`GET /api/collections/[id]/download`) already applies to a compiled World: a recipient
  verifies the artifact against a publicly known key rather than trusting the transport.

Neither of these is claimed as done. Do not add a badge, a checkmark, or a "verified" label
implying either exists until it is wired and tested.

## Sequence to cut the first tag

Only the founder runs this sequence, and only after the governance steps in
[`docs/GITHUB_GOVERNANCE_2026-09-05.md`](docs/GITHUB_GOVERNANCE_2026-09-05.md) are in place, so the
commit a tag points to has already gone through required status checks and review:

1. Confirm `main` is green: CI, Launch QA and CodeQL all passing on the commit to be tagged.
2. Write the release note as described above.
3. `git tag -s v0.1.0 -m "v0.1.0"` on that commit, then `git push origin v0.1.0`.
4. Publish the GitHub release from that tag with the release note as its body.
5. Add the corresponding entry to `/changelog`.

No tag is cut from an unreviewed branch, and no tag is cut to make a broken `main` look released.
