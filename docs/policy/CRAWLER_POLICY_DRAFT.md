# Crawler policy — DRAFT (2026-09-11)

**Status: DRAFT. Nothing here is in force.** `nextjs/app/robots.ts` is the only file that
decides anything, and it is unchanged by this document. Two of the three sections below are a
founder decision; the third is already settled by other means and is written down so it is not
re-decided by accident.

Source: website-growth blueprint §12.5 (`OAI-SearchBot과 학습 crawler는 목적이 다르므로 정책을
따로 결정한다`) and WG-080. Upper bound on every sentence here: the repository `CLAUDE.md`
(evidence rules, "what is not an agent's call"). Where this draft and `CLAUDE.md` could be read
differently, `CLAUDE.md` governs.

---

## 1. What is already true (not a decision)

Measured 2026-09-11 against the live site (`curl -s https://tavonel.com/robots.txt`) and against
`nextjs/app/robots.ts` on `agent/wg-base` @ `38d957d`:

| Fact | Where it is enforced |
|---|---|
| Four `User-Agent` blocks: `OAI-SearchBot`, `PerplexityBot`, `Googlebot`, `*` | `app/robots.ts` `SEARCH_CRAWLERS` + the `*` rule |
| All four carry the **identical** `Disallow` set, so no crawler has broader access than the default | `lib/seo-surface.test.ts` — "gives every named crawler the same private list as `*`" |
| No training-crawler token appears at all (`Google-Extended`, `GPTBot`, `CCBot`, `ClaudeBot`, `anthropic-ai`, `Applebot-Extended`) | `lib/seo-surface.test.ts` — "takes no position on training crawlers" |
| A customer document, a workspace and every API route are unreachable to any crawler **by authorization**, not by `robots.txt` | Session/tenant checks on `/workspace` and `/api/*`; `robots.txt` only spares a crawler the walk |
| Only approved pages are advertised; a draft page declares `robots: { index: false }` and is absent from `sitemap.ts` | `lib/seo-surface.test.ts` — "the sitemap advertises only approved pages" |
| `llms.txt` is a reading map, not a ranking signal, and says so in its own header | `nextjs/public/llms.txt` |

**The consequence that must not be lost in the decision below:** blocking a crawler is not access
control, and allowing one is not exposure of anything private. Customer documents are behind
authorization in both cases. A `robots.txt` line changes only what a compliant crawler reads of
the *public marketing site*.

---

## 2. Decision 1 — training crawlers (FOUNDER)

The question: should `robots.txt` name the training tokens, and with what rule?

| Option | What it means | Cost |
|---|---|---|
| **A. Stay silent** (today) | Training crawlers fall under `*`: public pages readable, private paths withheld | No new signal either way. The status quo is *permission by silence*, which is a decision made by not making it |
| **B. Disallow training tokens, allow search tokens** | Public copy stays findable in search and in AI answers that crawl for retrieval; it is withheld from corpora used to train models | Some assistants use one user-agent for both purposes; refusing it can remove the site from that assistant's answers as well |
| **C. Allow everything explicitly** | Same effect as A, stated | Publishes an intention the company has not formed |

What is **not** an input to this decision: any belief that allowing a crawler improves the odds of
being cited. Blueprint §12.5 and the repository rule agree — crawler access guarantees no
recommendation and no citation, and no measurement in this repository says otherwise.

Needed from the owner: a yes/no per token class (search vs. training), and whether legal counsel
should see it first. `IP`/publication questions already sit with the founder per `CLAUDE.md`.

## 3. Decision 2 — AI-assistant visibility measurement (FOUNDER, smaller)

Blueprint §12.5 also asks for a baseline check of how assistants describe TAVONEL, through the
existing AEO prompt set and only by permitted manual methods. **No baseline has been run.** Until
one is, nothing in this repository may state a monthly measurement or a visibility trend: an
unrun measurement described as complete is the same defect as a claim without a receipt.

Needed from the owner: whether to run the manual baseline at all, and who holds the result.

---

## 4. Internal evidence is never a public indexed surface (WG-042, not a decision)

Blueprint §12.1 puts internal proof artifacts outside the public index, and §7.4 lists what the
Model Arena's own data may and may not be used for. Restated here as **publication rules**, which
is the half this lane touches; the evidence standard itself is `CLAUDE.md` plus §7.4 and is not
restated, weakened or tightened here.

1. **A corpus already analysed is not new validation data.** A page may not present a repeated
   run over a known corpus as an independent result, and no such page may be added to
   `sitemap.ts` or `llms.txt`.
2. **A gold-selected oracle is an upper bound, not a router result.** Oracle output is not
   published as product behaviour, and an oracle figure never appears in public copy as an
   achieved number.
3. **Held-out evaluation labels stay away from product and marketing work.** Public samples and
   the internal evaluation corpus are separate sets; a public page never renders a held-out
   label, and the separation is what keeps `/explore` a read-only fixture.
4. **Repeated runs measure runtime variability, not corpus size.** Repeat counts are never
   presented as independent documents, and p95 is not published from a sample too small to
   support it — an individual timing with its scope is published instead.

Implementation consequence today: the four rules need no new file and no new flag. A page
carrying any of that material is unapproved copy, which means `robots: { index: false }` and
absence from `sitemap.ts` — and `lib/seo-surface.test.ts` now fails if such a page is advertised
while its own head refuses indexing.

---

## 5. What this draft does **not** decide

- Any change to `app/robots.ts` (section 2 must be answered first).
- Whether a customer document could ever be public: it cannot, and that is authorization, not
  crawler policy.
- Publication of any claim, number or benchmark comparison — `CLAUDE.md` and the claims registry
  govern that, and neither is amended here.
