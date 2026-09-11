# Running the TAVONEL local source agent

Audit item **I04**. This runbook describes `tavonel-source-agent.py` as it is written today,
not as it is intended to work. Every behavioural statement below was read off the script; where
the script does nothing, this document says so instead of describing a feature.

- Script: `https://tavonel.com/developer/tavonel-source-agent.py`
- Distribution record: `https://tavonel.com/developer/channel.json`
- Version at the time of writing: channel `2026.9.3.1`, released `2026-09-03T00:00:00Z`
- Agent sha256: `f8d4bbd8fa622d65812f31a8359ede04bac6d886d5dead3fa46e89d18b9fc7c4`

Status: `IMPLEMENTED_NOT_PROVEN`. The script is real and shipped; no customer-run install of it
has been qualified end to end on real infrastructure, and no operating figure from a customer
run exists.

---

## 1. Who is responsible for what

The agent runs on the customer's machine, inside the customer's network, holding the customer's
storage credentials. That division is the point of the assisted route and it is not negotiable
by configuration:

| | Responsibility |
|---|---|
| **You** | The host the agent runs on, its uptime, its scheduler, the mount or bucket credentials, the `TAVONEL_API_KEY` value, the state file, upgrading the script, and noticing a failed run. |
| **TAVONEL** | The API the agent calls, the upload capability it is issued, the cursor commit, and everything downstream of the upload. |

There is no TAVONEL-side monitor that notices your agent has stopped. If the scheduled run
stops running, nothing new is imported and nothing alerts. Connection health as shown in
Workspace reflects the last batch the Foundation accepted, so an agent that stopped yesterday
looks like a connection that has had no changes since yesterday.

## 2. Install

Requirements, from the script and the channel record:

- Python **3.12** or newer (`minimumPython` in `channel.json`). Standard library only for the
  mounted-directory mode.
- `boto3`, installed by you, **only** for S3-compatible mode. The script raises
  `S3/R2/MinIO mode requires: python -m pip install boto3` and stops if it is missing.
- Outbound HTTPS to `tavonel.com` and to the object-storage host named in each upload
  capability. No inbound ports.

Steps:

1. Download the script and verify it against the sha256 in `channel.json` before running it.
2. Create the connection in Workspace → Connections and copy its UUID. That UUID is the
   `--connection-id` argument; the agent refuses a state file bound to a different one.
3. Create a developer API key and put it in the environment as `TAVONEL_API_KEY`. The agent
   reads it from **that variable only** — there is no key file and no command-line flag — and
   refuses to start unless the value begins with `tvnl_live_`.
4. Choose a path for `--state`. The agent creates the parent directory if needed and writes the
   file with mode `0600` through a temporary file and an atomic rename.
5. Run once by hand and read the single line of JSON it prints.

Mounted directory:

```
TAVONEL_API_KEY=tvnl_live_... python3 tavonel-source-agent.py \
  --root /mnt/share/contracts \
  --connection-id 00000000-0000-0000-0000-000000000000 \
  --state /var/lib/tavonel/contracts.json
```

S3-compatible bucket:

```
TAVONEL_API_KEY=tvnl_live_... python3 tavonel-source-agent.py \
  --s3-bucket my-bucket --s3-prefix contracts/ --s3-region auto \
  --s3-endpoint-url https://<account>.r2.cloudflarestorage.com \
  --connection-id 00000000-0000-0000-0000-000000000000 \
  --state /var/lib/tavonel/bucket.json
```

`--root` and `--s3-bucket` are mutually exclusive and one is required.

## 3. Permissions the agent needs, and the ones it must not have

- **Read** on every file under `--root`, and read on the directory tree to list it. Read is
  enough: the agent never writes to your mount.
- For S3 mode, `ListObjectsV2` and `GetObject` on the bucket and prefix. Credentials are
  resolved by `boto3` from the host's own environment or shared credential file — the agent
  neither reads nor transmits them.
- The agent follows no symbolic links (it skips them) and refuses a path that resolves outside
  the root it was given.
- The base URL must be HTTPS. Plain HTTP is accepted only for exact loopback addresses, for
  tests. A URL carrying a username or password is refused.
- Grant the API key the narrowest scope your workspace allows. The key is a bearer credential
  sitting on your host; treat it like a storage credential.

## 4. What one run actually does

One invocation performs exactly one sync and exits. It is **not** a daemon and it has no
internal schedule, timer or poll loop.

1. Reads the state file, or starts from empty if it does not exist.
2. Lists the source. A mounted directory is walked and every file is hashed (SHA-256, streamed
   in 1 MiB chunks); an S3 prefix is listed page by page and the object ETag is used as the
   revision, so **S3 mode does not hash an object it has not had to download**.
3. Diffs against the previous state and builds `added`, `changed` and `deleted` events.
4. Uploads the bytes for each added or changed file whose extension is in the agent's MIME
   table, direct to a short-lived object-store URL the Foundation issues. Source bytes do not
   pass through the TAVONEL application.
5. Posts the batch to `/api/v1/connections/<id>/sync` and requires the response status to be
   `applied` or `replayed`.
6. **Only then** writes the new state file and prints one JSON line.

The printed line is the run record: `{"status":"applied","eventCount":3,"batchId":"..."}` or
`{"status":"unchanged","eventCount":0}`.

### Files it will not upload

Only these extensions are uploaded: `.docx`, `.gif`, `.jpeg`, `.jpg`, `.odp`, `.ods`, `.odt`,
`.pdf`, `.png`, `.pptx`, `.tif`, `.tiff`, `.xlsx`. A file with any other extension is still
tracked in the cursor — so it is counted, and its deletion is reported — but its bytes are never
sent and it carries no document. If you expect a file to be compiled and it is not, check its
extension against that list first.

