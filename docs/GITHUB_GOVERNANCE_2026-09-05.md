# GitHub Governance — commands to enable, not yet run

**Status:** none of this is enabled. Verified read-only against the live repository at time of
writing:

```
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection
{"message":"Branch not protected", ... "status":"404"}
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/releases
[]
$ gh api repos/0ssol1620-byte/tavonel-saas-foundation/tags
[]
```

`main` has no branch protection, there are no tags, and there are no releases. This document is
the exact set of `gh api` commands to close that gap. **Do not run them.** Opening a PR, merging,
changing a repository setting, or creating a tag/release is not an agent's call — it is listed
explicitly as a founder decision in `CLAUDE.md` ("What is not an agent's call") and in the lane
contract (§7). This document exists so that when the founder decides to do it, the exact,
reviewed command is already written down rather than improvised at the terminal.

Every command below targets `0ssol1620-byte/tavonel-saas-foundation` and needs a token with
`repo` (and, for the ruleset/protection endpoints, `admin:repo_hook`-level repo admin) scope.

## 1. Required status checks

The check names below are the job names GitHub reports for the workflows already in
`.github/workflows/`. Confirm the exact strings in the repository's **Settings → Branches** UI
before running this — GitHub sometimes qualifies a job name with its matrix value (e.g. a Launch
QA browser leg reports as `Browser QA (chromium)`), and a required check that does not exactly
match a reported name blocks every PR from ever going green.

```bash
gh api -X PUT repos/0ssol1620-byte/tavonel-saas-foundation/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=root' \
  -f 'required_status_checks[contexts][]=nextjs' \
  -f 'required_status_checks[contexts][]=CodeQL / analyze' \
  -f 'required_status_checks[contexts][]=Browser QA (chromium)' \
  -f 'required_status_checks[contexts][]=Browser QA (firefox)' \
  -f 'required_status_checks[contexts][]=Browser QA (webkit)' \
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
          { "context": "CodeQL / analyze" },
          { "context": "Browser QA (chromium)" },
          { "context": "Browser QA (firefox)" },
          { "context": "Browser QA (webkit)" }
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
future PR permanently unable to merge. Verify the exact context strings against a real recent
run (`gh run list`, then inspect one run's check names) immediately after enabling, not after the
first complaint.
