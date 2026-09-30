# Running the TAVONEL local source agent

Status: `IMPLEMENTED_NOT_PROVEN`. Local deterministic tests do not qualify a real customer installation, production ingestion, or downstream automatic publication. The public document-processing and customer-data gates remain unchanged.

## Scope and setup

The agent reads only the explicitly selected local/mounted root or S3-compatible bucket/prefix. It does not obtain filesystem or cloud access by connecting MCP. Mounted SMB/NFS/SFTP must already be available to the host. S3/R2/MinIO uses the host's authorized boto3 credential chain.

Requirements: Python 3.12+, outbound HTTPS to the configured Foundation and its signed upload destination, and boto3 only for S3 mode. Verify the script against `sourceAgent.sha256` in `channel.json` before running. This source change updates the distribution manifest; it does not mean a new version is already deployed.

Create the exact connection in the workspace and use its UUID. API credentials are read only from `TAVONEL_API_KEY`, never command-line flags or state. Keep state outside the source root and protect its directory. State, pending journal and lock contain private inventory metadata and must not be shared.

```sh
python3 tavonel-source-agent.py --root /approved/documents \
  --connection-id YOUR_CONNECTION_UUID --state /private/agent/state.json
```

Only an already-authorized environment variable supplies the key. Do not paste keys into documents, shell history or support logs.

## One-shot and continuous modes

Default execution performs one reconciliation and exits. `--watch` repeats with a minimum one-second interval; default `--poll-seconds` is 30. `--max-cycles N` bounds a test or scheduled session; zero means repeat until stopped when watch is enabled.

```sh
python3 tavonel-source-agent.py --root /approved/documents \
  --connection-id YOUR_CONNECTION_UUID --state /private/agent/state.json \
  --watch --poll-seconds 30 --max-cycles 10
```

This is continuous inventory reconciliation, not an OS event watcher. Interval is not end-to-end knowledge freshness: scanning, upload, server processing and publication add latency. The agent does not automatically activate a candidate World, bypass review, or change production flags. There is no server-side liveness monitor in this change. Host uptime, scheduling and alerting remain operator responsibilities.

A service manager may restart a stopped agent, but installing such a service or granting ongoing access is a separate user-authorized step. No service is installed by running the one-shot command.

## Durable commit and recovery

Each cycle validates its state, scans the complete source inventory and computes added/changed/deleted events. Supported changed files are uploaded using stable source idempotency keys. Before the sync POST, the agent atomically persists the exact batch UUID, body, manifest, source binding and resulting inventory in a private `.pending` journal.

It advances cursor state only after the server returns `applied` or `replayed`. If the server committed but its response was lost, the next attempt replays the same batch before scanning new input. If state was written but journal deletion failed, restart recognizes the already-committed cursor. Do not delete a pending journal to recover from an unknown server outcome.

A state fingerprint binds the API URL and source root or bucket/prefix/endpoint. A changed scope fails closed; create a separate approved connection/state. Legacy state without a fingerprint requires `--adopt-legacy-state` after an operator verifies the original source and API target. This option does not approve a new scope.

The lock uses OS advisory locking, is released on process exit, and prevents concurrent local writers of the same state file. It is not a distributed multi-host lock. Use one agent instance per connection; keep state on a reliable local filesystem. Cross-host orchestration is not implemented here.

## Bounded retries and costs

`--retry-limit` defaults to 3 and allows 0–10 additional attempts per cycle. Only transient HTTP 408/429/5xx and network errors are retried with capped exponential backoff. Authentication, scope, invalid journal, unsupported server responses and cursor conflicts stop the process. Exhausting retries also stops, preserving state and pending journal.

`--max-events` is 1–5000; `--max-upload-bytes` defaults to 512 MiB per cycle; `--max-file-bytes` remains a local upper bound. Server plan/file limits still apply and may be lower. Inventory change count and supported upload bytes are checked before upload. A final bounded manifest check prevents oversized sync submission. These are input budgets, not a complete downstream OCR/LLM credit reservation system.

The process prints one JSON result per completed cycle and sanitized retry/failure status. Failed main execution returns nonzero with `SOURCE_SYNC_FAILED`; no raw HTTP body or traceback is printed by main. Interrupt exits 130. Investigate configuration and server status through authorized tools, never expose credentials in support output.

## Deletions and incomplete listings

A permission error in a mounted-directory walk aborts reconciliation rather than turning unlisted files into deletions. Symbolic links are skipped, paths outside the selected root are refused, and file metadata is checked during hashing. Repeated/missing S3 continuation tokens abort the inventory.

An empty inventory following a nonempty one is refused by default, protecting against an unavailable mount or unexpected listing. `--allow-empty-snapshot` permits this deletion/suspension batch only after the source is verified. It remains an operator decision, not automatic confirmation that every original file was deleted. The agent never deletes the customer's original files.

The server decides how deleted sources are suspended. This change alone does not prove cache invalidation, derived-data deletion, backup erasure or instantaneous ACL revocation. S3 listing uses ETags as provider revision markers, not byte hashes; content is hashed after download. Offline and provider-delayed changes cannot be reflected instantly.

## Offline verification

```sh
python3 -m unittest discover -s scripts/source-agent -p 'test_*.py' -v
```

The suite covers unchanged sync, lost response and exact replay, scope changes, empty inventories, permission failure, symlink skipping, state outside source, budget preflight, explicit legacy adoption, local lock exclusion, bounded watch and retry, repeated S3 cursor and journal tampering. It uses temporary synthetic files and a mocked client; no live credentials, uploads or daemon are needed. The Vitest suite invokes these tests through `lib/source-agent-runtime.test.ts`.

Before production: verify supported Python/platform locking, actual source size distribution, storage permissions, partial connectivity, exact deployed API contracts, downstream compilation, ACL/deletion and billing. Keep the `IMPLEMENTED_NOT_PROVEN` status until the selected customer environment passes that qualification.

## Additional transfer safeguards and remaining identity work

Authenticated POSTs and uploads refuse redirects so credentials and source bytes cannot be replayed to another origin. Hashing uses bounded descriptor reads; mounted uploads use a sealed copy checked against the inventory digest. S3 requires an explicit boolean completeness marker, validated entries and revision-conditional reads, and preserves the original key basename in upload metadata.

The current source upload key includes source revision, so a connector edit creates a new immutable Foundation document UUID. This agent improvement does not by itself establish stable logical connector-document lineage through compilation. That needs an explicit logical-source-to-immutable-version mapping with ACL and billing preservation. Do not reuse an old quarantine object/document ID for new bytes just to force identity stability.
