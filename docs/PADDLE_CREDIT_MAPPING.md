# Paddle Sandbox Credit Mapping

The following is a **mapping specification**, not a configured Paddle catalog. All Paddle price IDs remain `null` until the dedicated sandbox account, webhook destination, and server-only secrets are explicitly configured.

| Product code | Commercial offer | Credits issued | Required verified Paddle event |
|---|---|---:|---|
| `observer_access` | $29/month governed workspace access | 0 recurring GPU credits | `subscription.created` or a newer `subscription.updated` with active status |
| `studio_access` | $99/month governed team access | 0 recurring GPU credits | `subscription.created` or a newer `subscription.updated` with active status |
| `credit_starter` | $12 one-time prepaid pack | 100 | `transaction.paid` bound to expected workspace and catalog price |
| `credit_builder` | $30 one-time prepaid pack | 300 | `transaction.paid` bound to expected workspace and catalog price |
| `credit_scale` | $75 one-time prepaid pack | 800 | `transaction.paid` bound to expected workspace and catalog price |

Credits are not issued from a checkout success redirect. The webhook handler must verify the raw-body signature, atomically insert `event_id` before any balance change, verify the server-maintained price allow-list and workspace binding, and compare `occurred_at` with the existing projection. Duplicate, stale, unrecognized price, canceled, refunded, or chargeback-related events must not create reusable GPU capacity.

The ledger must distinguish `purchased`, `reserved`, `settled`, `released`, `expired`, and `reversed` credits. Before a future RunPod request, the service reserves the maximum allowed job credits. After an independently verified completion it settles only the observed rounded-up usage and releases the remainder. An ambiguity, timeout, or margin-floor breach creates no automatic retry; it moves the ledger entry to an operator-review state.

No one-time pack should be sold below $10 without a separate Paddle pricing discussion, and all prices must be verified against the live provider catalog at the point of sandbox configuration.[1]

## Reference

[1]: https://www.paddle.com/pricing "Paddle pricing"
