# CDR request and converter boundary qualification — 2026-09-09

Status: locally verified candidate; this document is not a production deployment receipt.

## Changes

- Authenticate signed disarm requests before multipart parsing or temporary-file spooling.
- Bound the complete request to the existing 5 MiB file allowance plus 64 KiB of multipart framing; retain the separate file-content ceiling.
- Bound body receipt to 15 seconds, reject ambiguous headers and length mismatches, and return non-cacheable refusals.
- Retain each authenticated request nonce for the remaining signature validity window, including the already-permitted future clock skew. This remains process-local, not durable replay protection.
- Reject malformed/non-ASCII signatures as authentication failures rather than uncaught comparison errors.
- Start LibreOffice with an allowlisted environment and an escaped file URI. Authentication/provider environment variables are not inherited. This does not claim complete process/container isolation.
- Include the new middleware module in the service image.

## Evidence

The initial regression ran against the unchanged service and failed: the unauthenticated multipart request returned 422 after reaching parsing rather than an early 401.

After the changes, the locally runnable suite completed with **70 passed, 1 skipped, 45 subtests passed**. The single skip is the pre-existing EICAR host-antivirus exception. Local tests use a socket-protocol scanner fixture; they are not a real ClamAV deployment qualification.

Command from repository root:

```text
python -m pytest quarantine-sidecar/cdr-cloudrun/tests --ignore=quarantine-sidecar/cdr-cloudrun/tests/test_office_conversion.py --ignore=quarantine-sidecar/cdr-cloudrun/tests/test_malware_clamd.py -q -rs
```

The unchanged malware-scan-qualification workflow must separately run the service image with the pinned real ClamAV sidecar, Linux Office conversion, renderer licensing checks and scanner-stopped refusal. No assertion or deployment limit has been loosened.

## Release boundaries

A Cloud Run image build is not a traffic cutover. Bind the deployed revision and both image digests, verify networking and identity, then exercise signed harmless input, EICAR and scanner failure before describing the active pipeline as qualified. Customer-data approval remains independent and is not enabled by this change.
