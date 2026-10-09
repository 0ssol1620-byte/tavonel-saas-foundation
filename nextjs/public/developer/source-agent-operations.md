# Running the TAVONEL local source agent

Status: `IMPLEMENTED_NOT_PROVEN`. Local deterministic tests do not qualify a real customer installation, production ingestion, or downstream automatic publication. The public document-processing and customer-data gates remain unchanged.

## Scope and setup

The agent reads only the explicitly selected local/mounted root or S3-compatible bucket/prefix. It does not obtain filesystem or cloud access by connecting MCP. Mounted SMB/NFS/SFTP must already be available to the host. S3/R2/MinIO uses the host's authorized boto3 credential chain.

Requirements for sync: Python 3.12+, outbound HTTPS to the configured Foundation and its signed upload destination, and boto3 only for S3 mode. Verify the script against `sourceAgent.sha256` in `channel.json` before distributing it. Updating the developer channel and integrity hash is an integrator-owned follow-up; a local source change is not a new deployed version.

Create the exact connection in the workspace and use its UUID. API credentials are read only from `TAVONEL_API_KEY`, never command-line flags or state. Keep state outside the source root and protect its directory. State, pending journal and lock contain private inventory metadata and must not be shared.

```sh
python3 tavonel-source-agent.py --root /approved/documents \
  --connection-id YOUR_CONNECTION_UUID --state /private/agent/state.json \
  --approve-up-to-credits YOUR_MAXIMUM_CREDITS --allow-unknown-page-count
```

Only an already-authorized environment variable supplies the key. Do not paste keys into documents, shell history or support logs.

## Metadata-only intake plan

Use `--dry-run-plan` to produce a local triage manifest for an explicitly mounted root. This path does not require `TAVONEL_API_KEY`, a connection ID or a state file. It makes no HTTP, S3, LLM or provider calls; it does not upload, hash, open or otherwise read file contents; and it does not modify sync state or a server cursor. It is separate from normal sync and from the Foundation CDR/OCR intake paths. Core intake caching does not apply to this source-agent plan.

```sh
python3 tavonel-source-agent.py --root /approved/documents --dry-run-plan
```

Schema `tavonel.source-intake-plan.v2` (policy version 2) reports its version, the full allow/exclude configuration, local scan budgets, the disclosed Foundation service ceiling, a policy fingerprint, and an opaque root fingerprint. It allows the document and image suffixes listed in the plan and checks pathname, link/reparse status, regular-file type and size before classifying a file. Excluded directories are pruned before their children are inspected. Exclusions cover generated/cache trees (`.git`, `.venv`, `node_modules`, build/cache directories), OS metadata, temporary suffixes, and credential locations/names (`.aws`, `.ssh`, `.env*`, credential files, private-key formats). It does not blanket-exclude hidden files or historical version names such as `report-v1.pdf`.

### Foundation service ceiling and local scan budgets

The service ceiling comes from `PROCESSING_CEILING` in the Foundation's `shared/intakeCeiling.ts` at PR head `5347af4d5f76ba971927105b0a3d5cf20e13224e` (Git blob `48d5a5ba040138011c69ce11df415035d8fc1e02`):

- `maxSourceBytes` is the smaller of the worker and rasterizer maximums. Both are 5 MiB, so the ceiling is 5,242,880 bytes.
- `maxSourcePages` is 80. Intake does not decode documents, so page count can't be checked at intake. The page ceiling is disclosed, not enforced at admission.

The plan copies these values into `policy.serviceCeiling`. It checks only the byte ceiling, using the file size reported by file-system metadata:

| Supported-type file size | Status | Reason |
|---|---|---|
| At or under 5,242,880 bytes | `eligible` | `within_service_byte_ceiling_only_page_count_unknown` |
| Over 5,242,880 bytes | `oversized` | `exceeds_service_byte_ceiling_needs_review` |

