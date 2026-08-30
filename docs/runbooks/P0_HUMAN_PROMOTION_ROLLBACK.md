# P0 human promotion and rollback

## Separation of duties

Promotion and rollback are browser-session-only, four-eyes changes. The requester and approver must be different authenticated operators. API keys, CLI, MCP, workers and scheduled jobs may generate candidates but may not approve or promote them.

## Promotion

1. Freeze the candidate digest and current world digest.
2. Review source coverage, unresolved references, OCR review items, ontology changes and signed package verification.
3. Record the requester's rationale and a separate approver's decision.
4. Re-read the active world immediately before compare-and-swap promotion.
5. Promote only the reviewed candidate digest. Store the resulting world digest and immutable change ID.
6. Run grounded retrieval and source-link smoke checks. If either fails, begin rollback.

## Rollback

1. Freeze writes to the affected world and identify the last approved previous digest.
2. Require a separate approver and a reason of at least 12 characters.
3. Use compare-and-swap rollback; never overwrite a newer world silently.
4. Verify that the resulting digest exactly equals the previous approved digest.
5. Re-run retrieval, source-link and signed-export smoke checks before reopening writes.

## Evidence gate

`validateHumanChangeEvidence` requires UUID change identity, workspace scope, different requester and approver, reason, candidate/previous/result digests and approval time. For rollback, the resulting digest must exactly match the previous digest. Automated tests do not replace founder or operator approval.
