# Crawler policy — search is welcome, corpus collection is not

**Delegated decision, 2026-09-11 (orchestrator, under the founder's delegation) — see
`docs/policy/DECISION_LOG_2026-09-11.md`** (FD-61). Not the founder's own statement; the founder
may reverse it, and a reversal is a new entry in that log. Implemented in `nextjs/app/robots.ts`,
in a delimited block, and pinned by `nextjs/lib/seo-surface.test.ts`.

## The distinction

Two different acts arrive over the same protocol and look identical in a log line:

- **A search crawl** fetches a page so that a person who asks a question can be sent back to it.
  The value returns to the site. This is the reason the site exists in public at all, and nothing
  in `robots.txt` withholds a public page from a search crawler.
- **A corpus crawl** fetches a page so that its text becomes training data for a model. Nothing
  returns to the site, the page's copy is the licensed work, and the model that results competes in
  the same category this company sells into.

`robots.txt` cannot tell those apart by path, because they are the same paths. The only distinction
it can express is the user-agent token an operator chooses to send, so that is what the policy is
written in.

## What is allowed

Allowed the whole public surface, with the same private-path list as `*`:

| Token | Operator | Why |
|---|---|---|
| `OAI-SearchBot` | OpenAI | Documented for search appearance |
| `PerplexityBot` | Perplexity | Documented for search appearance |
| `Googlebot` | Google | Search index |
| `*` | everyone else | Default; the public surface is public |

**User-triggered fetchers stay allowed**, and that is part of the decision rather than an
oversight. `Claude-User`, `Claude-SearchBot`, `ChatGPT-User`, `OAI-SearchBot` and `PerplexityBot`
fetch a page because a person asked a question about it. That is closer to a visit than to a
corpus crawl: the value returns to the site, the person can be sent here, and nothing is retained
for training. Two of the five are named in the table above; the other three are allowed by the
`*` group and are deliberately **not** in the disallow list below. `seo-surface.test.ts` fails if
one of them arrives there.

`llms.txt` exists for the same reason and keeps the same role: it is a discovery aid for a tool
that needs to find the right page, not a ranking signal and not a grant.

## What is disallowed

Disallowed everywhere (`Disallow: /`, no `Allow` line):

| Token | Operator | Documented purpose |
|---|---|---|
| `GPTBot` | OpenAI | Model training crawl |
| `CCBot` | Common Crawl | Corpus collection redistributed to third parties |
| `ClaudeBot` | Anthropic | Model training crawl; the token the current crawler sends |
| `anthropic-ai` | Anthropic | Model training crawl; the older token, kept because a crawler that still sends it would otherwise be allowed |
| `Google-Extended` | Google | Controls use of fetched content for generative-model training; it is not a crawler and not a search signal |
| `Applebot-Extended` | Apple | Controls use of fetched content for generative-model training |
| `Bytespider` | ByteDance | Model training crawl |
| `Meta-ExternalAgent` | Meta | Documented for training-corpus and product indexing |

Two of those eight — `Google-Extended` and `Applebot-Extended` — are not crawlers at all. They are
tokens their operators read as a use-permission signal for content their search crawlers already
fetched, which is why `Googlebot` stays allowed on the line above while `Google-Extended` is
refused here. Blocking the search crawler to refuse the training use would cost the site its search
presence and refuse nothing.

Two more are one operator's old and current token. `ClaudeBot` is what Anthropic's crawler sends
now and `anthropic-ai` is the earlier one; both are listed, because refusing only the retired
token would leave the one in use allowed by the `*` default — which is exactly what this file
recorded as an open gap before FD-61 closed it.

## What this policy is not

- **It is not access control.** Every line in `robots.txt` is a request. An operator that ignores
  it is not stopped by it, and no part of this file is a technical protection measure. What makes a
  reuse unlicensed is the `LICENSE` at the repository root and the copyright in the site's copy —
  not this file.
- **It is not an SEO change.** Adding a training token costs nothing in search; removing one gives
  away a licence position. A commit that touches this list is a policy commit, and
  `seo-surface.test.ts` fails if a search token lands in the training group or the reverse.
- **It is not a claim that the corpus is clean.** It states what this site asks of a crawler. It
  says nothing about where any third party's model got its data.

## Closed, and still open

**Closed** by FD-61 in `docs/policy/DECISION_LOG_2026-09-11.md`, as a delegated decision the
founder may reverse:

- **Token coverage for the eight tokens in the table above.** `ClaudeBot` was the gap this file
  used to record as open — the disallowed Anthropic token was the retired one and the one in use
  was allowed by default. Both are now listed, as are `Bytespider` and `Meta-ExternalAgent`.
- **User-triggered fetchers stay allowed**, for the reason in *What is allowed*: a fetch a person
  asked for is a visit, not a corpus crawl.

**Still open**, and not defaulted here:

- **Tokens still not considered**: `Amazonbot`, `Diffbot`, `Omgilibot`, `Timpibot`, `PanguBot`,
  and any operator that crawls under a token nobody has published. The decision closed the list it
  named; it did not adopt a rule for the ones it did not. Adding one is a new decision, and
  `seo-surface.test.ts` keeps this paragraph named so the gap cannot quietly become the answer.
- **Whether to enforce rather than ask.** A rate limit, a WAF rule or a token check at the edge is
  the only thing that makes a refusal binding. None exists, and this file does not imply one.

## Where this is stated

The public statement is `robots.txt` itself, which anyone can fetch, and it is the authoritative
implementation. This document is the reasoning behind it and is not linked from a page; no page
claims a crawler policy that this file does not carry. The two are changed together.