Every supported-type entry has `pageCount: null`. The summary reports `pageCountInspected: false` and `serviceAdmissionDetermined: false`. So `eligible`, including for a file of exactly 5,242,880 bytes, means only that the suffix is supported and the size is at or under the byte ceiling. It's not a Foundation admission decision. The service decides the page ceiling, content validation, and plan or quota limits. An oversized file is never eligible, doesn't count toward candidate bytes, and doesn't stop the scan. Files of an unsupported type are `unsupported` at any size, and also neither count nor stop the scan.

`policy.scanBudgets` are local limits on this planner's work, separate from the service ceiling: 5,000 discovered entries, 512 MiB of cumulative eligible candidate bytes, 5 seconds, 2,000 manifest entries, and 1 MiB of output. They never make a file eligible and aren't service limits.

- **Entry count:** checked before the next child is kept or stat'd. The plan can learn that more entries exist, but it doesn't count or report the entry that is over budget.
- **Candidate bytes:** the first file that would exceed the cumulative budget is reported as `needs_review` / `candidate_byte_budget_exceeded`, and the scan stops.
- **Untraversed directories:** when a budget stops the scan, queued directories that weren't traversed are listed as `needs_review` / `directory_not_traversed_scan_incomplete`.

A budget hit, an inaccessible location, or a fail-closed event marks the scan incomplete; see `truncatedBy` and `failClosedReason`. `partialScanFinalized` is always false and `absenceSemantics` is `none`: omitted or excluded items are never treated as deletions or tombstones. The manifest uses root-relative paths and leaves out the absolute root, file contents, content hashes, and credentials.

### Links, junctions and confinement

The plan never follows a symbolic link, a Windows directory junction, any other reparse point, or (on Linux) a mount point. Traversal is anchored to open directory handles, not to path strings:

- **Root and its ancestors:** the planner opens the volume or file-system root, then opens each component of the requested root, one name at a time, beneath the handle it already holds for the parent. A link at any position is opened as itself and refused, never followed. If the root itself is a link or reparse point, it is reported as `needs_review` (`root_symlink_not_followed` or `root_reparse_point_not_followed`). A link among the root's ancestors is reported as `root_ancestor_symlink_not_followed` or `root_ancestor_reparse_point_not_followed`. In both cases nothing is listed. Pass the canonical path; for example, plan `C:\Data\Docs` rather than a junction that points to it.
- **Listing:** every listing reads the held directory handle, and every child's metadata comes from that handle. No child is looked up by path. Renaming the root or a directory while it's being listed, or putting a link at its old name, doesn't redirect the listing. The listing stays on the directory object that was opened.
- **Children:** a child that is a link, junction, reparse point, or mount point is reported as `needs_review` (`symlink_not_followed`, `reparse_point_not_followed`, or `mount_point_not_followed`) and is never queued or opened. This includes Windows volume mount points and reparse-point placeholders such as OneDrive Files On-Demand items.
- **Queued directories:** a queued directory is opened by its one name beneath the parent handle it was listed from. That parent handle stays open until all of its queued children have been opened. If the name has meanwhile become a link, a reparse point, a non-directory, another device, or nothing, the plan fails closed. It reports `directory_changed_not_followed`, sets `failClosedReason` to `directory_changed_before_traversal`, and stops; untraversed directories are listed as `directory_not_traversed_scan_incomplete`.
- **Case-only sibling names:** each queued directory is opened by the exact name its parent listed, and the open never asks for case-insensitive lookup. If a listing holds directory names that differ only by case (for example `A` and `a` in a Windows case-sensitive directory), they're opened only if the parent is known to look names up exactly. Otherwise neither is opened: each is reported as `needs_review` / `case_ambiguous_directory_not_traversed`, `failClosedReason` is `case_ambiguous_lookup`, and the plan isn't complete. The rest of the tree is still listed. See "Case sensitivity" below.
- **No path re-checks:** the planner doesn't use before/after `lstat`, identity, or `realpath` comparisons, and doesn't rely on them for confinement.
- **Permissions:** directory handles are opened read-only, sharing read, write, and delete, so the plan never blocks the customer's own edits or renames. The planner never changes ACLs, ownership, or permissions, and never opens a file.

