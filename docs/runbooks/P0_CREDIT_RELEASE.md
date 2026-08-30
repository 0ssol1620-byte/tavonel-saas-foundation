# P0 terminal failure and operator-review credit release

## Invariant

`failed_terminal` and `operator_review` release the complete reservation with `outcome=released` and `actualCredits=0`. An explicit retry creates a new reservation. Review is not billable completion.

## Procedure

1. Confirm a terminal receipt and an allow-listed reason code. A timeout still being retried is not terminal.
2. Serialize `{ workspaceKey, documentId, terminalState, reasonCode }` exactly once.
3. Sign the request with the existing billing settlement HMAC headers and send it to `POST /api/operations/p0/credits/release`.
4. Store `releaseKey`, ledger reservation ID, ledger status and reason code in the incident record.
5. Treat `processed` and `duplicate` as successful idempotent outcomes. Investigate all other responses; never retry with a different reason merely to force success.
6. Tell the customer that no processing credit was consumed and that retry requires an explicit new run.

## Controls

The endpoint accepts only the existing five-minute HMAC request window, UUID identities, known terminal states and allow-listed reason codes. It cannot settle a successful job or debit credits.
