# ADR-0002 — Where a large archive is expanded

- **Status:** Proposed. Nothing in this document is implemented.
- **Date:** 2026-09-04
- **Branch this was written on:** `agent/industry-leadership-v3`
- **Decision owner:** founder, because it needs an isolation boundary that does not exist yet.

## The question

The Production Masterplan's target architecture for archives is two paths:

    small / medium ZIP  →  Web Worker in the browser
    large ZIP           →  direct upload  →  isolated server-side extraction

Only the first exists. This ADR says what the second requires and why it was not built on this
branch.

## What exists today

`lib/archive-expand.ts` holds every guard, and they run against the ZIP central directory
**before** a byte is expanded: path traversal, absolute and drive-letter paths, encrypted
entries, nested archives, the file count, the total expanded size and the per-entry
compression ratio. A bomb is refused on its own declared numbers rather than survived.

`lib/archive-worker.ts` runs the expansion off the main thread. Cancellation is cooperative
and checked between entries, which is the finest granularity `unzipSync` offers.

Three ceilings, all in one file:

| Constant | Value | What it describes |
| --- | --- | --- |
| `MAX_SYNC_ARCHIVE_BYTES` | 25 MB | the fallback path, when no worker is available |
| `MAX_WORKER_ARCHIVE_BYTES` | 200 MB | what a worker may hold, bounded by memory |
| `MAX_EXPANDED_BYTES` | 500 MB | total expansion, whichever path ran |

Above 200 MB the product answers `ARCHIVE_TOO_LARGE` and stops. Nothing is silently truncated
and nothing half-expands: the ceiling is a refusal, not a defect.

## Why the server path was not built here

Not because it is large. Because "isolated" is the load-bearing word and there is nowhere
isolated to put it.

Expanding a hostile archive means running a decompressor over attacker-controlled bytes. The
constitution's rule is that every document is hostile data and the components that parse it
get no tools, no broad credentials and no outbound network. A Next.js route handler on the
current deployment has the service-role key in its environment and unrestricted egress. Doing
the expansion there and calling it isolated would be false in the one word that matters.

There is a second, quieter problem. A 200 MB archive that expands to 500 MB has to be held
somewhere while it is inspected, and a serverless function's memory ceiling makes that a
capacity decision — how much memory, on what plan, at what cost — that is a founder's, not an
agent's.

So this branch does not ship a server extractor, and does not describe the ZIP work as
satisfying the masterplan. The traceability entry is split accordingly:
main-thread freeze prevention is verified; large-archive server-side extraction is missing.

## Design, for when it is built

### Threshold

`MAX_WORKER_ARCHIVE_BYTES` becomes the routing threshold rather than the refusal point:
at or below it, the browser worker; above it, direct upload and server extraction. The
number does not change meaning — it still describes what a worker may hold — and the
behaviour above it changes from a refusal to a different path.

### Upload

The archive is uploaded to object storage with the existing signed-upload path, under a
quarantine prefix that no reader other than the extractor is granted. It is never expanded in
the request that uploads it.

### The extraction job

A new durable job type in the `foundation_compile_jobs` family, or its own table if the state
model diverges — `queued`, `inspecting`, `expanding`, `ready`, `failed`, `cancelled` — with
the same rules the compile job already has: terminal is terminal, delivery is at-least-once,
the worker ACKs only after its output is durable and a receipt is committed. Progress is
event rows, so a reconnecting tab replays rather than re-derives. Cancel is a state
transition the worker observes between entries, exactly as the browser worker does now.

### The guards

`inspectCentralDirectory` and `expandArchive` are already pure and run identically in a worker
and in Node. The server path calls the same functions. A guard that exists in two
implementations is a guard that will eventually exist in one, and it will be the wrong one.

### Output

Extracted members are written as documents under the workspace's normal prefix with their
relative paths preserved, so the hierarchy the customer packed is the hierarchy they see. Each
member gets its own sha256 and its own row; nothing is concatenated.

### Isolation, which is the actual prerequisite

The extractor runs somewhere with no service-role credential, no outbound network and a hard
memory and CPU bound — a separate service with a narrow, single-purpose credential that can
write only to the quarantine prefix and read only the object it was handed. Standing that up
is infrastructure work with a cost, and the constitution requires an ADR and a measured
bottleneck before new infrastructure. This document is the first half of that; the measurement
and the decision are the founder's.

## Consequences of not building it

Archives above 200 MB are refused with a clear code. Customers with larger archives split them
or use a connector, which is what the current copy says. No page claims a larger ceiling.

## Consequences of building it as designed

The browser stops being the only place hostile archives are opened, which is a security
improvement and a new attack surface at the same time. The isolation requirement above is what
makes it the first rather than the second, and it is not optional.