The plan reports the traversal it used in `traversal`: `mode`, `handleAnchored`, and `unsupportedReason`. This field sits beside `policy`, so the policy fingerprint doesn't change. The schema stays `tavonel.source-intake-plan.v2`; `traversal` is an added field.

#### Support contract

Handle-anchored traversal is supported only in these cases:

| Host | Requirement | `traversal.mode` |
|---|---|---|
| Windows | Root on a local drive-letter path (`X:\...`, or `\\?\X:\...`) whose volume is local NTFS or ReFS | `windows_nt_relative_open_no_reparse` |
| Linux | Python with `dir_fd` support for `open`/`stat` and `fd` support for `scandir`; root on ext2/3/4, xfs, btrfs, tmpfs, zfs, f2fs, or overlayfs | `linux_openat_nofollow` |

Everything else fails closed before any directory is listed. The plan has one entry, `""` / `needs_review` / `unsupported_safe_traversal`, with `failClosedReason: "unsupported_safe_traversal"`, `scanComplete: false`, and no candidate metadata. The CLI exits with code 2. `traversal.unsupportedReason` gives the cause:

- `path_not_on_local_drive_letter`: UNC paths (`\\server\share`), `\\?\UNC\` paths, and device paths. These are rejected from the path text, before anything is opened.
- `remote_volume`: a mapped network drive, or any volume whose device reports itself as remote. An SMB server resolves junctions on its own side, out of the client's control.
- `filesystem_not_supported`: for example FAT32 or exFAT on Windows, or NFS, CIFS/SMB, FUSE (SSHFS/SFTP), or 9p (WSL `/mnt/c`) on Linux.
- `platform_not_supported`: macOS, BSD, and every platform other than Windows and Linux.
- `native_api_unavailable`, `descriptor_relative_api_unavailable`, `filesystem_type_unavailable`, `volume_information_unavailable`, `volume_device_unavailable`, and `volume_root_not_a_plain_directory`: the host can't provide the required APIs or volume facts.

The plan never falls back to path-based scanning. Mounted SMB/NFS/SFTP shares, the agent's main sync use case, are therefore unsupported for `--dry-run-plan`.

#### How it's implemented

- **Windows:** the plan uses Win32 and NT APIs through `ctypes`, with no new dependencies.
  - `CreateFileW` opens the drive's root directory with `FILE_FLAG_OPEN_REPARSE_POINT`. `GetVolumeInformationByHandleW` and `NtQueryVolumeInformationFile(FileFsDeviceInformation)` check the file system and the remote flag on that handle.
  - Every later open is a single `NtCreateFile` call. It passes `ObjectAttributes.RootDirectory` set to the held parent handle, a single path component, and `FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT`. `ObjectAttributes.Attributes` is 0; `OBJ_CASE_INSENSITIVE` is never set. Afterwards, `GetFileInformationByHandleEx(FileAttributeTagInfo)` reads the attributes and reparse tag from the new handle.
  - When a listing has case-only sibling directory names, `GetFileInformationByHandleEx(FileCaseSensitiveInfo)` reads the parent's `FILE_CS_FLAG_CASE_SENSITIVE_DIR` from its held handle. This is a read-only query, made at most once per directory.
  - Listings use `GetFileInformationByHandleEx(FileFullDirectoryInfo)` on the held handle.
  - `NtCreateFile` and `NtQueryVolumeInformationFile` are documented `ntdll` exports, but Microsoft describes them as subject to change.
- **Linux:** `os.open("/")` starts the walk. Each component is then opened with `os.open(name, O_DIRECTORY | O_NOFOLLOW, dir_fd=parent)`. `fstatfs` checks the root's file system. Listings use `os.scandir(fd)`, and child metadata comes from `fstatat(fd, name, AT_SYMLINK_NOFOLLOW)`. A child directory whose device differs from the root's is a mount point and is never followed.

#### Case sensitivity

NTFS can mark a directory case-sensitive, and that directory can then hold `A` and `a` side by side. The planner never sets, clears, or changes that flag, or any other directory setting.

- **Lookup:** opens don't set `OBJ_CASE_INSENSITIVE`, so each name is matched under the file system's own policy for that directory. In a default (case-insensitive) directory, an exact listed name matches the one entry that has it, because a case-only sibling can't exist there. In a case-sensitive directory, the exact name matches only itself.
- **Why there's also a check:** with the default `obcaseinsensitive` kernel setting, Windows adds case-insensitive matching to file opens itself. A directory without the case-sensitive flag that still holds case-only siblings (for example, names created on a host with a different kernel setting) could then resolve `A` to `a`. So when a listing has case-only directory names, the planner reads the parent's case-sensitive flag first. It opens them only if the flag is set. If the flag isn't set, or the query fails (older Windows builds, ReFS, or anything else), it fails closed as described under "Case-only sibling names" above. It never omits a subtree silently or claims a complete scan.
- **Detecting collisions:** names collide if they match under Python's `casefold()` or `upper()`. This can flag a pair that NTFS's own upcase table treats as different, which errs toward refusing.
- **Linux:** `openat` matches names byte for byte, and an ext4 casefold directory can't hold case-only siblings, so Linux never refuses these names.
- **Root path:** the components of the requested root come from the path you pass. In a case-sensitive ancestor directory, or on a host where `obcaseinsensitive` is 0, they must match the on-disk case exactly; otherwise the root is reported as `root_unavailable`. Pass the root with its exact case.
- **Untested here:** this was not reproduced natively on the development host, and the suite never enables case sensitivity. A native case-sensitive test runs only when the temporary directory is already case-sensitive.

#### Limits that remain

- **Snapshot meaning:** the plan reports the directory objects it opened, at the time it listed them. If a directory inside the root is renamed or moved somewhere else (even outside the root) after the planner opened it, or opened its parent, the plan still lists it under its original relative path. The same applies to anything moved into that directory. This doesn't widen access: whoever moves the directory could equally have placed those entries inside the root.
- **Trust anchors:** the drive letter (Windows) and `/` (Linux) are resolved once, when the walk starts. A `subst` mapping or a changed DOS-device mapping is used as found at that moment. The root path is normalized lexically first (`..` is collapsed before the walk).
- **Linux mount points:** Linux btrfs subvolumes have their own device numbers, so they're reported as `mount_point_not_followed`.
- **Hard links:** a hard-linked file inside the root is reported like any other file.
- **Normal sync:** sync doesn't use this traversal; see "Deletions and incomplete listings".

### Ordering and determinism

Children are traversed, and the manifest is sorted, by case-folded name, with the exact name as a tie-break. `A.pdf` and `a.pdf` therefore sort the same way whatever order the file system lists them in, and a complete plan over unchanged metadata has the same `manifestSha256`. When a count or time budget stops a listing part-way, which entries were reached depends on the file system's listing order, so don't compare truncated plans by hash across hosts.

Statuses distinguish `eligible`, `excluded_by_policy`, `unsupported`, `oversized`, `inaccessible`, and `needs_review`. `unchanged_metadata_candidate` is reserved for a future explicit metadata-baseline comparison; this command reads no baseline and never claims unchanged content, exact duplicates, or reusable content. The plan is a triage aid only and does not authorize upload, deletion, publication, or downstream document processing.

## One-shot and continuous modes

Default execution performs one reconciliation and exits. `--watch` repeats with a minimum one-second interval; default `--poll-seconds` is 30. `--max-cycles N` bounds a test or scheduled session; zero means repeat until stopped when watch is enabled.

```sh
python3 tavonel-source-agent.py --root /approved/documents \
  --connection-id YOUR_CONNECTION_UUID --state /private/agent/state.json \
  --approve-up-to-credits YOUR_MAXIMUM_CREDITS --allow-unknown-page-count \
  --watch --poll-seconds 30 --max-cycles 10
