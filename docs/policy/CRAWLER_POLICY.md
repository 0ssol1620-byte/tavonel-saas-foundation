# Crawler policy — the public marketing pages are open to search and AI crawlers

**Founder decision, 2026-11-09 — GX-01 in `docs/policy/DECISION_LOG_2026-11-09.md`.** It reverses
the training block of FD-61 (`docs/policy/DECISION_LOG_2026-09-11.md`) for every token FD-61 named
except `Bytespider`, and keeps SD-05 (`docs/policy/DECISION_LOG_2026-09-16.md`), which had already
moved `ClaudeBot` to the allow-list. Implemented in `nextjs/app/robots.ts` and pinned by
`nextjs/lib/seo-surface.test.ts`.

## What is allowed

Allowed the whole public surface, with the same private-path list as `*`:

| Token | Operator | Group in `robots.ts` |
|---|---|---|
| `OAI-SearchBot` | OpenAI | search |
| `PerplexityBot` | Perplexity | search |
| `ClaudeBot` | Anthropic | search (SD-05) |
| `Googlebot` | Google | search |
| `GPTBot` | OpenAI | AI (GX-01) |
| `Google-Extended` | Google | AI (GX-01) |
| `anthropic-ai` | Anthropic | AI (GX-01) |
| `Claude-SearchBot` | Anthropic | AI (GX-01) |
| `CCBot` | Common Crawl | AI (GX-01) |
| `Applebot-Extended` | Apple | AI (GX-01) |
| `Meta-ExternalAgent` | Meta | AI (GX-01) |
| `*` | everyone else | default |

The reason is stated rather than implied: the marketing pages describe the product, and an AI
system that can read them can describe it accurately. The private paths — `/api/`, `/auth/`,
`/login`, `/workspace`, `/customers`, `/research/experiments`, the retired stubs and `/dev/` — are withheld from every group alike.

User-triggered fetchers (`Claude-User`, `ChatGPT-User`) are allowed by `*`. A fetch a person asked
for is a visit.

## What is disallowed

| Token | Operator | Why |
|---|---|---|
| `Bytespider` | ByteDance | Kept blocked by GX-01 |

## What this policy is not

- **It is not access control.** Every line in `robots.txt` is a request. An operator that ignores
  it is not stopped by it. What keeps a customer document from any crawler is authorization, not
  this file.
- **It is not a licence.** Allowing a crawler to read a page grants nothing about the copyright in
  its copy. The `LICENSE` at the repository root is unchanged.

## Still open

- **Tokens nobody has ruled on**: `Amazonbot`, `Diffbot`, `Omgilibot`, `Timpibot`, `PanguBot`. They
  fall to `*` today, which allows the public surface. A named rule for any of them is a new decision.
- **Whether to enforce rather than ask.** A rate limit or an edge rule is the only thing that makes
  a refusal binding. None exists, and this file does not imply one.

## Where this is stated

`robots.txt` itself is the authoritative implementation and `public/llms.txt` repeats it in one
paragraph. The two are changed together with this file.