A file larger than `--max-file-bytes` (default 512 MiB) **aborts the whole run** with an error.
It is not skipped. Raise the flag deliberately or move the file out of the tree.

## 5. Restart, interruption and network outage — as coded

- **The state file is written only after the Foundation has committed the batch.** A run that
  dies at any earlier point — killed process, host reboot, dropped connection, HTTP error —
  leaves the state file exactly as it was.
- Consequently the next run recomputes the same diff and sends it again. Per-file upload keys
  are derived from `(connection id, path, revision)` and are therefore identical across the
  retry, so a repeated upload resolves to the same document rather than a duplicate; the sync
  call is accepted as `applied` or `replayed`.
- **There is no retry inside the agent.** A network outage, a 5xx, a timeout (default 60 s), an
  oversized response or invalid JSON all raise and the process exits non-zero with a Python
  traceback. Nothing waits and nothing backs off. Whatever schedules the agent is what retries
  it, so schedule it on an interval you are willing to call your recovery time.
- A file whose size or mtime changes while it is being hashed or uploaded aborts the run with
  `changed during scan` / `changed during upload`. Rerun after the writer has finished.
- If the state file is corrupt, bound to a different connection id, or carries a malformed
  cursor, the agent refuses to run rather than resyncing from zero. Delete the state file only
  if you intend a full re-scan.
- **Nothing is deleted on your side, ever.** A `deleted` event tells TAVONEL a file is gone from
  the source; on the TAVONEL side the bound source is suspended and stops being used, which is
  described on the privacy page.

## 6. Scheduling it

The agent must be driven by something outside itself. Two shapes, no third:

- **cron / systemd timer.** Run the command on the interval you want. Because the agent exits
  non-zero on failure, systemd's `OnFailure=` or cron's mail-on-error is the whole alerting
  story unless you add one.
- **Windows Task Scheduler.** Same, with "Start a program" and the exit code as the signal.

Do not run two agents against one connection id concurrently. The state file is per connection
and the cursor is a chain; two writers will fight over it, and the losing run fails rather than
corrupting the cursor, which is safe but useless. Overlap is the usual cause, so set the
interval longer than a full run takes on your corpus.

## 7. Updating

`channel.json` is the distribution record. It carries the current version, the minimum Python,
and the URL and sha256 of each asset, including `sourceAgent`.

1. Fetch `https://tavonel.com/developer/channel.json`.
2. Compare its `version` with the one you installed, and its `minimumPython` with your host.
3. If newer, download the `sourceAgent.url`, verify the file against `sourceAgent.sha256`, and
   replace the script. Do not replace it without checking the hash.
4. Keep the state file. Its schema version is `tavonel.public-source-agent.v1`; the agent
   refuses a state file whose schema it does not recognise, which is how you find out that an
   upgrade changed the format.

There is no self-update, no package on PyPI, and no notification when a new version ships.
Checking `channel.json` is a task you schedule.

## 8. Diagnosing a failure

The agent's failures are all one exception type with a message naming the cause. The useful
mapping:

| Message | What it means | What to do |
|---|---|---|
| `TAVONEL_API_KEY is missing or malformed` | Variable unset, or does not start `tvnl_live_` | Set the variable in the scheduler's environment, not only in your shell |
| `TAVONEL_BASE_URL must use HTTPS` | Base URL is not HTTPS or not loopback | Remove the override and use the default |
| `Foundation HTTP 401` / `403` | Key revoked, or lacks the `connections:sync` scope or the required plan | Issue a new key in Workspace; check the connection is not revoked |
| `Foundation HTTP 409` (`CONNECTION_CURSOR_CONFLICT`, `CONNECTION_BATCH_CONFLICT`) | The cursor chain does not match the server's, or that batch id was already applied with different content | Do not delete the state file first. Contact support with the `batchId` |
| `Foundation HTTP 413` (`REQUEST_TOO_LARGE`) | The event list exceeded the sync body limit (about 1.1 MB) | Split the tree across two connections, or sync more often so each batch is smaller |
| `Foundation HTTP 423` (`CONNECTION_NOT_SYNCABLE`) | The connection is not in a state that accepts a batch | Check the connection in Workspace; it may be revoked or awaiting verification |
| `Foundation request failed: ...` | Network, DNS or TLS | Nothing was committed; the next run retries from the same cursor |
| `Foundation did not commit the cursor batch` | Server answered, but not `applied`/`replayed` | Nothing was committed. Rerun; if it repeats, contact support |
| `state binding is invalid` | State file belongs to another connection id | Point `--state` at the right file |
| `<file> exceeds --max-file-bytes` | One file over the limit stopped the whole run | Raise the flag or move the file |
| `<file> changed during scan` / `upload` | A writer touched the file mid-run | Rerun when the source is quiet |
| `source path escaped the mounted root` | A path resolved outside `--root` | Check the mount for links and junctions |
| `S3 object size changed after listing` | Object rewritten between list and download | Rerun |
| `upload capability URL is invalid` | The issued URL failed validation | Nothing uploaded. Contact support with the timestamp |

For support, send the printed JSON line or the traceback, the connection id, and the run's
timestamp to `support@tavonel.com`. **Do not send document contents.**

## 9. What this runbook does not cover

- No qualified customer-run install exists, so there is no measured run time, throughput or
  failure rate for the agent on real infrastructure. Nothing here is a performance statement.
- There is no health endpoint, heartbeat or dashboard for the agent. Its liveness is whatever
  your scheduler reports.
- Recovery objectives for the TAVONEL side are not set; see the security page.
