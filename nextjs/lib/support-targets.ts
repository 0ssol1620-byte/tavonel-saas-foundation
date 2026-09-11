/**
 * The one published support target, written once.
 *
 * Two pages carry it -- `/status` under Incident contact and `/contact` beside the addresses --
 * because those are the two places a customer looks for it, and a sentence written twice is a
 * sentence that will disagree with itself. `support-targets.test.ts` holds that both pages render
 * this constant rather than a copy of its words.
 *
 * It is an *acknowledgement* target and nothing else. `docs/policy/SUPPORT_TARGETS.md` records
 * why: the team is one person, there is no rota, no pager and no ticketing system, and a
 * resolution time depends on the bug rather than on anyone's willingness to commit to it. One
 * business day rather than 24 hours, because the two differ by a weekend and the weekend is
 * exactly when the promise would break.
 *
 * FD-09 in `docs/policy/DECISION_LOG_2026-09-11.md` is where the number came from: a delegated
 * decision, 2026-09-11 (orchestrator, under the founder's delegation). That provenance is a
 * comment and not copy. The log's "Public wording of delegated values" section says a stated
 * commitment carries no process label on a public page -- a customer reading a support target
 * needs the target, not the decision's paperwork -- and the founder's merge of the pull request
 * carrying the log is the confirmation.
 */
export const SUPPORT_ACKNOWLEDGEMENT =
  "Email to support@tavonel.com is acknowledged within 1 business day (KST). That is an acknowledgement target and not a resolution time: no resolution time is committed, and security reports to security@tavonel.com are read first rather than queued behind product questions.";
