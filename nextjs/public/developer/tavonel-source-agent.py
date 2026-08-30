#!/usr/bin/env python3
"""TAVONEL local source agent for mounted shares and S3-compatible storage.

The API key is read only from TAVONEL_API_KEY. Source bytes travel directly to
short-lived object-store upload URLs, and local cursor state advances only after
the Foundation commits the corresponding cursor batch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
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
    return {"files": value["files"], "serverCursorSha256": cursor}


def write_state(
    path: Path,
    connection_id: str,
    files: dict[str, dict[str, object]],
    cursor: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical(
        {
            "schemaVersion": SCHEMA,
            "connectionId": connection_id,
            "serverCursorSha256": cursor,
            "files": files,
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
    finally:
        Path(temp_name).unlink(missing_ok=True)


class FoundationClient:
    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        if not safe_url(base_url):
            raise ValueError("TAVONEL_BASE_URL must use HTTPS (or exact loopback for tests)")
        if not api_key.startswith("tvnl_live_"):
            raise ValueError("TAVONEL_API_KEY is missing or malformed")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

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
            with urllib.request.urlopen(  # noqa: S310 - request uses the validated base.
                request, timeout=self.timeout
            ) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            detail = exc.read(1024).decode("utf-8", errors="replace")
            raise AgentError(f"Foundation HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AgentError(f"Foundation request failed: {exc.reason}") from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentError("Foundation response exceeded the bounded limit")
        try:
            value = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AgentError("Foundation returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise AgentError("Foundation response must be an object")
        return value

    def upload(self, path: Path, mime_type: str, idempotency_key: str) -> str:
        size = path.stat().st_size
        capability = self.post(
            "/api/v1/uploads/capability",
            {
                "originalFilename": path.name,
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
                with urllib.request.urlopen(  # noqa: S310 - validated capability URL.
                    request, timeout=self.timeout
                ) as response:
                    if response.status not in {200, 201, 204}:
                        raise AgentError(f"direct upload returned HTTP {response.status}")
            except urllib.error.HTTPError as exc:
                raise AgentError(f"direct upload returned HTTP {exc.code}") from exc
            except urllib.error.URLError as exc:
                raise AgentError(f"direct upload failed: {exc.reason}") from exc
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise AgentError(f"{path.name!r} changed during upload")
        return document_id


def file_digest(path: Path, max_file_bytes: int) -> tuple[int, str]:
    stat = path.stat()
    if stat.st_size > max_file_bytes:
        raise AgentError(f"{path.name!r} exceeds --max-file-bytes")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if path.stat().st_size != stat.st_size:
        raise AgentError(f"{path.name!r} changed during scan")
    return stat.st_size, digest.hexdigest()


def scan_mount(root: Path, max_file_bytes: int) -> dict[str, dict[str, object]]:
    resolved = root.resolve(strict=True)
    if not resolved.is_dir():
        raise AgentError("--root must be a directory")
    files: dict[str, dict[str, object]] = {}
    for path in sorted(resolved.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        if not path.resolve().is_relative_to(resolved):
            raise AgentError("source path escaped the mounted root")
        size, digest = file_digest(path, max_file_bytes)
        native_id = path.relative_to(resolved).as_posix()
        files[native_id] = {
            "revision": sha256(f"{digest}\x1f{size}"),
            "sizeBytes": size,
            "contentSha256": digest,
            "mimeType": MIME_BY_SUFFIX.get(path.suffix.lower()),
        }
    return files


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
    while True:
        request: dict[str, object] = {
            "Bucket": args.s3_bucket,
            "Prefix": args.s3_prefix,
        }
        if token:
            request["ContinuationToken"] = token
        response = client.list_objects_v2(**request)
        for item in response.get("Contents", []):
            key = str(item.get("Key") or "")
            size = int(item.get("Size") or 0)
            if not key or size > args.max_file_bytes:
                if size > args.max_file_bytes:
                    raise AgentError(f"{key!r} exceeds --max-file-bytes")
                continue
            etag = str(item.get("ETag") or "").strip('"')
            files[key] = {
                "revision": f"etag:{etag}",
                "sizeBytes": size,
                "contentSha256": None,
                "mimeType": MIME_BY_SUFFIX.get(Path(key).suffix.lower()),
            }
        if not response.get("IsTruncated"):
            break
        next_token = response.get("NextContinuationToken")
        if not isinstance(next_token, str) or not next_token:
            raise AgentError("S3 listing omitted its continuation token")
        token = next_token
    return files


def download_s3(client: Any, args: argparse.Namespace, key: str, expected_size: int) -> Path:
    response = client.get_object(Bucket=args.s3_bucket, Key=key)
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


def sync(args: argparse.Namespace) -> dict[str, object]:
    state = read_state(args.state, args.connection_id)
    previous = state["files"]
    client = FoundationClient(
        args.base_url,
        os.environ.get("TAVONEL_API_KEY", ""),
        args.timeout_seconds,
    )
    root = args.root.resolve(strict=True) if args.root else None
    cloud = None if root else s3_client(args)
    current = scan_mount(root, args.max_file_bytes) if root else scan_s3(cloud, args)
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
        source_path = root / Path(native_id) if root else None
        if isinstance(mime_type, str):
            source_key = sha256("\x1f".join((args.connection_id, native_id, str(item["revision"]))))
            if source_path is None:
                temp_path = download_s3(cloud, args, native_id, int(item["sizeBytes"]))
                source_path = temp_path
                _, content_digest = file_digest(source_path, args.max_file_bytes)
                item["contentSha256"] = content_digest
            try:
                document_id = client.upload(source_path, mime_type, source_key)
            finally:
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
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
        return {"status": "unchanged", "eventCount": 0}
    batch_id = str(uuid.uuid4())
    result = client.post(
        f"/api/v1/connections/{args.connection_id}/sync",
        {
            "batchId": batch_id,
            "previousCursorSha256": state["serverCursorSha256"],
            "nextCursorSha256": next_cursor,
            "manifestSha256": "sha256:" + sha256(canonical(events)),
            "events": events,
        },
    )
    if result.get("status") not in {"applied", "replayed"}:
        raise AgentError("Foundation did not commit the cursor batch")
    write_state(args.state, args.connection_id, current, next_cursor)
    return {"status": result["status"], "eventCount": len(events), "batchId": batch_id}


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
    value.add_argument("--s3-prefix", default="")
    value.add_argument("--s3-region")
    value.add_argument("--s3-endpoint-url")
    return value


def main() -> int:
    args = parser().parse_args()
    print(canonical(sync(args)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
