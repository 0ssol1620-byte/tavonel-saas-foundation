#!/usr/bin/env python3
"""TAVONEL local source agent for mounted shares and S3-compatible storage.

The API key is read only from TAVONEL_API_KEY. Source bytes travel directly to
short-lived object-store upload URLs, and local cursor state advances only after
the Foundation commits the corresponding cursor batch.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import stat as stat_module
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

SCHEMA = "tavonel.public-source-agent.v1"
DEFAULT_BASE_URL = "https://tavonel.com"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MIME_BY_SUFFIX = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class AgentError(RuntimeError):
    """One polling cycle could not be committed safely."""


class RetryableAgentError(AgentError):
    """A bounded retry may recover; durable pending batches must be replayed."""


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: bytes | str) -> str:
    raw = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(raw).hexdigest()


def safe_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return False
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        return False
    return parsed.scheme == "https" or (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    )


def read_state(path: Path, connection_id: str) -> dict[str, Any]:
    if not path.exists():
        return {"files": {}, "serverCursorSha256": None}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AgentError(f"state is not readable: {path}") from exc
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != SCHEMA
        or value.get("connectionId") != connection_id
        or not isinstance(value.get("files"), dict)
    ):
        raise AgentError("state binding is invalid")
    cursor = value.get("serverCursorSha256")
    if cursor is not None and (not isinstance(cursor, str) or not cursor.startswith("sha256:")):
        raise AgentError("state cursor is invalid")
    return {"files": value["files"], "serverCursorSha256": cursor, "scopeFingerprint": value.get("scopeFingerprint")}


def write_state(
    path: Path,
    connection_id: str,
    files: dict[str, dict[str, object]],
    cursor: str,
    scope_fingerprint: str | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical(
        {
            "schemaVersion": SCHEMA,
            "connectionId": connection_id,
            "serverCursorSha256": cursor,
            "files": files,
            "scopeFingerprint": scope_fingerprint,
        }
    )
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.chmod(temp_name, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        fsync_directory(path.parent)
    finally:
        Path(temp_name).unlink(missing_ok=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never replay credentials or document bytes to an unapproved redirected origin.
        return None


class FoundationClient:
    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        if not safe_url(base_url):
            raise ValueError("TAVONEL_BASE_URL must use HTTPS (or exact loopback for tests)")
        if not api_key.startswith("tvnl_live_"):
            raise ValueError("TAVONEL_API_KEY is missing or malformed")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def post(
        self,
        path: str,
        body: dict[str, object],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request = urllib.request.Request(  # noqa: S310 - base URL validated in __init__.
            f"{self.base_url}{path}",
            data=canonical(body).encode("utf-8"),
            method="POST",
            headers={
                "authorization": f"Bearer {self.api_key}",
                "content-type": "application/json",
                **(headers or {}),
            },
        )
        try:
            with self.opener.open(  # noqa: S310 - request uses the validated base.
                request, timeout=self.timeout
            ) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            error = RetryableAgentError if exc.code in {408, 429} or exc.code >= 500 else AgentError
            raise error(f"Foundation HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise RetryableAgentError("Foundation network request failed") from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentError("Foundation response exceeded the bounded limit")
        try:
            value = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AgentError("Foundation returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise AgentError("Foundation response must be an object")
        return value

    def upload(self, path: Path, mime_type: str, idempotency_key: str, original_filename: str | None = None) -> str:
        size = path.stat().st_size
        capability = self.post(
            "/api/v1/uploads/capability",
            {
                "originalFilename": original_filename or path.name,
                "declaredMimeType": mime_type,
                "requestedBytes": size,
            },
            {"x-tavonel-source-idempotency-key": idempotency_key},
        )
        upload_url = capability.get("uploadUrl")
        document_id = capability.get("documentId")
        if not isinstance(upload_url, str) or not safe_url(upload_url):
            raise AgentError("upload capability URL is invalid")
        if not isinstance(document_id, str):
            raise AgentError("upload capability omitted its document binding")
        before = path.stat()
        with path.open("rb") as source:
            request = urllib.request.Request(  # noqa: S310 - capability URL validated above.
                upload_url,
                data=source,
                method="PUT",
                headers={"content-type": mime_type, "content-length": str(size)},
            )
            try:
                with self.opener.open(  # noqa: S310 - validated capability URL.
                    request, timeout=self.timeout
                ) as response:
                    if response.status not in {200, 201, 204}:
                        raise AgentError(f"direct upload returned HTTP {response.status}")
            except urllib.error.HTTPError as exc:
                error = RetryableAgentError if exc.code in {408, 429} or exc.code >= 500 else AgentError
                raise error(f"direct upload returned HTTP {exc.code}") from exc
            except urllib.error.URLError as exc:
                raise RetryableAgentError("direct upload network request failed") from exc
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise AgentError(f"{path.name!r} changed during upload")
        return document_id


def file_digest(path: Path, max_file_bytes: int) -> tuple[int, str]:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat_module.S_ISREG(before.st_mode):
            raise AgentError("source is not a regular file")
        if before.st_size > max_file_bytes:
            raise AgentError("source exceeds --max-file-bytes")
        digest = hashlib.sha256()
        size = 0
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            if size > max_file_bytes:
                raise AgentError("source exceeded --max-file-bytes while reading")
            digest.update(chunk)
        after = os.fstat(handle.fileno())
        if size != before.st_size or (after.st_size, after.st_mtime_ns, after.st_ino) != (before.st_size, before.st_mtime_ns, before.st_ino):
            raise AgentError("source changed during scan")
    return size, digest.hexdigest()


def scan_mount(root: Path, max_file_bytes: int) -> dict[str, dict[str, object]]:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise AgentError("--root must be a directory")
    files: dict[str, dict[str, object]] = {}
    def scan_error(error: OSError) -> None:
        raise AgentError("source inventory incomplete; cursor was not advanced") from error

    # rglob may suppress permission errors. Never treat an incomplete walk as deletions.
    for directory, dirs, names in os.walk(resolved, followlinks=False, onerror=scan_error):
        dirs[:] = sorted(name for name in dirs if not (Path(directory) / name).is_symlink())
        for name in sorted(names):
            path = Path(directory) / name
            if path.is_symlink():
                continue
            if not path.resolve(strict=True).is_relative_to(resolved):
                raise AgentError("source path escaped the mounted root")
            if not path.is_file():
                continue
            size, digest = file_digest(path, max_file_bytes)
            native_id = path.relative_to(resolved).as_posix()
            files[native_id] = {
                "revision": sha256(f"{digest}\x1f{size}"),
                "sizeBytes": size,
                "contentSha256": digest,
                "mimeType": MIME_BY_SUFFIX.get(path.suffix.lower()),
            }
    return files


def snapshot_mount(path: Path, expected: dict[str, object], max_file_bytes: int) -> tuple[Path, tempfile.TemporaryDirectory]:
    """Upload a sealed copy, never bytes that can change after manifest hashing."""
    directory = tempfile.TemporaryDirectory(prefix="tavonel-source-snapshot-")
    target = Path(directory.name) / path.name
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as source, target.open("xb") as output:
            os.chmod(target, 0o600)
            written = 0
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                written += len(chunk)
                if written > max_file_bytes or written > int(expected["sizeBytes"]):
                    raise AgentError("source changed after inventory")
                output.write(chunk)
        size, digest = file_digest(target, max_file_bytes)
        if size != expected["sizeBytes"] or digest != expected["contentSha256"]:
            raise AgentError("source changed after inventory")
        return target, directory
    except Exception:
        directory.cleanup()
        raise


def s3_client(args: argparse.Namespace) -> Any:
    try:
        import boto3
    except ImportError as exc:
        raise AgentError("S3/R2/MinIO mode requires: python -m pip install boto3") from exc
    if args.s3_endpoint_url and not safe_url(args.s3_endpoint_url):
        raise AgentError("--s3-endpoint-url must use HTTPS (or exact loopback for tests)")
    return boto3.client(
        "s3",
        region_name=args.s3_region,
        endpoint_url=args.s3_endpoint_url,
    )


def scan_s3(client: Any, args: argparse.Namespace) -> dict[str, dict[str, object]]:
    files: dict[str, dict[str, object]] = {}
    token: str | None = None
    seen_tokens: set[str] = set()
    while True:
        request: dict[str, object] = {
            "Bucket": args.s3_bucket,
            "Prefix": args.s3_prefix,
        }
        if token:
            request["ContinuationToken"] = token
        try:
            response = client.list_objects_v2(**request)
        except Exception as exc:
            raise AgentError("S3 inventory failed; cursor was not advanced") from exc
        if not isinstance(response, dict) or type(response.get("IsTruncated")) is not bool:
            raise AgentError("S3 inventory completeness marker is invalid")
        contents = response.get("Contents", [])
        if not isinstance(contents, list):
            raise AgentError("S3 inventory entries are invalid")
        for item in contents:
            if not isinstance(item, dict) or not isinstance(item.get("Key"), str) or type(item.get("Size")) is not int or item["Size"] < 0:
                raise AgentError("S3 inventory entry is invalid")
            key = item["Key"]
            size = item["Size"]
            if not key.startswith(args.s3_prefix):
                raise AgentError("S3 inventory exceeded configured prefix")
            if not key or size > args.max_file_bytes:
                if size > args.max_file_bytes:
                    raise AgentError(f"{key!r} exceeds --max-file-bytes")
                continue
            etag = str(item.get("ETag") or "").strip('"')
            if not etag:
                raise AgentError("S3 listing omitted its revision marker")
            files[key] = {
                "revision": f"etag:{etag}",
                "sizeBytes": size,
                "contentSha256": None,
                "mimeType": MIME_BY_SUFFIX.get(Path(key).suffix.lower()),
            }
        if response["IsTruncated"] is False:
            break
        next_token = response.get("NextContinuationToken")
        if not isinstance(next_token, str) or not next_token:
            raise AgentError("S3 listing omitted its continuation token")
        if next_token in seen_tokens:
            raise AgentError("S3 listing repeated its continuation token")
        seen_tokens.add(next_token)
        token = next_token
    return files


def download_s3(client: Any, args: argparse.Namespace, key: str, expected_size: int, expected_revision: str) -> Path:
    if not expected_revision.startswith("etag:") or not expected_revision[5:]:
        raise AgentError("S3 revision binding is invalid")
    try:
        response = client.get_object(Bucket=args.s3_bucket, Key=key, IfMatch='"' + expected_revision[5:] + '"')
    except Exception as exc:
        raise AgentError("S3 immutable read failed; inventory must be rechecked") from exc
    if str(response.get("ETag") or "").strip('"') != expected_revision[5:]:
        body = response.get("Body")
        if body is not None and callable(getattr(body, "close", None)):
            body.close()
        raise AgentError("S3 object revision changed after listing")
    body = response.get("Body")
    if body is None or not hasattr(body, "read"):
        raise AgentError("S3 GetObject omitted its streaming body")
    descriptor, name = tempfile.mkstemp(prefix="tavonel-source-", suffix=Path(key).suffix)
    written = 0
    try:
        os.chmod(name, 0o600)
        with os.fdopen(descriptor, "wb") as target:
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > expected_size:
                    raise AgentError("S3 object exceeded its listed size")
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
    except Exception:
        Path(name).unlink(missing_ok=True)
        raise
    finally:
        close = getattr(body, "close", None)
        if callable(close):
            close()
    if written != expected_size:
        Path(name).unlink(missing_ok=True)
        raise AgentError("S3 object size changed after listing")
    return Path(name)


def _sync(args: argparse.Namespace) -> dict[str, object]:
    state = read_state(args.state, args.connection_id)
    previous = state["files"]
    client = FoundationClient(
        args.base_url,
        os.environ.get("TAVONEL_API_KEY", ""),
        args.timeout_seconds,
    )
    fingerprint = source_fingerprint(args)
    existing_scope = state.get("scopeFingerprint")
    if existing_scope is not None and existing_scope != fingerprint:
        raise AgentError("state scope changed; register a separate source and state")
    if state["serverCursorSha256"] is not None and existing_scope is None and not args.adopt_legacy_state:
        raise AgentError("legacy state requires --adopt-legacy-state after verifying original scope")
    pending_path = args.state.with_name(args.state.name + ".pending")
    if pending_path.exists():
        try:
            pending = json.loads(pending_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise AgentError("pending journal is unreadable; refusing a new scan") from exc
        if not isinstance(pending, dict) or pending.get("scopeFingerprint") != fingerprint or pending.get("connectionId") != args.connection_id:
            raise AgentError("pending journal scope binding is invalid")
        body = pending.get("body")
        files = pending.get("files")
        if not isinstance(body, dict) or not isinstance(files, dict) or not isinstance(body.get("events"), list):
            raise AgentError("pending journal contract is invalid")
        if body.get("manifestSha256") != "sha256:" + sha256(canonical(body["events"])):
            raise AgentError("pending journal manifest is invalid")
        if state["serverCursorSha256"] == body.get("nextCursorSha256"):
            pending_path.unlink()
        elif state["serverCursorSha256"] != body.get("previousCursorSha256"):
            raise AgentError("pending journal cursor is not the current state")
        else:
            return commit_pending(args, client, pending_path, pending)
    root = args.root.resolve(strict=True) if args.root else None
    if root and args.state.resolve().is_relative_to(root):
        raise AgentError("state and journal must be outside the source root")
    cloud = None if root else s3_client(args)
    current = scan_mount(root, args.max_file_bytes) if root else scan_s3(cloud, args)
    if previous and not current and not args.allow_empty_snapshot:
        raise AgentError("empty inventory requires --allow-empty-snapshot after source verification")
    for native_id, item in current.items():
        old = previous.get(native_id)
        if (
            isinstance(old, dict)
            and old.get("revision") == item.get("revision")
            and old.get("sizeBytes") == item.get("sizeBytes")
            and old.get("mimeType") == item.get("mimeType")
        ):
            item["contentSha256"] = old.get("contentSha256")
    cursor_files = {
        native_id: {
            "revision": item["revision"],
            "sizeBytes": item["sizeBytes"],
            "mimeType": item["mimeType"],
        }
        for native_id, item in current.items()
    }
    next_cursor = "sha256:" + sha256(
        canonical({"provider": "file_server" if root else "s3", "files": cursor_files})
    )
    changed_ids = [key for key in set(previous) | set(current) if previous.get(key) != current.get(key)]
    upload_bytes = sum(int(current[key]["sizeBytes"]) for key in changed_ids if key in current and current[key].get("mimeType"))
    if len(changed_ids) > args.max_events or upload_bytes > args.max_upload_bytes:
        raise AgentError("source cycle exceeds event or upload-byte budget before upload")
    events: list[dict[str, object]] = []
    for native_id in sorted(set(previous) | set(current)):
        old = previous.get(native_id)
        item = current.get(native_id)
        if item == old:
            continue
        if item is None:
            events.append(
                {
                    "kind": "deleted",
                    "nativeId": native_id,
                    "revision": str(old.get("revision") if isinstance(old, dict) else "deleted"),
                    "contentSha256": None,
                    "sizeBytes": None,
                    "mimeType": None,
                    "documentId": None,
                    "sourceIdempotencyKey": None,
                }
            )
            continue
        kind = "changed" if old is not None else "added"
        mime_type = item.get("mimeType")
        document_id = None
        source_key = None
        temp_path: Path | None = None
        snapshot_directory = None
        source_path = root / Path(native_id) if root else None
        if isinstance(mime_type, str):
            source_key = sha256("\x1f".join((args.connection_id, native_id, str(item["revision"]))))
            if source_path is None:
                temp_path = download_s3(cloud, args, native_id, int(item["sizeBytes"]), str(item["revision"]))
                source_path = temp_path
                _, content_digest = file_digest(source_path, args.max_file_bytes)
                item["contentSha256"] = content_digest
            else:
                source_path, snapshot_directory = snapshot_mount(source_path, item, args.max_file_bytes)
            try:
                document_id = client.upload(source_path, mime_type, source_key, Path(native_id).name)
            finally:
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
                if snapshot_directory is not None:
                    snapshot_directory.cleanup()
        events.append(
            {
                "kind": kind,
                "nativeId": native_id,
                "revision": item["revision"],
                "contentSha256": item.get("contentSha256"),
                "sizeBytes": item["sizeBytes"],
                "mimeType": mime_type,
                "documentId": document_id,
                "sourceIdempotencyKey": source_key,
            }
        )
    if not events and next_cursor == state["serverCursorSha256"]:
        if existing_scope is None:
            write_state(args.state, args.connection_id, current, next_cursor, fingerprint)
        return {"status": "unchanged", "eventCount": 0}
    if len(events) > args.max_events or len(canonical(events).encode("utf-8")) > 1_000_000:
        raise AgentError("source batch exceeds bounded API limit; split the registered scope")
    batch_id = str(uuid.uuid4())
    pending = {
        "scopeFingerprint": fingerprint,
        "connectionId": args.connection_id,
        "files": current,
        "body": {
            "batchId": batch_id,
            "previousCursorSha256": state["serverCursorSha256"],
            "nextCursorSha256": next_cursor,
            "manifestSha256": "sha256:" + sha256(canonical(events)),
            "events": events,
        },
    }
    write_journal(pending_path, pending)
    return commit_pending(args, client, pending_path, pending)


def source_fingerprint(args: argparse.Namespace) -> str:
    return sha256(canonical({
        "baseUrl": args.base_url.rstrip("/"),
        "root": str(args.root.resolve(strict=True)) if args.root else None,
        "bucket": args.s3_bucket, "prefix": args.s3_prefix,
        "endpoint": args.s3_endpoint_url, "region": args.s3_region,
    }))


def fsync_directory(path: Path) -> None:
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def write_journal(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.chmod(name, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(canonical(payload))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        fsync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def commit_pending(args: argparse.Namespace, client: FoundationClient, path: Path, pending: dict[str, Any]) -> dict[str, object]:
    body = pending["body"]
    result = client.post(
        f"/api/v1/connections/{args.connection_id}/sync", body,
    )
    if result.get("status") not in {"applied", "replayed"}:
        raise AgentError("Foundation did not commit the cursor batch")
    write_state(args.state, args.connection_id, pending["files"], body["nextCursorSha256"], pending["scopeFingerprint"])
    path.unlink(missing_ok=True)
    fsync_directory(path.parent)
    return {"status": result["status"], "eventCount": len(body["events"]), "batchId": body["batchId"]}


@contextmanager
def state_lock(path: Path):
    """OS advisory locks release on process exit; never remove the shared lock inode."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(path.name + ".lock")
    with lock_path.open("a+b") as handle:
        os.chmod(lock_path, 0o600)
        handle.seek(0)
        # Windows byte-range locks deny reads before the second writer can attempt its lock.
        # Inspect size without touching the locked byte, then let the OS lock report contention.
        if os.fstat(handle.fileno()).st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise AgentError("another agent owns this state file") from exc
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def sync(args: argparse.Namespace) -> dict[str, object]:
    if args.root and args.state.resolve().is_relative_to(args.root.resolve(strict=True)):
        raise AgentError("state and journal must be outside the source root")
    with state_lock(args.state):
        return _sync(args)


