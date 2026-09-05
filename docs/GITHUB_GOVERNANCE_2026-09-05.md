# GitHub Governance — commands to enable, not yet run

**Status:** none of this is enabled. Observed read-only against the live repository on
2026-09-05:

```
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection
{"message":"Branch not protected","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"404"}
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/releases
[]
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/tags
[]
```

`main` has no branch protection, there are no tags, and there are no releases. This document is
the exact set of `gh api` commands to close that gap. **Do not run them.** Changing a repository
setting, enabling branch protection, and creating a tag or release are owner actions;
`.github/CODEOWNERS` names `@0ssol1620-byte` as the owner of the repository and of `/.github/`.
This document exists so that when the owner decides to do it, the exact, reviewed command is
already written down rather than improvised at the terminal.

Every command below targets `0ssol1620-byte/tavonel-saas-foundation` and needs a token with
`repo` (and, for the ruleset/protection endpoints, `admin:repo_hook`-level repo admin) scope.

## 1. Required status checks

The context strings below were read from the GitHub Checks API, not inferred from the workflow
YAML. Observed on 2026-09-05 for `main` at commit `9a7a93d`:

```
$ gh api "repos/0ssol1620-byte/tavonel-saas-foundation/commits/9a7a93d/check-runs?per_page=100" \
    --jq '.check_runs[].name' | sort -u
Browser QA (chromium)
Browser QA (firefox)
Browser QA (webkit)
Launch gate
Lighthouse budgets
analyze
nextjs
root
smoke
```

Two things in that list are easy to get wrong, and both are merge-blocking if you do:

- **The CodeQL check is `analyze`, not `CodeQL / analyze`.** `.github/workflows/codeql.yml`
  declares `jobs: analyze:` with no `name:` key, so `analyze` is the whole context string —
  `CodeQL` is the *workflow* name and does not appear in it. If you would rather see the
  qualified form, add `name: CodeQL / analyze` to that job, let it run once on `main`, and
  re-read the list above before requiring the new string.
- **Do not require `smoke`.** `.github/workflows/operations-smoke.yml` triggers only on
  `schedule` and `workflow_dispatch` — never on `pull_request`. A required check that never runs
  on a PR is a permanent merge block.

Launch QA reports four requireable checks, not three. `.github/workflows/launch-qa.yml` declares
`browser-qa` as a three-browser matrix (`Browser QA (chromium)`, `Browser QA (firefox)`,
`Browser QA (webkit)`), `lighthouse` as `Lighthouse budgets`, and `launch-gate` as `Launch gate`,
which runs `if: always()` with `needs: [browser-qa, lighthouse]` and fails unless both succeeded.

So there are exactly two correct shapes:

- **Expanded** — require the three `Browser QA` legs **and** `Lighthouse budgets`.
- **Aggregate** — require `Launch gate` alone, and neither of the others.

**Requiring the three browser legs without `Lighthouse budgets` is the one wrong answer**: it
looks like the expanded shape, and it lets a performance-budget regression merge to `main`. The
commands below use the expanded shape, so every Launch QA check appears in them by name. If you
prefer the aggregate, delete the four Launch QA contexts and add a single `Launch gate` — do not
keep some of one shape and some of the other.

Re-run the `check-runs` command above against the current `main` immediately before enabling.
The observation is pinned to one commit on one date; a workflow or job rename changes the string,
and a required check that does not exactly match a reported name blocks every PR from ever going
green.

```bash
gh api -X PUT repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=root' \
  -f 'required_status_checks[contexts][]=nextjs' \
  -f 'required_status_checks[contexts][]=analyze' \
  -f 'required_status_checks[contexts][]=Browser QA (chromium)' \
  -f 'required_status_checks[contexts][]=Browser QA (firefox)' \
  -f 'required_status_checks[contexts][]=Browser QA (webkit)' \
  -f 'required_status_checks[contexts][]=Lighthouse budgets' \
  -f enforce_admins=true \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'required_pull_request_reviews[require_code_owner_reviews]=true' \
  -f 'restrictions=null' \
  -f allow_force_pushes=false \
  -f allow_deletions=false
```

If the API rejects the combined payload (the classic protection endpoint is picky about nested
array fields via `gh api -f`), use the newer rulesets endpoint instead, which accepts a JSON body
directly and is the GitHub-recommended replacement:

```bash
gh api -X POST repos/0ssol1620-byte/tavonel-saas-foundation/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "required_review_thread_resolution": true
      } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "root" },
          { "context": "nextjs" },
          { "context": "analyze" },
          { "context": "Browser QA (chromium)" },
          { "context": "Browser QA (firefox)" },
          { "context": "Browser QA (webkit)" },
          { "context": "Lighthouse budgets" }
        ]
      } }
  ]
}
JSON
```

## 2. No direct force push, no branch deletion

Covered by `allow_force_pushes=false`, `allow_deletions=false` above (classic endpoint) or the
`non_fast_forward` / `deletion` rules (ruleset endpoint). Confirm after enabling:

```bash
gh api repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection | \
  jq '{allow_force_pushes, allow_deletions, required_status_checks, enforce_admins}'
```

## 3. Require pull request review, CODEOWNERS

`.github/CODEOWNERS` already exists and names `@0ssol1620-byte` as the default owner, plus
narrower owners for `.github/`, `nextjs/app/api/` and `supabase/migrations/`. Requiring code owner
review (`require_code_owner_review` / `required_pull_request_reviews[require_code_owner_reviews]`
above) makes that file binding rather than advisory. Before enabling, confirm at least one other
reviewer account exists with write access — a solo-owner repository with code-owner review
required and one contributor cannot merge its own PRs.

## 4. Create the first tag

Not run here; sequence is in [`RELEASE_POLICY.md`](../RELEASE_POLICY.md#sequence-to-cut-the-first-tag).
Summary: confirm `main` is green under the protection above, write the release note, then:

```bash
git tag -s v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes-file <release-note-path>
```

`git tag -s` requires a GPG or SSH signing key already configured for the account creating the
tag (`git config user.signingkey`, `gpg --list-secret-keys`, or an SSH signing key registered with
GitHub). Confirm that setup separately before running the sequence above — an unsigned tag should
not be substituted silently if signing fails.

## 5. Verify, after enabling

```bash
gh api repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection
gh pr list --repo 0ssol1620-byte/tavonel-saas-foundation --state open   # confirm existing PRs still mergeable under new rules
```

A required check name that does not match what GitHub actually reports leaves every open and
future PR permanently unable to merge. That is why the context strings in section 1 are read from
the Checks API rather than from the workflow YAML — a job's *file* name, its `jobs:` key and the
string GitHub reports are three different things, and `.github/workflows/codeql.yml` is the case
where they diverge.
Re-run the `check-runs` command in section 1 against the current `main` before enabling, and open
one real PR afterwards to confirm it can still go green.
