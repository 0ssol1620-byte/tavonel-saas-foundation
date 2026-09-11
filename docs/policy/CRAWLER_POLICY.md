# Crawler policy — search is welcome, corpus collection is not

Decided 2026-09-11. Implemented in `nextjs/app/robots.ts`, in a delimited block, and pinned by
`nextjs/lib/seo-surface.test.ts`.

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

`llms.txt` exists for the same reason and keeps the same role: it is a discovery aid for a tool
that needs to find the right page, not a ranking signal and not a grant.

## What is disallowed

Disallowed everywhere (`Disallow: /`, no `Allow` line):

| Token | Operator | Documented purpose |
|---|---|---|
| `GPTBot` | OpenAI | Model training crawl |
| `CCBot` | Common Crawl | Corpus collection redistributed to third parties |
| `anthropic-ai` | Anthropic | Model training crawl |
| `Google-Extended` | Google | Controls use of fetched content for generative-model training; it is not a crawler and not a search signal |
| `Applebot-Extended` | Apple | Controls use of fetched content for generative-model training |

Two of those five — `Google-Extended` and `Applebot-Extended` — are not crawlers at all. They are
tokens their operators read as a use-permission signal for content their search crawlers already
fetched, which is why `Googlebot` stays allowed on the line above while `Google-Extended` is
refused here. Blocking the search crawler to refuse the training use would cost the site its search
presence and refuse nothing.

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

## Open, and a founder decision

- **`ClaudeBot` is not on the list.** It is the token Anthropic's current crawler sends;
  `anthropic-ai` is the older one, and only the older one was named in the decision this file
  records. As it stands, the disallowed token is the one largely out of use and the one in use is
  allowed by default. Adding it is a founder call, and `seo-surface.test.ts` keeps the gap named so
  it cannot quietly become the answer.
- **Other tokens not considered**: `Bytespider`, `Amazonbot`, `Meta-ExternalAgent`,
  `Diffbot`, `Omgilibot`, `Timpibot`, `PanguBot`, and the user-triggered fetchers some assistants
  send under their own tokens. A user-triggered fetch on someone's behalf is closer to a search
  visit than to a corpus crawl, and it is a separate decision from this one.
- **Whether to enforce rather than ask.** A rate limit, a WAF rule or a token check at the edge is
  the only thing that makes a refusal binding. None exists, and this file does not imply one.

## Where this is stated

The public statement is `robots.txt` itself, which anyone can fetch, and it is the authoritative
implementation. This document is the reasoning behind it and is not linked from a page; no page
claims a crawler policy that this file does not carry. The two are changed together.
