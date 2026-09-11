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
 * The label is the other half, and it is inside the constant rather than beside it. FD-09 is a
 * delegated decision, 2026-09-11 (orchestrator, under the founder's delegation) -- the same
 * standing as the DPA's three commitments, the 72-hour incident window and the pentest
 * sequencing, every one of which carries the pending-confirmation label on the page that states
 * it. This one did not, which made it the only delegated commitment on the site reading as
 * settled. Keeping the label in the string means the two pages cannot render the target without
 * it, which is the same reason the DPA's label lives inside its anchor.
 */
export const SUPPORT_ACKNOWLEDGEMENT =
  "Email to support@tavonel.com is acknowledged within 1 business day (KST). That is an acknowledgement target and not a resolution time: no resolution time is committed, and security reports to security@tavonel.com are read first rather than queued behind product questions. The target is a delegated decision pending the founder's confirmation (decision log, FD-09).";
