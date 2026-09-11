# Q05 — human-review rubric: locator correctness and evidence entailment, scored separately

Audit Q05: *"정확한 페이지·bbox를 가리키더라도 그 영역이 답변의 주장을 실제로 뒷받침하는지는 별도의
의미 검증이 필요하다."* Completion bar: separate locator correctness from evidence entailment and
publish a human-reviewed sample with an error-type breakdown.

Status: **IMPLEMENTED_NOT_PROVEN** for the harness and the export; **NOT DONE** for the review
itself. Nobody has scored a row. The numbers this rubric produces do not exist yet, and no public
claim may cite them until a person has filled the CSV in and a second person has checked a slice
of it.

## Why two columns and not one

Nothing in this repository checks entailment. `world-gate.ts` says so in its own header — it tests
eligibility (tenant, active world, superseded version, evidence bound) and explicitly not temporal
validity, authority or contradiction. `context-packet.ts`'s `verifyGroundedCitations` checks that a
cited evidence id exists in the packet, which is a referential-integrity check, not a semantic one.
`grounded-ask.ts` and `retrieval-pipeline.ts` validate that a bbox is well formed, never that the
pixels inside it support the sentence above it.

So a citation can fail in two unrelated ways, and collapsing them into one "correct / incorrect"
column destroys the only information a reviewer adds:

- **Locator correctness** — does the (document, page, region) actually contain the text the system
  showed? This is checkable mechanically for region identity, and by eye for "is this the block the
  excerpt came from".
- **Evidence entailment** — does that region's content actually support the claim the answer makes?
  A perfectly correct locator pointing at a region that discusses a different period, a different
  segment or a different company is a locator hit and an entailment miss.

No automated entailment classifier is to be built for this. An uncalibrated entailment score is
exactly the kind of scalar the project constitution bars routing or claiming on, and choosing a
classifier is an Arena decision, not a lane decision.

## The sample

`Q05_human_review_sample-<date>.csv`, exported by `nextjs/eval/ask-eval/run.harness.test.ts`.

- One row per returned citation, both paths interleaved, capped at 100 rows. The header names the
  cap; a short file is a short file and must be reported with its real row count, never as "100
  samples".
- `is_gold_region` is pre-filled from the question set's gold locators. It is a hint for the
  reviewer, not a score: a citation that is not a gold region can still entail the answer (the gold
  set names regions that *do* contain the answer, not every region that could).
- The three reviewer columns arrive empty on purpose.

## How to score a row

Fill exactly three columns. Do not edit any other column.

### `locator_correct__reviewer`

| value | meaning |
|---|---|
| `yes` | Open the cited document at `cited_page`. The excerpt shown for this citation is the text of the region at `cited_region`. |
| `page_only` | The page is right; the region/block is the wrong one on that page. |
| `no` | Neither the page nor the region matches the excerpt. |
| `unknown` | The cited region could not be located at all (missing page, malformed locator). Say why in the note. |

### `evidence_entails_answer__reviewer`

Judge the cited region against *the question*, since neither path generates prose: the "answer" is
the cited excerpt. Ask: **if a colleague read only this region, could they answer this question
correctly?**

| value | meaning |
|---|---|
| `supports` | The region contains the fact the question asks for, for the right entity, period and unit. |
| `partial` | The region is about the right thing but does not carry the value asked for (e.g. the narrative sentence beside the table, not the table). |
| `contradicts` | The region carries a value for a *different* period, entity, segment or unit that a reader would mistake for the answer. This is the dangerous class. |
| `unrelated` | The region has nothing to do with the question. |

For a row whose `kind` is `unanswerable`, `supports` is never correct: the corpus cannot answer the
question. The only useful judgement there is `contradicts` (a reader would be misled) versus
`unrelated` (obviously off-topic). Record which, because they have very different customer cost.

### `error_type__reviewer`

Leave blank when both columns above are clean. Otherwise pick the single closest tag:

`wrong_period` · `wrong_entity` · `wrong_segment_or_unit` · `right_page_wrong_block` ·
`narrative_instead_of_table` · `table_row_misaligned` · `header_or_footer_only` ·
`table_of_contents_instead_of_content` · `other` (explain in the note)

## What gets published, and what does not

Publish, per path:

- the row count actually scored, as the denominator of every rate below;
- locator correctness distribution (`yes` / `page_only` / `no` / `unknown`);
- entailment distribution (`supports` / `partial` / `contradicts` / `unrelated`);
- **the disagreement rate**: rows where `locator_correct = yes` and
  `evidence_entails_answer ∈ {contradicts, unrelated}`. This is the number Q05 exists to produce —
  the share of citations that are provably in the right place and still do not support the answer;
- the error-type breakdown, weakest rows included.

Do not publish an average of the two columns, a single "citation quality" score, or any rate whose
denominator is not the scored row count.

## Review integrity

- The session that built the harness does not score its own output. This is the project's
  self-approval rule, and it applies here without exception.
- Two reviewers on an overlapping slice of at least 20 rows; report raw agreement per column. One
  reviewer's numbers are a reading, not a measurement.
- Reviewer identity, review date, and the corpus manifest digest go in the published table. The
  digest is in the run report (`ask-eval-<date>.json` → `corpusManifestDigest`).
- **Founder decision required before publication**: sample size, who reviews, and whether any of
  this becomes a public claim. This becomes a quality statement about the product the moment it
  leaves the repository.
