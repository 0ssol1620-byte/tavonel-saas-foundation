# Crawler policy — search is welcome, corpus collection is not

**Delegated decision, 2026-09-11 (orchestrator, under the founder's delegation) — see
`docs/policy/DECISION_LOG_2026-09-11.md`** (FD-61), **amended 2026-09-16 by SD-05 in
`docs/policy/DECISION_LOG_2026-09-16.md`**. Not the founder's own statement; the founder may
reverse either, and a reversal is a new entry in the later log. Implemented in
`nextjs/app/robots.ts`, in a delimited block, and pinned by `nextjs/lib/seo-surface.test.ts`.

**What SD-05 changed, in one line:** `ClaudeBot` moved from *disallowed everywhere* to the
allow-list beside `OAI-SearchBot` and `PerplexityBot`. Nothing else moved — `anthropic-ai` and the
other six training tokens are refused exactly as they were.

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
| `ClaudeBot` | Anthropic | Fetch-time retrieval for a person's question (SD-05, 2026-09-16) |
| `Googlebot` | Google | Search index |
| `*` | everyone else | Default; the public surface is public |

**User-triggered fetchers stay allowed**, and that is part of the decision rather than an
oversight. `Claude-User`, `Claude-SearchBot`, `ChatGPT-User`, `OAI-SearchBot`, `PerplexityBot` and
— since SD-05 — `ClaudeBot` fetch a page because a person asked a question about it. That is closer
to a visit than to a corpus crawl: the value returns to the site, the person can be sent here, and
nothing is retained for training. Three of the six are named in the table above; the other three
are allowed by the `*` group and are deliberately **not** in the disallow list below.
`seo-surface.test.ts` fails if one of them arrives there.

`llms.txt` exists for the same reason and keeps the same role: it is a discovery aid for a tool
that needs to find the right page, not a ranking signal and not a grant.

## What is disallowed

Disallowed everywhere (`Disallow: /`, no `Allow` line):

| Token | Operator | Documented purpose |
|---|---|---|
| `GPTBot` | OpenAI | Model training crawl |
| `CCBot` | Common Crawl | Corpus collection redistributed to third parties |
| `anthropic-ai` | Anthropic | Model training crawl; the older token, kept because a crawler that still sends it would otherwise be allowed |
| `Google-Extended` | Google | Controls use of fetched content for generative-model training; it is not a crawler and not a search signal |
| `Applebot-Extended` | Apple | Controls use of fetched content for generative-model training |
| `Bytespider` | ByteDance | Model training crawl |
| `Meta-ExternalAgent` | Meta | Documented for training-corpus and product indexing |

Two of those seven — `Google-Extended` and `Applebot-Extended` — are not crawlers at all. They are
tokens their operators read as a use-permission signal for content their search crawlers already
fetched, which is why `Googlebot` stays allowed on the line above while `Google-Extended` is
refused here. Blocking the search crawler to refuse the training use would cost the site its search
presence and refuse nothing.

One operator now has a token in each table, and that is the shape of SD-05 rather than an
inconsistency. `ClaudeBot` fetches at the moment a person asks; `anthropic-ai` is the older
corpus token and stays refused. FD-61 listed both here because the gap it was closing was that
the refused Anthropic token was the retired one — the coverage point it made still holds, and
SD-05 answers a different question: which of the two acts each token performs.

The cost of the change is stated rather than hidden: a fetch-time agent that also retains what it
fetched would be taking, under a token this file now allows, what the table below refuses. Nothing
in `robots.txt` can tell those apart — see *What this policy is not*. The trade was made because
answer-engine citation is this category's discovery path and the site is not in any index at all
(T1-001), so the refusal was costing a citation and preserving nothing enforceable.

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

- **Token coverage.** Every Anthropic token is now classified rather than defaulted: `ClaudeBot`
  allowed (SD-05), `anthropic-ai` refused. `Bytespider` and `Meta-ExternalAgent` are listed too.
- **User-triggered fetchers stay allowed**, for the reason in *What is allowed*: a fetch a person
  asked for is a visit, not a corpus crawl. SD-05 is that rule applied to one more token, not a
  new rule.

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