```

This is continuous inventory reconciliation, not an OS event watcher. Interval is not end-to-end knowledge freshness: scanning, upload, server processing and publication add latency. The agent does not automatically activate a candidate World, bypass review, or change production flags. There is no server-side liveness monitor in this change. Host uptime, scheduling and alerting remain operator responsibilities.

A service manager may restart a stopped agent, but installing such a service or granting ongoing access is a separate user-authorized step. No service is installed by running the one-shot command.

## Durable commit and recovery

Each cycle validates its state, scans the complete source inventory and computes added/changed/deleted events. Before network work, every changed set must fit one complete approval (at most 128 files and the bounded manifest size); partial approved sets are refused. Sync requires the caller to set `--approve-up-to-credits` (a positive maximum no greater than 10,000,000) and `--allow-unknown-page-count` when a changed source has no trusted page estimate. It requests a no-hold quote for the exact whole manifest, compares the quote maximum with that caller limit, then persists the attempt key, manifest, quote and approval body before approval. A quote above the limit stops with instructions to review and rerun using an explicit higher caller limit. A retry never accepts a changed quote or server ceiling automatically. After approval, the agent persists approval/scope/document identities before asking for any capability; each member uses the same stable attempt/file identity for capability, direct PUT and atomic confirmation. The sync batch and cursor advance only after every selected member is confirmed and the server accepts the complete batch.

It advances cursor state only after the server returns `applied` or `replayed`. If the server committed but its response was lost, the next attempt replays the same batch before scanning new input. If state was written but journal deletion failed, restart recognizes the already-committed cursor. Do not delete a pending journal to recover from an unknown server outcome.

After a definitive object-store refusal, the agent first asks the server to release that member, then calls `POST /api/v1/uploads/approval/cancel` with the same `attemptKey`, `scopeDigest` and a member `fileKey`. The member key anchors the caller-scoped request; the server cancels the complete approval and releases remaining reserved member holds atomically. A reconciliation-required response means some work may already have settled and needs review. An uncertain PUT is never released or cancelled: retry the same saved attempt and let the server reconcile it.

A state fingerprint binds the API URL and source root or bucket/prefix/endpoint. A changed scope fails closed; create a separate approved connection/state. Legacy state without a fingerprint requires `--adopt-legacy-state` after an operator verifies the original source and API target. This option does not approve a new scope.

The lock uses OS advisory locking, is released on process exit, and prevents concurrent local writers of the same state file. It is not a distributed multi-host lock. Use one agent instance per connection; keep state on a reliable local filesystem. Cross-host orchestration is not implemented here.

## Bounded retries and costs

`--retry-limit` defaults to 3 and allows 010 additional attempts per cycle. Only transient HTTP 408/429/5xx and network errors are retried with capped exponential backoff. Authentication, scope, invalid journal, unsupported server responses and cursor conflicts stop the process. Exhausting retries also stops, preserving state and pending journal.

`--max-events` is 15000; `--max-upload-bytes` defaults to 512 MiB per cycle; `--max-file-bytes` (default 512 MiB) remains a local upper bound and is not the Foundation ceiling. The Foundation's `maxSourceBytes` of 5,242,880 bytes and its 80-page ceiling still apply on the server, so normal sync can upload a file that the service then refuses. Use the dry-run plan to find such files first. Server plan/file limits still apply and may be lower. Inventory change count and supported upload bytes are checked before upload. A final bounded manifest check prevents oversized sync submission. These are input budgets, not a complete downstream OCR/LLM credit reservation system.

The process prints one JSON result per completed cycle and sanitized retry/failure status. Failed main execution returns nonzero with `SOURCE_SYNC_FAILED`; no raw HTTP body or traceback is printed by main. Interrupt exits 130. Investigate configuration and server status through authorized tools, never expose credentials in support output.

## Deletions and incomplete listings

A permission error in a mounted-directory walk aborts reconciliation rather than turning unlisted files into deletions. Symbolic links are skipped, paths outside the selected root are refused, and file metadata is checked during hashing. Repeated/missing S3 continuation tokens abort the inventory.

The revision that hardened the intake plan didn't change normal sync. Sync skips symbolic links, but like `os.walk` it still descends into Windows junctions. If it reaches any file through a junction that leads outside the root, the cycle aborts and the cursor is left unchanged (fail closed). A junction that leads back inside the root can duplicate inventory entries, or loop until a path error aborts the cycle. Keep junctions out of synced roots until sync gets the same reparse-point handling as the plan.

An empty inventory following a nonempty one is refused by default, protecting against an unavailable mount or unexpected listing. `--allow-empty-snapshot` permits this deletion/suspension batch only after the source is verified. It remains an operator decision, not automatic confirmation that every original file was deleted. The agent never deletes the customer's original files.

The server decides how deleted sources are suspended. This change alone does not prove cache invalidation, derived-data deletion, backup erasure or instantaneous ACL revocation. S3 listing uses ETags as provider revision markers, not byte hashes; content is hashed after download. Offline and provider-delayed changes cannot be reflected instantly.

## Offline verification

```sh
python3 -m unittest discover -s scripts/source-agent -p 'test_*.py' -v
```

The suite covers unchanged sync, lost response and exact replay, scope changes, empty inventories, permission failure, symlink skipping, state outside source, budget preflight, explicit legacy adoption, local lock exclusion, bounded watch and retry, repeated S3 cursor and journal tampering. Most sync tests use a mocked client. A dedicated wire regression runs the real `FoundationClient.upload` against a local fake HTTP Foundation and storage server; it checks the capability body, stable idempotency key, unauthenticated byte PUT, and confirmation request. All fixtures are synthetic and local; no live credentials or remote upload is used. The Vitest suite invokes these tests through `lib/source-agent-runtime.test.ts`.

The intake-plan tests cover:

- the service byte ceiling at exactly 5,242,880 and 5,242,881 bytes, with page count left unknown
- unsupported and oversized files that don't abort eligible candidates
- a file-count budget of one, which visits and reports exactly one entry
- case-only name ties under reversed enumeration
- candidate-byte, time, and output truncation
- missing, non-directory, and unreadable roots
- no content reads or tree changes, and no network, credential, or state use
- normal sync behaving the same after a plan

- traversal anchored to directory handles:
  - Windows opens are single names beneath a held handle, with `FILE_OPEN_REPARSE_POINT`.
  - At the `NtCreateFile` boundary (mocked), case-only siblings `A` and `a` are passed separately by their exact names, without `OBJ_CASE_INSENSITIVE`.
  - Case-only sibling directories are opened only where the parent's lookup is exact; otherwise the plan fails closed with `case_ambiguous_lookup`. The case-sensitive flag is read from the held handle, and only when such a collision exists.
  - A native case-sensitive directory keeps both subtrees. This runs only when the temporary directory is already case-sensitive (always on Linux; on Windows it's usually skipped, because the suite never enables the flag).
  - Linux opens are `O_DIRECTORY | O_NOFOLLOW` beneath a held descriptor.
  - There's no path-based `scandir`, `lstat`, `listdir`, `walk`, or `realpath` call during a plan.
- fail-closed `unsupported_safe_traversal` before any listing:
  - for an unsupported platform (simulated);
  - for a file system outside the allowlist (the real backend, with an emptied allowlist);
  - on Windows, for a UNC path, rejected before any open.

The link-confinement tests create real links inside a temporary directory. On Windows they make directory junctions with `cmd /c mklink /J`, which needs no administrator or symlink privilege; on Linux they use directory symlinks. Each race is staged at the held-handle listing or at the single-name open, so the tests confirm that the swap really happened while traversal was under way. The tests cover:

- **Root link:** a root that is already a link.
- **Child links:** queued child links, which are never opened.
- **Reviewer's root swap:** the independent reviewer's transient root swap. During the root listing, the real root is renamed away, a junction to an outside tree takes its name, and the original is restored before the plan returns. The test asserts that the path then really leads outside, but only `inside.pdf` is emitted.
- **Root replaced:** the root replaced during its listing and left in place. A second plan then refuses the root link.
- **Queued directory replaced:** a queued directory replaced before it's opened, which fails closed.
- **Directory replaced while listed:** a directory replaced during its own listing, which stays anchored.
- **Ancestors:** an ancestor that's already a link, an ancestor replaced during the root walk, and an ancestor replaced during the root listing. Windows may refuse to rename an ancestor of an open directory handle. The last test then asserts that denial path: no junction is placed, the original tree is unchanged, and the plan emits no outside metadata and no deletions, and is truthfully complete for the tree it listed. If the rename succeeds, the test asserts that the junction swap happened during the listing, that it was undone, and that nothing escaped.

Every race test asserts four things:

- no outside name or metadata is emitted;
- `scanComplete` is false wherever traversal was refused or stopped;
- `partialScanFinalized` is false and `absenceSemantics` is `none`;
- `traversal` reports the anchored mode.

The suite's fixtures start from the canonical temporary path, because the plan refuses linked ancestors. On Windows the link tests are skipped only when `cmd.exe` is unavailable or the temporary volume doesn't support reparse points. On other platforms without a backend, the plan tests are skipped and a test checks that the plan fails closed.

The independent reviewer's original reproducer is preserved unmodified at `reviewed-swap-away-back.py` in the candidate root. It hooks `os.scandir(path)`. r2 never lists by path, so that hook never fires against r2 and the script no longer stages the race. The adapted test above stages the same race at the handle listing instead.

Before production: verify supported Python/platform locking, actual source size distribution, storage permissions, partial connectivity, exact deployed API contracts, downstream compilation, ACL/deletion and billing. Keep the `IMPLEMENTED_NOT_PROVEN` status until the selected customer environment passes that qualification.

## Additional transfer safeguards and remaining identity work

Authenticated POSTs and uploads refuse redirects so credentials and source bytes cannot be replayed to another origin. Hashing uses bounded descriptor reads; mounted uploads use a sealed copy checked against the inventory digest. S3 requires an explicit boolean completeness marker, validated entries and revision-conditional reads, and preserves the original key basename in upload metadata.

The current source upload key includes source revision, so a connector edit creates a new immutable Foundation document UUID. This agent improvement does not by itself establish stable logical connector-document lineage through compilation. That needs an explicit logical-source-to-immutable-version mapping with ACL and billing preservation. Do not reuse an old quarantine object/document ID for new bytes just to force identity stability.

## Revision provenance

The initial draft of the agent, its tests, and this guide was authored by Codex. That draft introduced the metadata-only intake plan as schema `tavonel.source-intake-plan.v1`, policy version 1. A later revision by Claude Opus 5.5 (`claude-opus-5-5`) changed the intake plan, its tests, and this guide, so these files are now of mixed authorship. The revision didn't change normal sync, S3, or upload code. The original Codex draft is preserved unchanged in the frozen draft. This section records what v2 replaces, so the earlier statements stay visible rather than being silently removed.

1. **Junctions and reparse points.** v1 checked only `S_ISLNK`, so it followed a Windows junction at the root or inside it and could list metadata from outside the root. v2 rejects every reparse point and re-checks the root and each directory before and after each listing.
2. **Service ceiling.** v1 claimed a 100 MiB per-candidate-file limit (`limits.fileBytes = 104857600`). The Foundation contract doesn't support that figure, and it is withdrawn; under it, a PDF of 5 MiB + 1 byte was marked eligible. v2 uses the authoritative 5 MiB `maxSourceBytes` from `shared/intakeCeiling.ts`, keeps it separate from the scan budgets (`limits` is renamed `scanBudgets`), and reports page count as unknown.
3. **File-count boundary.** v1 added a child before checking the count, so `fileCount = 1` reported two entries. v2 checks the count before keeping the next child.
4. **Ordering.** v1 sorted by case-folded name only, so `A.pdf`/`a.pdf` ties followed the file system's listing order and changed the manifest hash. v2 adds a case-sensitive tie-break.

v1 and v2 plans aren't comparable: the schema, policy fingerprint, and fields differ. The integrator owns two follow-ups: updating the developer channel's integrity hash, and updating any manifest that names the plan schema. The Claude Opus 5.5 revision was prepared without running the test suite. Run it on Windows and on a POSIX host before accepting the revision.

### r2: handle-anchored traversal

A subsequent revision by Claude Opus 5.5 (`claude-opus-5-5`), referred to here as r2, followed an independent review. It changed only the intake plan, its tests, and this guide. Normal sync, S3, and upload code are unchanged, and the policy, its fingerprint, and the scan budgets are unchanged. The earlier r1 candidate is preserved unchanged in its own directory.

1. **Finding withdrawn from r1.** r1 listed directories by path (`os.scandir(path)`) and relied on `lstat` and `realpath` re-checks before and after each listing. A reviewer reproduced an escape on Windows. During the root listing, they renamed the real root away, put a junction to an outside directory at its name, listed through it, and restored the root before the after-check. The plan emitted the outside file as `eligible` with `scanComplete: true` and no fail-closed reason. r1's documented limit ("a directory swapped away and back ... isn't detected") described that gap; it didn't fix it.
2. **What r2 does instead.** Every open is a single name beneath an already-held directory handle, with reparse points opened as themselves and refused. Every listing reads the held handle. The path re-checks are removed rather than kept as a boundary.
3. **Fail closed where unsupported.** Platforms and file systems outside the support contract return `unsupported_safe_traversal` before any listing. There's no path-based fallback.
4. **Reasons changed.** `root_changed_during_scan`, `directory_changed_during_scan`, and `root_changed_not_followed` are no longer produced, because a rename can't redirect a held handle. r2 adds:
   - `unsupported_safe_traversal`
   - `root_ancestor_symlink_not_followed` and `root_ancestor_reparse_point_not_followed`
   - `mount_point_not_followed`
   - the `traversal` field

   When a plan fails closed, untraversed directories are now listed as `directory_not_traversed_scan_incomplete`.

r2 was also prepared without running the test suite, because no shell was available to its author. Run it on Windows and on Linux before accepting r2. Whether the added `traversal` field and the changed reason vocabulary warrant a new schema name is for the integrator to decide; r2 keeps `tavonel.source-intake-plan.v2`.

### r3: Windows case policy

A further revision by Claude Opus 5.5 (`claude-opus-5-5`), referred to here as r3, followed a second review. It changed only the intake plan, its tests, and this guide. Handle-anchored traversal, the policy, its fingerprint, the scan budgets, and normal sync are unchanged. The r2 candidate is preserved unchanged in its own directory.

1. **Case-sensitive directories.** r2 set `OBJ_CASE_INSENSITIVE` on every `NtCreateFile` open. In a case-sensitive NTFS directory, a queued `A` could then resolve ambiguously or to `a`, and one subtree could be skipped while the plan reported itself complete. The reviewer didn't reproduce this. r3 drops the flag, and it fails closed (`case_ambiguous_lookup`) when case-only sibling directories sit in a directory not known to be case-sensitive. See "Case sensitivity".
2. **Reasons added.** `case_ambiguous_directory_not_traversed` (entry) and `case_ambiguous_lookup` (`failClosedReason`).
3. **Ancestor-rename test.** r2 skipped the test when Windows refused the rename. r3 asserts that refusal as a safe outcome and keeps every assertion for the case where the rename succeeds.

r3 was also prepared without running the test suite. Run it on Windows and on Linux before accepting r3.


## Approved upload compatibility revision

The 2026-10-03 compatibility repair changes normal sync's upload path. The agent now quotes each complete changed manifest before work, requires the operator's `--approve-up-to-credits` bound, and requires `--allow-unknown-page-count` when non-image sources have no trusted estimate. It persists attempt, quote, approval and file identities before transfer, then confirms each upload before advancing the cursor batch. A changed quote, a larger set than the 128-file approval bound, or an approval refusal stops the cycle for operator review. Existing complete-set and legacy compile behavior is retained.

The repair is a task-owned candidate against PR141 head `db8a8771e10211b7850cdf4ff5788537c2a0aca6`. The prior source-agent implementation was mixed-authored: Claude Opus 5.5 supplied the bounded-intake changes, and Codex added this revision's full-sync fake-HTTP recovery coverage, whole-set cancel call and API contract updates. Local synthetic tests do not prove a deployed API, a production upload, or downstream compile quality.