def run(args: argparse.Namespace, *, sleep=time.sleep, emit=print) -> int:
    if args.poll_seconds < 1 or args.retry_limit < 0 or args.retry_limit > 10 or args.max_cycles < 0 or args.max_events < 1 or args.max_events > 5000 or args.max_file_bytes < 1 or args.max_upload_bytes < 1 or args.timeout_seconds <= 0:
        raise AgentError("invalid bounded agent settings")
    cycle = 0
    while True:
        for attempt in range(args.retry_limit + 1):
            try:
                result = sync(args)
                break
            except RetryableAgentError:
                if attempt == args.retry_limit:
                    raise
                emit(canonical({"status": "retrying", "attempt": attempt + 1}))
                sleep(min(2 ** attempt, 30))
        emit(canonical(result))
        cycle += 1
        if not args.watch or (args.max_cycles and cycle >= args.max_cycles):
            return 0
        sleep(args.poll_seconds)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Sync mounted or S3-compatible storage to TAVONEL")
    source = value.add_mutually_exclusive_group(required=True)
    source.add_argument("--root", type=Path, help="Mounted read-only SMB/NFS/SFTP directory")
    source.add_argument("--s3-bucket", help="AWS S3, Cloudflare R2, or MinIO bucket")
    value.add_argument(
        "--connection-id", required=True, help="UUID shown in Workspace > Connections"
    )
    value.add_argument("--state", type=Path, required=True, help="Local cursor state file")
    value.add_argument("--base-url", default=os.environ.get("TAVONEL_BASE_URL", DEFAULT_BASE_URL))
    value.add_argument("--max-file-bytes", type=int, default=512 * 1024 * 1024)
    value.add_argument("--timeout-seconds", type=float, default=60.0)
    value.add_argument("--watch", action="store_true", help="Repeat bounded sync cycles until stopped")
    value.add_argument("--poll-seconds", type=float, default=30.0)
    value.add_argument("--max-cycles", type=int, default=0, help="Stop after N cycles; 0 is unlimited watch")
    value.add_argument("--retry-limit", type=int, default=3, help="Bounded retries for transient HTTP/network errors")
    value.add_argument("--max-events", type=int, default=5000)
    value.add_argument("--max-upload-bytes", type=int, default=512 * 1024 * 1024, help="Maximum supported-file bytes uploaded per cycle")
    value.add_argument("--allow-empty-snapshot", action="store_true", help="Allow an empty complete inventory to suspend all previous sources")
    value.add_argument("--adopt-legacy-state", action="store_true", help="Bind old state after verifying unchanged source and API scope")
    value.add_argument("--s3-prefix", default="")
    value.add_argument("--s3-region")
    value.add_argument("--s3-endpoint-url")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        return run(args)
    except KeyboardInterrupt:
        return 130
    except (AgentError, ValueError, OSError):
        # No raw HTTP body, source path, URL, credentials or traceback in unattended logs.
        print(canonical({"status": "failed", "code": "SOURCE_SYNC_FAILED", "checkpointPreserved": True}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
