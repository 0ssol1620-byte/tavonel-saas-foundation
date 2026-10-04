#!/usr/bin/env python3
"""TAVONEL local source agent for mounted shares and S3-compatible storage.

The API key is read only from TAVONEL_API_KEY. Source bytes travel directly to
short-lived object-store upload URLs, and local cursor state advances only after
the Foundation commits the corresponding cursor batch.

Provenance: the initial draft of this agent, including the metadata-only intake
plan, was authored by Codex. A later revision by Claude Opus 5.5 (r1) changed only
the intake plan (reparse-point confinement, the authoritative Foundation byte
ceiling, the file-count boundary and case-sensitive ordering). A subsequent Claude
Opus 5.5 revision (r2) replaced the intake plan's path-based traversal and its
before/after path re-checks with traversal anchored to held directory handles, and
fails closed where that cannot be established. A Claude Opus 5.5 r3 revision made
those Windows opens follow each directory's own case policy and fails closed where
case-only sibling names could be confused. Normal sync processing is unchanged by
all three revisions. A later Claude Opus 5.5 revision binds every sync upload to one
quoted, caller-approved intake set per cursor cycle (see approve_and_upload); cycles
without uploads are unchanged. A Codex follow-up sends whole-set cancellation after a
definitive member PUT refusal, using the same persisted attempt and scope identity. This
file is of mixed authorship.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import errno
import fnmatch
import hashlib
import http.client
import json
import os
import re
import stat as stat_module
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, NamedTuple

SCHEMA = "tavonel.public-source-agent.v1"
DEFAULT_BASE_URL = "https://tavonel.com"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
PLAN_SCHEMA = "tavonel.source-intake-plan.v2"
# Mirrors PROCESSING_CEILING in shared/intakeCeiling.ts at Foundation PR head
# 5347af4d5f76ba971927105b0a3d5cf20e13224e (Git blob 48d5a5ba040138011c69ce11df415035d8fc1e02).
# maxSourceBytes is min(worker max, rasterizer max), each 5 MiB. Intake does not
# decode documents, so the page ceiling is disclosed there but never enforced.
FOUNDATION_MAX_SOURCE_BYTES = 5 * 1024 * 1024
FOUNDATION_MAX_SOURCE_PAGES = 80
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
PLAN_POLICY = {
    "version": 2,
    "allowSuffixes": sorted(MIME_BY_SUFFIX),
    "excludeDirectoryNames": [
        ".aws", ".cache", ".git", ".hg", ".mypy_cache", ".next", ".pytest_cache",
        ".ruff_cache", ".ssh", ".svn", ".turbo", ".venv", "__pycache__", "build",
        "coverage", "dist", "node_modules", "system volume information", "$recycle.bin",
    ],
    "excludeFileNames": [".ds_store", ".netrc", ".npmrc", ".pypirc", "thumbs.db", "desktop.ini"],
    "excludeNamePatterns": [
        ".env", ".env.*", "credentials", "credentials.*", "secrets.json", "secrets.*",
        "token", "token.*", "*.token", "passwords.*", "*.pem", "*.key", "*.p12",
        "*.pfx", "*.keystore", "id_rsa*", "id_ed25519*",
    ],
    "excludeSuffixes": [".cache", ".lock", ".log", ".pyc", ".pyo", ".tmp", ".swp", ".swo"],
    # Bounds on this planner's own work and output. These are not service admission
    # limits and never make a file eligible.
    "scanBudgets": {
        "fileCount": 5000,
        "candidateBytes": 536870912,
        "elapsedSeconds": 5.0,
        "manifestEntries": 2000,
        "outputBytes": 1048576,
    },
    # Disclosed Foundation ceiling. Only the byte ceiling is checked here, from file
    # metadata; the Foundation, not this plan, decides service admission.
    "serviceCeiling": {
        "authority": "shared/intakeCeiling.ts#PROCESSING_CEILING",
        "authorityCommit": "5347af4d5f76ba971927105b0a3d5cf20e13224e",
        "authorityBlob": "48d5a5ba040138011c69ce11df415035d8fc1e02",
        "maxSourceBytes": FOUNDATION_MAX_SOURCE_BYTES,
        "maxSourcePages": FOUNDATION_MAX_SOURCE_PAGES,
        "byteCeilingCheck": "local_metadata_size_only",
        "pageCeilingCheck": "disclosed_not_enforced_at_intake",
    },
}
# The shared intake-approval contract: one approval covers a cycle's whole changed upload set
# and is never split, so a larger set is refused before anything is quoted.
MAX_APPROVAL_FILES = 128
# Upper bound for --approve-up-to-credits, so a typo cannot authorize an unbounded spend.
MAX_APPROVE_CREDITS = 10_000_000
ATTEMPT_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
SHA256_DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)
RESPONSE_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{1,80}$")
APPROVAL_FILE_STATES = frozenset({"approved", "reserved", "confirmed", "cancelled"})
STALE_APPROVAL_CODES = frozenset({"INTAKE_PRICE_STALE", "INTAKE_APPROVAL_AGGREGATE_MISMATCH"})
ALREADY_CONFIRMED_CODES = frozenset({"INTAKE_FILE_ALREADY_CONFIRMED", "INTAKE_APPROVAL_FILE_ALREADY_CONFIRMED"})
DISCARD_HINT = "delete the state file's .pending journal and rerun to quote the current set again"


class AgentError(RuntimeError):
    """One polling cycle could not be committed safely."""


class RetryableAgentError(AgentError):
    """A bounded retry may recover; durable pending batches must be replayed."""


class ReviewRequiredError(AgentError):
    """The caller must decide; the message is safe to print and says what to do next."""


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


def intake_file_key(relative_path: str, content_sha256: str, byte_length: int, mime_type: str) -> str:
    """lib/intake-approval.ts#deriveFileKey: one member per (path, plain-hex content, length, type)."""
    return "fk_" + sha256("\x1f".join(
        ("tavonel-intake-file-v1", relative_path, content_sha256, str(byte_length), mime_type)
    ))[:40]


def intake_manifest_digest(entries: list[dict[str, Any]]) -> str:
    """lib/intake-approval.ts#intakeManifestDigest: members sorted by file key, one line each."""
    lines = [
        "|".join((
            entry["fileKey"], entry["contentSha256"], str(entry["byteLength"]), entry["mimeType"],
            "-" if entry["claimedPages"] is None else str(entry["claimedPages"]), entry["claimedBasis"] or "-",
        ))
        for entry in sorted(entries, key=lambda entry: entry["fileKey"])
    ]
    return "sha256:" + sha256("\n".join(["tavonel-intake-manifest-v1", str(len(entries)), *lines]))


def approved_source_idempotency_key(attempt_key: str, file_key: str) -> str:
    """The capability's x-tavonel-source-idempotency-key, recomputed by the server from the member."""
    return sha256("\x1f".join(("tavonel-approved-source-v1", attempt_key, file_key)))


def intake_manifest_entry(native_id: str, item: dict[str, object]) -> dict[str, Any]:
    mime_type = str(item["mimeType"])
    size = int(item["sizeBytes"])
    digest = str(item["contentSha256"])
    image = mime_type.startswith("image/")
    return {
        "fileKey": intake_file_key(native_id, digest, size, mime_type),
        "originalFilename": Path(native_id).name,
        "contentSha256": "sha256:" + digest,
        "byteLength": size,
        "mimeType": mime_type,
        # An image is one page; nothing else has a page count this agent can vouch for.
        "claimedPages": 1 if image else None,
        "claimedBasis": "image" if image else None,
    }


def response_code(value: dict[str, Any] | None, status: int) -> str:
    code = value.get("code") if value is not None else None
    return code if isinstance(code, str) and RESPONSE_CODE_PATTERN.match(code) else f"HTTP {status}"


def reply_uncertain(status: int) -> bool:
    """No reply, or one that says nothing about whether the request committed."""
    return status == 0 or status in {408, 429} or status >= 500


def refusal(action: str, code: str) -> AgentError:
    if code in STALE_APPROVAL_CODES:
        return ReviewRequiredError(f"the {action} was refused because the approved price is stale ({code}); {DISCARD_HINT}")
    return AgentError(f"{action} was refused ({code})")


def _count(value: object) -> bool:
    return type(value) is int and value >= 0


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

    def _exchange(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, Any] | None]:
        """One authenticated Foundation request: any HTTP status is returned, a lost reply raises."""
        request = urllib.request.Request(  # noqa: S310 - base URL validated in __init__.
            f"{self.base_url}{path}",
            data=None if body is None else canonical(body).encode("utf-8"),
            method=method,
            headers={
                "authorization": f"Bearer {self.api_key}",
                **({} if body is None else {"content-type": "application/json"}),
                **(headers or {}),
            },
        )
        try:
            with self.opener.open(  # noqa: S310 - request uses the validated base.
                request, timeout=self.timeout
            ) as response:
                status = response.status
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                raw = exc.read(MAX_RESPONSE_BYTES + 1)
            except (OSError, http.client.HTTPException):
                raw = b""
            finally:
                exc.close()
        except (OSError, http.client.HTTPException) as exc:
            # A reply that never arrived says nothing about whether the request committed.
            raise RetryableAgentError("Foundation network request failed") from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            if 200 <= status < 300:
                raise AgentError("Foundation response exceeded the bounded limit")
            raw = b""
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError):
            value = None
        return status, value if isinstance(value, dict) else None

    def post(
        self,
        path: str,
        body: dict[str, object],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        status, value = self._exchange("POST", path, body, headers)
        if not 200 <= status < 300:
            error = RetryableAgentError if status in {408, 429} or status >= 500 else AgentError
            raise error(f"Foundation HTTP {status}")
        if value is None:
            raise AgentError("Foundation returned invalid JSON")
        return value

    def quote(self, body: dict[str, Any]) -> dict[str, Any]:
        """A quote holds nothing, so a lost reply is simply asked again."""
        status, value = self._exchange("POST", "/api/v1/uploads/quote", body)
        if reply_uncertain(status):
            raise RetryableAgentError(f"Foundation quote returned HTTP {status}")
        if status != 200 or value is None:
            raise ReviewRequiredError(
                f"the Foundation refused to quote the changed set ({response_code(value, status)}); nothing was "
                f"approved, reserved or uploaded. Review the changed files, then {DISCARD_HINT}"
            )
        return value

    def read_approval(self, attempt_key: str) -> dict[str, Any] | None:
        """The committed state of one attempt, or None when the Foundation holds no such attempt."""
        status, value = self._exchange(
            "GET", "/api/v1/uploads/approval?attemptKey=" + urllib.parse.quote(attempt_key, safe=""),
        )
        if status == 404:
            return None
        if reply_uncertain(status):
            raise RetryableAgentError(f"approval status returned HTTP {status}")
        approval = value.get("approval") if value is not None else None
        if status != 200 or not isinstance(approval, dict):
            raise AgentError(f"approval status was refused ({response_code(value, status)})")
        return approval

    def create_approval(self, body: dict[str, Any]) -> dict[str, Any]:
        """POST the saved approval body; a lost reply is answered by reading it back, never by a guess."""
        try:
            status, value = self._exchange("POST", "/api/v1/uploads/approval", body)
        except RetryableAgentError:
            status, value = 0, None
        approval = value.get("approval") if value is not None else None
        if status == 200 and isinstance(approval, dict) and value.get("code") == "INTAKE_APPROVED":
            return approval
        if status == 200 or reply_uncertain(status):
            recovered = self.read_approval(str(body["attemptKey"]))
            if recovered is not None:
                return recovered
            raise RetryableAgentError(
                "approval reply was lost before it committed; the retry re-reads, then re-sends the same saved approval"
            )
        code = response_code(value, status)
        if code in STALE_APPROVAL_CODES:
            raise ReviewRequiredError(
                f"the saved quote is no longer the Foundation's price ({code}); nothing was approved or reserved. "
                f"Review current pricing, then {DISCARD_HINT}"
            )
        raise ReviewRequiredError(
            f"the Foundation refused to approve the saved set ({code}); nothing was approved or reserved. "
            f"Resolve it and rerun to re-send the same approval, or {DISCARD_HINT}"
        )

    def _member_confirmed(self, attempt_key: str, file_key: str, document_id: str) -> bool:
        approval = self.read_approval(attempt_key)
        files = approval.get("files") if approval is not None else None
        held = next(
            (item for item in files if isinstance(item, dict) and item.get("fileKey") == file_key), None,
        ) if isinstance(files, list) else None
        return held is not None and held.get("fileState") == "confirmed" and held.get("documentId") == document_id

    def cancel_approval(self, attempt_key: str, scope_digest: str, file_key: str) -> dict[str, Any]:
        """Cancel the caller's complete approved set, anchored to one member identity."""
        status, value = self._exchange(
            "POST", "/api/v1/uploads/approval/cancel",
            {"attemptKey": attempt_key, "scopeDigest": scope_digest, "fileKey": file_key},
        )
        code = response_code(value, status)
        if status == 200 and code in {"INTAKE_SET_CANCELLED", "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED"}:
            result = value.get("result") if value is not None else None
            if isinstance(result, dict):
                return result
            raise AgentError("Foundation returned an invalid set-cancellation result")
        if reply_uncertain(status):
            raise RetryableAgentError("approved-set cancellation reply was lost; retry the same attempt, scope and member")
        raise refusal("approved-set cancellation", code)

    def _release(
        self, attempt_key: str, scope_digest: str, file_key: str, document_id: str, put_status: int,
    ) -> None:
        """After a definitive PUT refusal only: the Foundation checks for the object before releasing."""
        status, value = self._exchange(
            "POST",
            "/api/v1/uploads/release",
            {"documentId": document_id, "attemptKey": attempt_key, "fileKey": file_key},
        )
        code = response_code(value, status)
        if status == 409 and code == "UPLOAD_ALREADY_STORED":
            return  # The object landed and only the PUT's reply was a refusal: confirm it.
        if status == 200 and code == "UPLOAD_CREDITS_RELEASED":
            # A failed member makes the complete approved set unusable. Release the failed
            # member first, then atomically cancel the remaining members under the same scope.
            cancellation = self.cancel_approval(attempt_key, scope_digest, file_key)
            reconciliation = cancellation.get("reconciliationRequired") is True
            detail = "the complete set was cancelled, but a settled member needs reconciliation" if reconciliation \
                else "the complete approved set was cancelled"
            raise ReviewRequiredError(
                f"the object store refused an approved file (HTTP {put_status}) and its hold was released; {detail}. "
                f"Review the changed files, then {DISCARD_HINT}"
            )
        if reply_uncertain(status):
            raise RetryableAgentError("upload release reply was lost")
        raise AgentError(f"upload release was refused ({code})")

    def upload(
        self,
        path: Path,
        member: dict[str, Any],
        attempt: dict[str, str],
        on_phase: Callable[[str], None] | None = None,
    ) -> str:
        """Capability, direct PUT and confirmation for one approved member.

        Returns only once the Foundation confirms the member, by its reply or by re-reading the
        approval. Retries name the same attempt, file key and document; the bearer token never
        travels to the object store, and a hold is released only after a definitive PUT refusal.
        """
        record = on_phase or (lambda phase: None)
        attempt_key = attempt["attemptKey"]
        file_key = str(member["fileKey"])
        document_id = str(member["documentId"])
        size = path.stat().st_size
        if size != member["byteLength"]:
            raise AgentError("sealed source does not match its approved length")
        record("capability_sent")
        try:
            status, value = self._exchange(
                "POST",
                "/api/v1/uploads/capability",
                {
                    "originalFilename": member["originalFilename"],
                    "declaredMimeType": member["mimeType"],
                    "requestedBytes": size,
                    "attemptKey": attempt_key,
                    "scopeDigest": attempt["scopeDigest"],
                    "pricingFingerprint": attempt["pricingFingerprint"],
                    "fileKey": file_key,
                    "contentSha256": member["contentSha256"],
                },
                {"x-tavonel-source-idempotency-key": approved_source_idempotency_key(attempt_key, file_key)},
            )
        except RetryableAgentError:
            status, value = 0, None
        code = response_code(value, status)
        if reply_uncertain(status) or code in ALREADY_CONFIRMED_CODES:
            if self._member_confirmed(attempt_key, file_key, document_id):
                return document_id
            if reply_uncertain(status):
                raise RetryableAgentError("upload capability reply was lost; the retry reuses the same approved member")
        if status != 200 or value is None:
            raise refusal("upload capability", code)
        upload_url = value.get("uploadUrl")
        reservation = value.get("computeReservation")
        if not isinstance(upload_url, str) or not safe_url(upload_url):
            raise AgentError("upload capability URL is invalid")
        if (
            value.get("documentId") != document_id
            or value.get("contentLength") != size
            or value.get("declaredMimeType") != member["mimeType"]
            or not isinstance(reservation, dict)
            or reservation.get("maximumCredits") != member["approvedMaximumCredits"]
        ):
            raise AgentError("upload capability does not match the approved member")
        record("put_sent")
        before = path.stat()
        refused: int | None = None
        with path.open("rb") as source:
            request = urllib.request.Request(  # noqa: S310 - capability URL validated above.
                upload_url,
                data=source,
                method="PUT",
                # Signed URL only: the Foundation bearer token never travels to the object store.
                headers={"content-type": member["mimeType"], "content-length": str(size)},
            )
            try:
                with self.opener.open(  # noqa: S310 - validated capability URL.
                    request, timeout=self.timeout
                ) as response:
                    if response.status not in {200, 201, 204}:
                        raise AgentError(f"direct upload returned HTTP {response.status}")
            except urllib.error.HTTPError as exc:
                exc.close()
                if exc.code in {408, 429} or exc.code >= 500:
                    raise RetryableAgentError(f"direct upload returned HTTP {exc.code}") from exc
                if exc.code < 400:
                    raise AgentError(f"direct upload returned HTTP {exc.code}") from exc
                refused = exc.code
            except (OSError, http.client.HTTPException) as exc:
                # The object may exist now, so its hold is never released on this path.
                raise RetryableAgentError("direct upload network request failed") from exc
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise AgentError(f"{path.name!r} changed during upload")
        if refused is not None:
            self._release(attempt_key, attempt["scopeDigest"], file_key, document_id, refused)
        record("confirm_sent")
        try:
            status, value = self._exchange(
                "POST",
                "/api/v1/uploads/confirm",
                {
                    "documentId": document_id,
                    "sourceSha256": member["contentSha256"],
                    "attemptKey": attempt_key,
                    "scopeDigest": attempt["scopeDigest"],
                    "fileKey": file_key,
                },
            )
        except RetryableAgentError:
            status, value = 0, None
        approved = value.get("approvedFile") if value is not None else None
        if (
            status == 200
            and isinstance(approved, dict)
            and value.get("code") == "UPLOAD_CONFIRMED"
            and approved.get("fileState") == "confirmed"
            and approved.get("documentId") == document_id
            and approved.get("fileKey") == file_key
        ):
            return document_id
        if status == 200 or reply_uncertain(status):
            if self._member_confirmed(attempt_key, file_key, document_id):
                return document_id
            raise RetryableAgentError(
                "upload confirmation reply was lost; the retry re-reads the approval before reusing the same member"
            )
        raise refusal("upload confirmation", response_code(value, status))


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


# Handle-anchored intake traversal. The plan never re-resolves a path string once it
# holds a directory: the root is reached by a no-follow walk of single names beneath
# already-held handles, each queued directory is opened by one name beneath its held
# parent, and each listing reads the held handle. Where that cannot be established the
# plan fails closed before listing anything; there is no path-based fallback.

# Windows NT values (winnt.h, ntifs.h, ntstatus.h, winerror.h).
_FILE_LIST_DIRECTORY = 0x0001
_FILE_TRAVERSE = 0x0020
_FILE_READ_ATTRIBUTES = 0x0080
_SYNCHRONIZE = 0x00100000
# Read, write and delete sharing: the plan never blocks the customer's own edits or renames.
_FILE_SHARE_ALL = 0x0007
_FILE_OPEN = 0x0001
_FILE_DIRECTORY_FILE = 0x0001
_FILE_SYNCHRONOUS_IO_NONALERT = 0x0020
_FILE_OPEN_REPARSE_POINT = 0x00200000
# A reparse point named by the single relative component is opened as itself, never followed.
_NT_DIRECTORY_OPEN_OPTIONS = _FILE_DIRECTORY_FILE | _FILE_SYNCHRONOUS_IO_NONALERT | _FILE_OPEN_REPARSE_POINT
# Never passed to NtCreateFile: each lookup follows its directory's own case policy.
_OBJ_CASE_INSENSITIVE = 0x0040
_OPEN_EXISTING = 3
_FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
_FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
_FILE_ATTRIBUTE_DIRECTORY = 0x0010
_FILE_ATTRIBUTE_REPARSE_POINT = 0x0400
_IO_REPARSE_TAG_SYMLINK = 0xA000000C
_STATUS_OBJECT_NAME_NOT_FOUND = 0xC0000034
_STATUS_OBJECT_PATH_NOT_FOUND = 0xC000003A
_STATUS_NOT_A_DIRECTORY = 0xC0000103
_FILE_ATTRIBUTE_TAG_INFO = 9
_FILE_CASE_SENSITIVE_INFO = 23
_FILE_CS_FLAG_CASE_SENSITIVE_DIR = 0x0001
_FILE_FULL_DIRECTORY_INFO = 14
_FILE_FULL_DIRECTORY_RESTART_INFO = 15
_FILE_FS_DEVICE_INFORMATION = 4
_FILE_REMOTE_DEVICE = 0x0010
_FILE_DEVICE_NETWORK_FILE_SYSTEM = 0x0014
_ERROR_FILE_NOT_FOUND = 2
_ERROR_NO_MORE_FILES = 18
_FILETIME_UNIX_EPOCH = 116444736000000000
_INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
# FILE_FULL_DIR_INFO up to FileName: offsets, times, sizes, attributes, name length, EaSize.
_FULL_DIR_INFO = struct.Struct("<IIqqqqqqIII")

# Linux statfs f_type magic numbers of local file systems (linux/magic.h, ZFS).
_LINUX_LOCAL_FILESYSTEMS = frozenset({
    0x0000EF53,  # ext2, ext3, ext4
    0x58465342,  # xfs
    0x9123683E,  # btrfs
    0x01021994,  # tmpfs
    0x2FC12FC1,  # zfs
    0xF2F52010,  # f2fs
    0x794C7630,  # overlayfs
})
_POSIX_DESCRIPTOR_TRAVERSAL = (
    os.name == "posix"
    and os.open in os.supports_dir_fd
    and os.stat in os.supports_dir_fd
    and os.stat in os.supports_follow_symlinks
    and os.scandir in os.supports_fd
    and hasattr(os, "O_DIRECTORY")
    and hasattr(os, "O_NOFOLLOW")
)


class UnsupportedSafeTraversal(Exception):
    """Handle-anchored traversal cannot be established here, so nothing is listed."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _RootRefused(Exception):
    """The root cannot be reached by a no-follow walk; it is reported, never listed."""

    def __init__(self, status: str, reason: str) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason


def _root_refusal(refusal: str | None, *, last: bool) -> _RootRefused:
    if refusal in {"symlink", "reparse_point"}:
        return _RootRefused("needs_review", f"root_{refusal}_not_followed" if last else f"root_ancestor_{refusal}_not_followed")
    return _RootRefused("inaccessible", "root_unavailable")


class _ChildMetadata(NamedTuple):
    link: str | None  # "symlink", "reparse_point" or "mount_point" is reported, never followed
    is_dir: bool
    is_regular: bool
    size: int
    mtime_ns: int


class _Child:
    """One name listed from a held directory handle; metadata() never resolves a path."""

    __slots__ = ("name", "metadata")

    def __init__(self, name: str, metadata: Callable[[], _ChildMetadata]) -> None:
        self.name = name
        self.metadata = metadata


class _HeldDirectory:
    """A listed directory's handle, held open until each queued child is opened beneath it."""

    def __init__(self, backend: Any, handle: int) -> None:
        self.backend = backend
        self.handle: int | None = handle
        self.waiting = 0

    def wait_for(self, children: int) -> None:
        self.waiting = children
        if not children:
            self.close()

    def release(self) -> None:
        self.waiting -= 1
        if self.waiting <= 0:
            self.close()

    def close(self) -> None:
        if self.handle is not None:
            handle, self.handle = self.handle, None
            self.backend.close(handle)


def _valid_windows_component(name: str) -> bool:
    return bool(name) and name not in {".", ".."} and not any(character in name for character in '\\/:*?"<>|\x00')


def _case_collisions(names: list[str]) -> set[str]:
    """Sibling names that differ only by case, which a case-insensitive lookup could confuse.

    Both case foldings are checked, so this errs toward reporting a collision.
    """
    colliding: set[str] = set()
    for fold in (str.casefold, str.upper):
        groups: dict[str, list[str]] = {}
        for name in names:
            groups.setdefault(fold(name), []).append(name)
        colliding.update(name for group in groups.values() if len(group) > 1 for name in group)
    return colliding


class _WindowsTraversal:
    """NT handle-relative traversal on a local NTFS or ReFS volume.

    Only the drive's root directory is opened by name. Every later directory, root
    ancestors included, is opened by NtCreateFile with one name relative to the
    already-held parent handle and FILE_OPEN_REPARSE_POINT, so a junction, symbolic
    link or other reparse point is opened as itself and refused from its own handle's
    attributes. Listings read FILE_FULL_DIR_INFO from the held handle. Opens never ask
    for case-insensitive lookup, so each name is matched under its directory's own case
    policy; that policy is only ever read, never set.
    """

    mode = "windows_nt_relative_open_no_reparse"
    SUPPORTED_FILESYSTEMS = frozenset({"NTFS", "ReFS"})

    def __init__(self) -> None:
        from ctypes import wintypes

        try:
            ntdll = ctypes.WinDLL("ntdll")
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            self._nt_create_file = ntdll.NtCreateFile
            self._nt_query_volume = ntdll.NtQueryVolumeInformationFile
            self._status_to_error = ntdll.RtlNtStatusToDosError
            self._create_file = kernel32.CreateFileW
            self._close_handle = kernel32.CloseHandle
            self._info_by_handle = kernel32.GetFileInformationByHandleEx
            self._volume_by_handle = kernel32.GetVolumeInformationByHandleW
        except (OSError, AttributeError) as exc:
            raise UnsupportedSafeTraversal("native_api_unavailable") from exc

        class UnicodeString(ctypes.Structure):
            _fields_ = [("Length", ctypes.c_ushort), ("MaximumLength", ctypes.c_ushort), ("Buffer", ctypes.c_void_p)]

        class ObjectAttributes(ctypes.Structure):
            _fields_ = [
                ("Length", wintypes.ULONG), ("RootDirectory", wintypes.HANDLE),
                ("ObjectName", ctypes.POINTER(UnicodeString)), ("Attributes", wintypes.ULONG),
                ("SecurityDescriptor", ctypes.c_void_p), ("SecurityQualityOfService", ctypes.c_void_p),
            ]

        class IoStatusBlock(ctypes.Structure):
            _fields_ = [("Status", ctypes.c_void_p), ("Information", ctypes.c_size_t)]

        self._wintypes = wintypes
        self._UnicodeString = UnicodeString
        self._ObjectAttributes = ObjectAttributes
        self._IoStatusBlock = IoStatusBlock
        self._nt_create_file.restype = ctypes.c_ulong
        self._nt_create_file.argtypes = [
            ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, ctypes.POINTER(ObjectAttributes),
            ctypes.POINTER(IoStatusBlock), ctypes.c_void_p, wintypes.ULONG, wintypes.ULONG,
            wintypes.ULONG, wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG,
        ]
        self._nt_query_volume.restype = ctypes.c_ulong
        self._nt_query_volume.argtypes = [wintypes.HANDLE, ctypes.POINTER(IoStatusBlock), ctypes.c_void_p, wintypes.ULONG, ctypes.c_int]
        self._status_to_error.restype = ctypes.c_ulong
        self._status_to_error.argtypes = [ctypes.c_ulong]
        self._create_file.restype = wintypes.HANDLE
        self._create_file.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
        ]
        self._close_handle.restype = wintypes.BOOL
        self._close_handle.argtypes = [wintypes.HANDLE]
        self._info_by_handle.restype = wintypes.BOOL
        self._info_by_handle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self._volume_by_handle.restype = wintypes.BOOL
        self._volume_by_handle.argtypes = [
            wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
        ]

    @staticmethod
    def _split(path: str) -> tuple[str, list[str]]:
        if path.startswith("\\\\?\\") and path[4:5].isalpha() and path[5:7] == ":\\":
            path = path[4:]
        drive, rest = os.path.splitdrive(path)
        if len(drive) != 2 or drive[1] != ":" or not "A" <= drive[0].upper() <= "Z":
            # UNC shares, device paths and network redirectors cannot be anchored here.
            raise UnsupportedSafeTraversal("path_not_on_local_drive_letter")
        components = [part for part in rest.split("\\") if part]
        if not rest.startswith("\\") or not all(_valid_windows_component(part) for part in components):
            raise _RootRefused("inaccessible", "root_unavailable")
        return drive.upper(), components

    def open_root(self, path: str) -> int:
        drive, components = self._split(path)
        access = _FILE_READ_ATTRIBUTES | _FILE_TRAVERSE | (0 if components else _FILE_LIST_DIRECTORY)
        volume = self._create_file(
            "\\\\?\\" + drive + "\\", access | _SYNCHRONIZE, _FILE_SHARE_ALL, None, _OPEN_EXISTING,
            _FILE_FLAG_BACKUP_SEMANTICS | _FILE_FLAG_OPEN_REPARSE_POINT, None,
        )
        if volume is None or volume == _INVALID_HANDLE_VALUE:
            raise ctypes.WinError(ctypes.get_last_error())
        current: int | None = volume
        try:
            # Refuse remote and unlisted file systems before any directory beneath the drive is opened.
            self._require_supported_volume(current)
            attributes, _ = self._attributes(current)
            if attributes & _FILE_ATTRIBUTE_REPARSE_POINT or not attributes & _FILE_ATTRIBUTE_DIRECTORY:
                raise UnsupportedSafeTraversal("volume_root_not_a_plain_directory")
            for index, name in enumerate(components):
                last = index == len(components) - 1
                handle, refusal = self.open_beneath(current, name, listing=last)
                if handle is None:
                    raise _root_refusal(refusal, last=last)
                self.close(current)
                current = handle
            root, current = current, None
            return root
        finally:
            if current is not None:
                self.close(current)

    def open_beneath(self, parent: int, name: str, *, listing: bool) -> tuple[int | None, str | None]:
        """Open one directory name beneath a held handle; a reparse point is refused, not followed."""
        if not _valid_windows_component(name):
            return None, "invalid_name"
        access = _FILE_READ_ATTRIBUTES | _FILE_TRAVERSE | (_FILE_LIST_DIRECTORY if listing else 0)
        handle, status = self._nt_open(parent, name, access)
        if handle is None:
            if status == _STATUS_NOT_A_DIRECTORY:
                return None, "not_a_directory"
            if status in {_STATUS_OBJECT_NAME_NOT_FOUND, _STATUS_OBJECT_PATH_NOT_FOUND}:
                return None, "missing"
            raise ctypes.WinError(self._status_to_error(status))
        try:
            attributes, tag = self._attributes(handle)
        except OSError:
            self.close(handle)
            raise
        if attributes & _FILE_ATTRIBUTE_REPARSE_POINT:
            self.close(handle)
            return None, "symlink" if tag == _IO_REPARSE_TAG_SYMLINK else "reparse_point"
        if not attributes & _FILE_ATTRIBUTE_DIRECTORY:
            self.close(handle)
            return None, "not_a_directory"
        return handle, None

    def _nt_open(self, parent: int, name: str, access: int) -> tuple[int | None, int]:
        """The only NtCreateFile call: one name relative to the held parent handle."""
        encoded = name.encode("utf-16-le", "surrogatepass")
        buffer = ctypes.create_string_buffer(encoded, len(encoded))
        object_name = self._UnicodeString(len(encoded), len(encoded), ctypes.addressof(buffer))
        # No OBJ_CASE_INSENSITIVE: the exact listed name is matched under the directory's own
        # case policy, so a case-sensitive directory keeps "A" and "a" apart.
        attributes = self._ObjectAttributes(
            ctypes.sizeof(self._ObjectAttributes), parent, ctypes.pointer(object_name),
            0, None, None,
        )
        status_block = self._IoStatusBlock()
        handle = self._wintypes.HANDLE()
        status = self._nt_create_file(
            ctypes.byref(handle), access | _SYNCHRONIZE, ctypes.byref(attributes), ctypes.byref(status_block),
            None, 0, _FILE_SHARE_ALL, _FILE_OPEN, _NT_DIRECTORY_OPEN_OPTIONS, None, 0,
        )
        if status & 0x80000000:  # NT_SUCCESS is false for warning and error severities.
            return None, status
        return handle.value, status

    def _attributes(self, handle: int) -> tuple[int, int]:
        info = (self._wintypes.DWORD * 2)()
        if not self._info_by_handle(handle, _FILE_ATTRIBUTE_TAG_INFO, info, ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(info[0]), int(info[1])

    def exact_lookup(self, handle: int) -> bool:
        """Whether this held directory is flagged case-sensitive; a read-only query.

        Asked only when listed siblings differ by case alone. Windows can still match such a
        name case-insensitively in a directory without the flag (the object manager adds
        OBJ_CASE_INSENSITIVE by default), so an unflagged or unknown policy returns False.
        """
        info = (self._wintypes.ULONG * 1)()
        if not self._info_by_handle(handle, _FILE_CASE_SENSITIVE_INFO, info, ctypes.sizeof(info)):
            return False
        return bool(info[0] & _FILE_CS_FLAG_CASE_SENSITIVE_DIR)

    def _require_supported_volume(self, handle: int) -> None:
        filesystem = ctypes.create_unicode_buffer(64)
        if not self._volume_by_handle(handle, None, 0, None, None, None, filesystem, len(filesystem)):
            raise UnsupportedSafeTraversal("volume_information_unavailable")
        if filesystem.value not in self.SUPPORTED_FILESYSTEMS:
            raise UnsupportedSafeTraversal("filesystem_not_supported")
        # An SMB server resolves junctions on its side, so a remote volume can't be anchored here.
        device = (self._wintypes.ULONG * 2)()
        status_block = self._IoStatusBlock()
        status = self._nt_query_volume(handle, ctypes.byref(status_block), device, ctypes.sizeof(device), _FILE_FS_DEVICE_INFORMATION)
        if status & 0x80000000:
            raise UnsupportedSafeTraversal("volume_device_unavailable")
        if device[1] & _FILE_REMOTE_DEVICE or device[0] == _FILE_DEVICE_NETWORK_FILE_SYSTEM:
            raise UnsupportedSafeTraversal("remote_volume")

    @contextmanager
    def children(self, handle: int):
        yield self._list(handle)

    def _list(self, handle: int):
        buffer = ctypes.create_string_buffer(64 * 1024)
        information_class = _FILE_FULL_DIRECTORY_RESTART_INFO
        while True:
            if not self._info_by_handle(handle, information_class, buffer, len(buffer)):
                error = ctypes.get_last_error()
                if error in {_ERROR_NO_MORE_FILES, _ERROR_FILE_NOT_FOUND}:
                    return
                raise ctypes.WinError(error)
            information_class = _FILE_FULL_DIRECTORY_INFO
            raw = buffer.raw
            offset = 0
            while True:
                next_offset, _, _, _, modified, _, size, _, attributes, name_length, _ = _FULL_DIR_INFO.unpack_from(raw, offset)
                start = offset + _FULL_DIR_INFO.size
                name = raw[start:start + name_length].decode("utf-16-le", "surrogatepass")
                if name not in {".", ".."}:
                    is_dir = bool(attributes & _FILE_ATTRIBUTE_DIRECTORY)
                    link = None
                    if attributes & _FILE_ATTRIBUTE_REPARSE_POINT:
                        # FILE_FULL_DIR_INFO has no reparse tag (EaSize is the extended-attributes
                        # length), so any reparse point is reported generically and never opened.
                        link = "reparse_point"
                    metadata = _ChildMetadata(link, is_dir, not is_dir, size, (modified - _FILETIME_UNIX_EPOCH) * 100)
                    yield _Child(name, lambda metadata=metadata: metadata)
                if not next_offset:
                    break
                offset += next_offset

    def close(self, handle: int) -> None:
        self._close_handle(handle)


class _LinuxTraversal:
    """Descriptor-relative traversal on a local Linux file system.

    The root is reached by opening "/" and then one name at a time with O_DIRECTORY and
    O_NOFOLLOW relative to the descriptor held for its parent, so no symbolic link is
    followed anywhere on the path. Listings read the held descriptor (os.scandir(fd)),
    and child metadata comes from fstatat with AT_SYMLINK_NOFOLLOW against it. A child
    directory on another device is a mount point and is never followed.
    """

    mode = "linux_openat_nofollow"
    LOCAL_FILESYSTEMS = _LINUX_LOCAL_FILESYSTEMS

    def __init__(self) -> None:
        if not _POSIX_DESCRIPTOR_TRAVERSAL:
            raise UnsupportedSafeTraversal("descriptor_relative_api_unavailable")
        try:
            self._fstatfs = ctypes.CDLL(None, use_errno=True).fstatfs
        except (OSError, AttributeError) as exc:
            raise UnsupportedSafeTraversal("filesystem_type_unavailable") from exc
        self._fstatfs.argtypes = [ctypes.c_int, ctypes.c_void_p]
        self._fstatfs.restype = ctypes.c_int
        self._flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
        self._device: int | None = None

    def open_root(self, path: str) -> int:
        components = [part for part in path.split("/") if part]
        if not path.startswith("/") or any(part in {".", ".."} for part in components):
            raise _RootRefused("inaccessible", "root_unavailable")
        current: int | None = os.open("/", self._flags)
        try:
            for index, name in enumerate(components):
                last = index == len(components) - 1
                handle, refusal = self.open_beneath(current, name, listing=last)
                if handle is None:
                    raise _root_refusal(refusal, last=last)
                os.close(current)
                current = handle
            # Refuse network and unlisted file systems before the root is listed.
            self._require_local_filesystem(current)
            self._device = os.fstat(current).st_dev
            root, current = current, None
            return root
        finally:
            if current is not None:
                os.close(current)

    def open_beneath(self, parent: int, name: str, *, listing: bool) -> tuple[int | None, str | None]:
        """Open one directory name beneath a held descriptor; a symlink is refused, not followed."""
        try:
            handle = os.open(name, self._flags, dir_fd=parent)
        except OSError as error:
            if error.errno not in {errno.ELOOP, errno.ENOTDIR, errno.ENOENT}:
                raise
            # Linux reports ENOTDIR or ELOOP for a refused symlink; label it from its own metadata.
            try:
                metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                return None, "missing"
            return None, "symlink" if stat_module.S_ISLNK(metadata.st_mode) else "not_a_directory"
        if self._device is not None and os.fstat(handle).st_dev != self._device:
            os.close(handle)
            return None, "mount_point"
        return handle, None

    def _require_local_filesystem(self, handle: int) -> None:
        buffer = ctypes.create_string_buffer(512)
        if self._fstatfs(handle, buffer) != 0:
            raise UnsupportedSafeTraversal("filesystem_type_unavailable")
        if ctypes.c_long.from_buffer(buffer).value & 0xFFFFFFFF not in self.LOCAL_FILESYSTEMS:
            raise UnsupportedSafeTraversal("filesystem_not_supported")

    def exact_lookup(self, handle: int) -> bool:
        # openat matches a name byte for byte, and a casefold (+F) directory can't hold case-only siblings.
        return True

    @contextmanager
    def children(self, handle: int):
        with os.scandir(handle) as iterator:
            yield (_Child(entry.name, lambda entry=entry: self._metadata(entry)) for entry in iterator)

    def _metadata(self, entry: os.DirEntry) -> _ChildMetadata:
        # A descriptor-based scandir stats with fstatat(fd, name, AT_SYMLINK_NOFOLLOW).
        metadata = entry.stat(follow_symlinks=False)
        is_dir = stat_module.S_ISDIR(metadata.st_mode)
        link = None
        if stat_module.S_ISLNK(metadata.st_mode):
            link = "symlink"
        elif is_dir and metadata.st_dev != self._device:
            link = "mount_point"
        return _ChildMetadata(link, is_dir, stat_module.S_ISREG(metadata.st_mode), int(metadata.st_size), int(metadata.st_mtime_ns))

    def close(self, handle: int) -> None:
        os.close(handle)


def _traversal_backend() -> Any:
    """Select this host's handle-anchored traversal; there is no path-based fallback."""
    if os.name == "nt":
        return _WindowsTraversal()
    if sys.platform.startswith("linux"):
        return _LinuxTraversal()
    raise UnsupportedSafeTraversal("platform_not_supported")


def plan_mount(root: Path, *, clock=time.monotonic) -> dict[str, object]:
    """Build a metadata-only triage plan; never opens, hashes or decodes candidate files.

    Traversal is anchored to held directory handles: the root is reached by a no-follow
    walk of single names from the volume or file-system root, every queued directory is
    opened by its one name beneath its already-held parent, and every listing reads the
    held handle, so renaming or replacing a path during the scan can't redirect it.
    Links, junctions, other reparse points and mount points are reported, never
    followed. Where this can't be established the plan fails closed with
    unsupported_safe_traversal before anything is listed.
    """
    policy = json.loads(canonical(PLAN_POLICY))
    budgets = policy["scanBudgets"]
    max_source_bytes = int(policy["serviceCeiling"]["maxSourceBytes"])
    requested_root = Path(os.path.abspath(os.fspath(root)))
    root_path = str(requested_root)
    root_fingerprint = sha256(root_path.casefold() if os.name == "nt" else root_path)
    policy_fingerprint = sha256(canonical(policy))
    started = clock()
    entries: list[dict[str, object]] = []
    truncated: set[str] = set()
    visited = 0
    candidate_bytes = 0
    counts: dict[str, int] = {}
    complete = True
    fail_closed: str | None = None
    unsupported: str | None = None
    backend: Any = None
    root_handle: int | None = None

    def add(relative: str, status: str, reason: str, **metadata: object) -> None:
        if len(entries) >= int(budgets["manifestEntries"]):
            truncated.add("manifest_entries")
            return
        entries.append({"path": relative, "status": status, "reason": reason, **metadata})
        counts[status] = counts.get(status, 0) + 1

    def out_of_time() -> bool:
        if clock() - started >= float(budgets["elapsedSeconds"]):
            truncated.add("elapsed_time")
            return True
        return False

    def is_excluded(relative: str, is_dir: bool) -> str | None:
        parts = relative.split("/")
        name = parts[-1].casefold()
        directory_names = {item.casefold() for item in policy["excludeDirectoryNames"]}
        if is_dir and name in directory_names:
            return "excluded_generated_or_cache_directory"
        if not is_dir and any(part.casefold() in directory_names for part in parts[:-1]):
            return "excluded_generated_or_cache_directory"
        if not is_dir:
            if name in {item.casefold() for item in policy["excludeFileNames"]}:
                return "excluded_credential_or_system_file"
            if any(fnmatch.fnmatchcase(name, pattern.casefold()) for pattern in policy["excludeNamePatterns"]):
                return "excluded_credential_filename_pattern"
            if Path(name).suffix in {item.casefold() for item in policy["excludeSuffixes"]}:
                return "excluded_temporary_or_generated_suffix"
        return None

    try:
        backend = _traversal_backend()
        root_handle = backend.open_root(root_path)
    except UnsupportedSafeTraversal as exc:
        # Fail closed before any listing; never fall back to a path-based scan.
        unsupported = exc.code
        fail_closed = "unsupported_safe_traversal"
        add("", "needs_review", "unsupported_safe_traversal")
    except _RootRefused as refused:
        add("", refused.status, refused.reason)
    except (OSError, ValueError):
        add("", "inaccessible", "root_unavailable")
    if root_handle is None:
        complete = False

    held: list[_HeldDirectory] = []
    # Each item is (held parent, name, relative path); the root item is its own held handle with no name.
    pending: list[tuple[_HeldDirectory, str | None, str]] = []
    if root_handle is not None:
        root_directory = _HeldDirectory(backend, root_handle)
        held.append(root_directory)
        pending.append((root_directory, None, ""))
    try:
        while pending:
            parent, directory_name, prefix = pending.pop()
            if out_of_time():
                pending.append((parent, directory_name, prefix))
                break
            if directory_name is None:
                directory = parent
            else:
                try:
                    # Opened by its one name beneath the held parent it was listed from, never by path.
                    handle, refusal = backend.open_beneath(parent.handle, directory_name, listing=True)
                except OSError:
                    add(prefix, "inaccessible", "directory_unreadable")
                    complete = False
                    continue
                finally:
                    parent.release()
                if handle is None:
                    # Listed as a plain directory but now a link, reparse point, mount or gone: not followed.
                    fail_closed = "directory_changed_before_traversal"
                    add(prefix, "needs_review", "directory_changed_not_followed")
                    break
                directory = _HeldDirectory(backend, handle)
                held.append(directory)
            listed: list[tuple[str, _ChildMetadata | None]] = []
            try:
                with backend.children(directory.handle) as iterator:
                    for child in iterator:
                        if out_of_time():
                            break
                        # Enforce the count before the next child is retained or stat'd: the plan
                        # learns that more work exists but neither counts nor reports this child.
                        if visited >= int(budgets["fileCount"]):
                            truncated.add("file_count")
                            break
                        visited += 1
                        try:
                            metadata = child.metadata()
                        except OSError:
                            metadata = None
                        listed.append((child.name, metadata))
            except OSError:
                directory.close()
                add(prefix, "inaccessible", "directory_unreadable")
                complete = False
                continue

            child_dirs: list[tuple[str, str]] = []
            # A directory whose name differs from a sibling's only by case is opened only where
            # this directory's lookup is known to be exact; its policy is read at most once.
            colliding = _case_collisions([name for name, _ in listed])
            exact: bool | None = None
            # The case-sensitive tie-break keeps A.pdf/a.pdf stable under any enumeration order.
            for name, metadata in sorted(listed, key=lambda item: (item[0].casefold(), item[0])):
                relative = f"{prefix}/{name}".lstrip("/")
                if metadata is None:
                    add(relative, "inaccessible", "metadata_unreadable")
                    complete = False
                    continue
                if metadata.link:
                    add(relative, "needs_review", f"{metadata.link}_not_followed")
                    continue
                is_dir = metadata.is_dir
                excluded = is_excluded(relative, is_dir)
                if excluded:
                    add(relative, "excluded_by_policy", excluded, itemType="directory" if is_dir else "file")
                    continue
                if is_dir:
                    if name in colliding:
                        if exact is None:
                            exact = backend.exact_lookup(directory.handle)
                        if not exact:
                            # Opening this name could reach its case-only sibling: never queued or opened.
                            add(relative, "needs_review", "case_ambiguous_directory_not_traversed")
                            fail_closed = fail_closed or "case_ambiguous_lookup"
                            continue
                    child_dirs.append((name, relative))
                    continue
                if not metadata.is_regular:
                    add(relative, "unsupported", "not_a_regular_file")
                    continue
                size = int(metadata.size)
                suffix = Path(name).suffix.casefold()
                if suffix not in MIME_BY_SUFFIX:
                    add(relative, "unsupported", "unsupported_file_type", sizeBytes=size)
                    continue
                # Page count needs decoding, which this plan never does, so it stays unknown.
                document = {"sizeBytes": size, "mimeType": MIME_BY_SUFFIX[suffix], "pageCount": None}
                if size > max_source_bytes:
                    add(relative, "oversized", "exceeds_service_byte_ceiling_needs_review", **document)
                    continue
                if candidate_bytes + size > int(budgets["candidateBytes"]):
                    add(relative, "needs_review", "candidate_byte_budget_exceeded", **document)
                    truncated.add("candidate_bytes")
                    break
                candidate_bytes += size
                add(
                    relative,
                    "eligible",
                    "within_service_byte_ceiling_only_page_count_unknown",
                    modifiedNs=int(metadata.mtime_ns),
                    **document,
                )
            # Keep this handle until every queued child has been opened beneath it.
            directory.wait_for(len(child_dirs))
            # A stack reversal preserves the same deterministic lexical traversal.
            pending.extend((directory, name, relative) for name, relative in reversed(child_dirs))
            if truncated:
                break
    finally:
        for directory in held:
            directory.close()

    if fail_closed is not None:
        complete = False
    for _, _, relative in pending:
        add(relative, "needs_review", "directory_not_traversed_scan_incomplete")

    entries.sort(key=lambda item: (str(item["path"]).casefold(), str(item["path"])))

    def summary() -> dict[str, object]:
        value: dict[str, object] = {
            "schema": PLAN_SCHEMA,
            "policyVersion": policy["version"],
            "policy": policy,
            "policyFingerprint": policy_fingerprint,
            "rootFingerprint": root_fingerprint,
            "scanComplete": complete and not truncated and fail_closed is None,
            "partialScanFinalized": False,
            "absenceSemantics": "none",
            "failClosedReason": fail_closed,
            "traversal": {
                "mode": backend.mode if backend is not None else None,
                "handleAnchored": backend is not None and unsupported is None,
                "unsupportedReason": unsupported,
            },
            "contentInspected": False,
            "pageCountInspected": False,
            "serviceAdmissionDetermined": False,
            "unchangedContentClaimed": False,
            "candidateBytes": candidate_bytes,
            "visitedEntries": visited,
            "counts": counts,
            "truncatedBy": sorted(truncated),
            "statusVocabulary": [
                "eligible", "excluded_by_policy", "unsupported", "oversized",
                "inaccessible", "unchanged_metadata_candidate", "needs_review",
            ],
            "eligibilityNote": (
                "eligible means only a supported type whose metadata size is at or under "
                "policy.serviceCeiling.maxSourceBytes; pageCount is null because pages are never "
                "decoded here, and the Foundation alone decides service admission."
            ),
            "unchangedMetadataNote": "No prior metadata baseline is read; unchanged_metadata_candidate is never inferred by this plan.",
            "entries": entries,
        }
        value["manifestSha256"] = "sha256:" + sha256(canonical(entries))
        return value

    def encoded_size(value: object) -> int:
        return len(canonical(value).encode("utf-8"))

    limit = int(budgets["outputBytes"])
    result = summary()
    # Enforce the wire-size ceiling (plus emit's newline) after accounting for the policy and summary too.
    if encoded_size(result) + 1 > limit:
        sizes = [encoded_size(item) + 1 for item in entries]
        while entries and encoded_size(result) + 1 > limit:
            truncated.add("output_bytes")
            complete = False
            excess = encoded_size(result) + 1 - limit
            while entries and excess > 0:
                removed = entries.pop()
                excess -= sizes.pop()
                status = str(removed["status"])
                counts[status] -= 1
                if counts[status] == 0:
                    del counts[status]
            result = summary()
    if encoded_size(result) + 1 > limit:
        # Static policy/summary itself must stay below the output bound.
        raise AgentError("intake plan policy exceeds its output budget")
    return result


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
        if body is None and isinstance(pending.get("intake"), dict) and isinstance(files, dict):
            # An upload set that is not committed yet resumes under its saved attempt; nothing is rescanned.
            check_intake(pending["intake"], files)
            if state["serverCursorSha256"] != pending["intake"]["previousCursorSha256"]:
                raise AgentError("pending journal cursor is not the current state")
            return approve_and_upload(args, client, pending_path, pending, resumed=True)
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
    uploads = sorted(key for key in changed_ids if key in current and isinstance(current[key].get("mimeType"), str))
    if uploads:
        # Every gate that needs no network runs before anything is quoted, held or read for upload.
        require_upload_approval(args, [(str(current[key]["mimeType"]), int(current[key]["sizeBytes"])) for key in uploads])
        if cloud is not None:
            # An approval names content, so each changed object is hashed from one pinned read first.
            for native_id in uploads:
                item = current[native_id]
                temp_path = download_s3(cloud, args, native_id, int(item["sizeBytes"]), str(item["revision"]))
                try:
                    _, item["contentSha256"] = file_digest(temp_path, args.max_file_bytes)
                finally:
                    temp_path.unlink(missing_ok=True)
    events: list[dict[str, object]] = []
    for native_id in sorted(changed_ids):
        old = previous.get(native_id)
        item = current.get(native_id)
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
        events.append(
            {
                "kind": "changed" if old is not None else "added",
                "nativeId": native_id,
                "revision": item["revision"],
                "contentSha256": item.get("contentSha256"),
                "sizeBytes": item["sizeBytes"],
                "mimeType": item.get("mimeType"),
                "documentId": None,
                "sourceIdempotencyKey": None,
            }
        )
    if not events and next_cursor == state["serverCursorSha256"]:
        if existing_scope is None:
            write_state(args.state, args.connection_id, current, next_cursor, fingerprint)
        return {"status": "unchanged", "eventCount": 0}
    batch_id = str(uuid.uuid4())
    if not uploads:
        check_batch_size(args, events)
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
    attempt_key = "att_" + uuid.uuid4().hex
    entries = {native_id: intake_manifest_entry(native_id, current[native_id]) for native_id in uploads}
    for event in events:
        entry = entries.get(str(event["nativeId"]))
        if entry is not None:
            event["sourceIdempotencyKey"] = approved_source_idempotency_key(attempt_key, entry["fileKey"])
    # Sized with every document identity in place, so the final batch cannot outgrow the API bound.
    check_batch_size(args, [dict(event, documentId=str(uuid.UUID(int=0))) if event["nativeId"] in entries else event for event in events])
    manifest = sorted(entries.values(), key=lambda entry: entry["fileKey"])
    pending = {
        "scopeFingerprint": fingerprint,
        "connectionId": args.connection_id,
        "files": current,
        "intake": {
            "batchId": batch_id,
            "previousCursorSha256": state["serverCursorSha256"],
            "nextCursorSha256": next_cursor,
            "events": events,
            "attemptKey": attempt_key,
            "approveUpToCredits": args.approve_up_to_credits,
            "allowUnknownPageCount": bool(getattr(args, "allow_unknown_page_count", False)),
            "clientManifestDigest": intake_manifest_digest(manifest),
            "manifest": manifest,
            "members": {
                entry["fileKey"]: {"nativeId": native_id, "documentId": None, "phase": "planned"}
                for native_id, entry in entries.items()
            },
            "quote": None,
            "approvalPosted": False,
            "approvalBody": None,
            "approval": None,
        },
    }
    # Durable before the first request, so every retry repeats this attempt, these keys and this manifest.
    write_journal(pending_path, pending)
    return approve_and_upload(args, client, pending_path, pending, resumed=False, cloud=cloud)


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


def check_batch_size(args: argparse.Namespace, events: list[dict[str, object]]) -> None:
    if len(events) > args.max_events or len(canonical(events).encode("utf-8")) > 1_000_000:
        raise AgentError("source batch exceeds bounded API limit; split the registered scope")


def approval_cap(args: argparse.Namespace, waiting: int = 0) -> int:
    cap = getattr(args, "approve_up_to_credits", None)
    if type(cap) is not int or not 1 <= cap <= MAX_APPROVE_CREDITS:
        subject = f"{waiting} changed supported source file(s) need" if waiting else "uploads need"
        raise ReviewRequiredError(
            f"{subject} an explicit credit approval: rerun with --approve-up-to-credits N, where N is a whole "
            f"number from 1 to {MAX_APPROVE_CREDITS} and the most credits you approve for one cycle's whole "
            "changed set. The set is quoted first and nothing above N is approved; nothing was quoted, "
            "approved or uploaded"
        )
    return cap


def require_upload_approval(args: argparse.Namespace, members: list[tuple[str, int]]) -> int:
    """Local gates for one cycle's whole upload set; none of them needs the network."""
    if len(members) > MAX_APPROVAL_FILES:
        raise ReviewRequiredError(
            f"{len(members)} changed supported source files exceed the {MAX_APPROVAL_FILES}-file approval limit. "
            "One approval covers a whole cycle and is never split: narrow the registered scope (a smaller "
            "--root or --s3-prefix) and rerun. Nothing was quoted, approved or uploaded"
        )
    cap = approval_cap(args, len(members))
    empty = sum(1 for _, size in members if size < 1)
    if empty:
        raise ReviewRequiredError(
            f"{empty} changed supported source file(s) are empty and cannot be approved; remove or replace "
            "them and rerun. Nothing was quoted, approved or uploaded"
        )
    unknown = sum(1 for mime_type, _ in members if not mime_type.startswith("image/"))
    if unknown and not getattr(args, "allow_unknown_page_count", False):
        raise ReviewRequiredError(
            f"{unknown} changed non-image source file(s) have no trusted page count, so each would be quoted "
            f"and approved at the {FOUNDATION_MAX_SOURCE_PAGES}-page server ceiling; rerun with "
            "--allow-unknown-page-count to accept that ceiling. Nothing was quoted, approved or uploaded"
        )
    return cap


def check_intake(intake: dict[str, Any], files: dict[str, Any]) -> None:
    """A resumed attempt must still be exactly the manifest, keys and identities it was saved with."""
    try:
        manifest = intake["manifest"]
        members = intake["members"]
        quote = intake["quote"]
        approval = intake["approval"]
        valid = (
            isinstance(manifest, list) and 1 <= len(manifest) <= MAX_APPROVAL_FILES
            and isinstance(members, dict) and isinstance(intake["events"], list)
            and isinstance(intake["batchId"], str) and isinstance(intake["attemptKey"], str)
            and ATTEMPT_KEY_PATTERN.match(intake["attemptKey"]) is not None
            and isinstance(intake["approvalPosted"], bool)
            and [entry["fileKey"] for entry in manifest] == sorted(members)
            and all(
                isinstance(files.get(members[entry["fileKey"]]["nativeId"]), dict)
                and entry["fileKey"] == intake_file_key(
                    members[entry["fileKey"]]["nativeId"], entry["contentSha256"].removeprefix("sha256:"),
                    entry["byteLength"], entry["mimeType"],
                )
                for entry in manifest
            )
            and (quote is None or (isinstance(quote["pricingFingerprint"], str) and _count(quote["quote"]["maximumCredits"])))
            and (approval is None or all(isinstance(approval[name], str) for name in ("approvalId", "scopeDigest", "pricingFingerprint")))
            and "previousCursorSha256" in intake and "nextCursorSha256" in intake and "approvalBody" in intake
        )
        digest_matches = valid and intake_manifest_digest(manifest) == intake["clientManifestDigest"]
    except (KeyError, TypeError, AttributeError):
        valid = digest_matches = False
    if not valid:
        raise AgentError("pending journal contract is invalid")
    if not digest_matches:
        raise AgentError("pending journal manifest is invalid")


def verify_quote(intake: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
    keys = {entry["fileKey"] for entry in intake["manifest"]}
    quote = value.get("quote")
    files = value.get("files")
    valid = (
        value.get("code") == "INTAKE_QUOTE"
        and value.get("clientManifestDigest") == intake["clientManifestDigest"]
        and isinstance(value.get("pricingFingerprint"), str)
        and SHA256_DIGEST_PATTERN.match(value["pricingFingerprint"]) is not None
        and isinstance(quote, dict)
        and all(_count(quote.get(name)) for name in ("maximumPages", "reservedCredits", "maximumCredits"))
        and isinstance(files, list) and len(files) == len(keys)
        and all(isinstance(item, dict) for item in files)
        and {item.get("fileKey") for item in files} == keys
        and all(
            _count(item.get("approvedMaxPages")) and _count(item.get("reservedCredits")) and _count(item.get("maximumCredits"))
            and (item.get("pageBasis") != "unknown" or item.get("approvedMaxPages") == FOUNDATION_MAX_SOURCE_PAGES)
            for item in files
        )
    )
    if not valid or sum(item["maximumCredits"] for item in files) != quote["maximumCredits"]:
        raise AgentError("Foundation quote does not describe the saved manifest")
    return value


def verify_approval(intake: dict[str, Any], approval: dict[str, Any], cap: int) -> dict[str, dict[str, Any]]:
    """The approval must be this attempt, this manifest and this quote, member for member."""
    quote = intake["quote"]
    files = approval.get("files")
    if (
        quote is None
        or approval.get("attemptKey") != intake["attemptKey"]
        or approval.get("clientManifestDigest") != intake["clientManifestDigest"]
        or approval.get("pricingFingerprint") != quote["pricingFingerprint"]
        or not isinstance(approval.get("approvalId"), str) or UUID_PATTERN.match(approval["approvalId"]) is None
        or not isinstance(approval.get("scopeDigest"), str) or SHA256_DIGEST_PATTERN.match(approval["scopeDigest"]) is None
        or not isinstance(files, list)
    ):
        raise AgentError("approval does not match the saved attempt, manifest and quote")
    held: dict[str, dict[str, Any]] = {}
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("fileKey"), str) or item["fileKey"] in held:
            raise AgentError("approval members are malformed")
        held[item["fileKey"]] = item
    if set(held) != set(intake["members"]):
        raise AgentError("approval does not cover exactly the saved manifest")
    for entry in intake["manifest"]:
        item = held[entry["fileKey"]]
        if (
            not isinstance(item.get("documentId"), str) or UUID_PATTERN.match(item["documentId"]) is None
            or item.get("fileState") not in APPROVAL_FILE_STATES
            or (item.get("contentSha256"), item.get("byteLength"), item.get("mimeType"))
            != (entry["contentSha256"], entry["byteLength"], entry["mimeType"])
            or not _count(item.get("approvedMaximumCredits"))
        ):
            raise AgentError("an approved member does not match its saved manifest entry")
    if approval.get("state") != "approved" or (
        approval.get("expired") is not False and any(item["fileState"] != "confirmed" for item in held.values())
    ):
        raise ReviewRequiredError(f"this attempt's approval is cancelled or expired, so the set cannot complete; {DISCARD_HINT}")
    total = sum(item["approvedMaximumCredits"] for item in held.values())
    if total != approval.get("aggregateMaximumCredits") or total != quote["quote"]["maximumCredits"]:
        raise AgentError("approved credits do not match the saved quote")
    if total > cap:
        raise ReviewRequiredError(
            f"this set is already approved at up to {total} credits, above --approve-up-to-credits {cap}; rerun "
            f"with --approve-up-to-credits {total} or more to finish it, or {DISCARD_HINT}"
        )
    saved = intake["approval"]
    if saved is not None and (
        saved["approvalId"] != approval["approvalId"]
        or saved["scopeDigest"] != approval["scopeDigest"]
        or any(intake["members"][key]["documentId"] != item["documentId"] for key, item in held.items())
    ):
        raise AgentError("approval identities changed after they were saved")
    return held


def sealed_source(
    args: argparse.Namespace,
    root: Path | None,
    cloud: Any,
    native_id: str,
    item: dict[str, Any],
    entry: dict[str, Any],
) -> tuple[Path, Callable[[], None]]:
    """Exactly the bytes that were quoted, sealed so nothing can change them during the upload."""
    expected = {"sizeBytes": entry["byteLength"], "contentSha256": entry["contentSha256"].removeprefix("sha256:")}
    if root is not None:
        path, directory = snapshot_mount(root / Path(native_id), expected, args.max_file_bytes)
        return path, directory.cleanup
    path = download_s3(cloud, args, native_id, int(entry["byteLength"]), str(item["revision"]))
    try:
        if file_digest(path, args.max_file_bytes) != (expected["sizeBytes"], expected["contentSha256"]):
            raise AgentError("source changed after it was quoted")
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path, lambda: path.unlink(missing_ok=True)


def approve_and_upload(
    args: argparse.Namespace,
    client: FoundationClient,
    pending_path: Path,
    pending: dict[str, Any],
    *,
    resumed: bool,
    cloud: Any = None,
) -> dict[str, object]:
    """Quote, approve, upload and commit one cycle's whole changed set under one stable attempt.

    The journal is written before every request that can commit, so a retry repeats the same
    attempt, file keys and manifest, and reads committed state back rather than guessing.
    """
    intake = pending["intake"]
    manifest = intake["manifest"]
    members = intake["members"]
    cap = require_upload_approval(args, [(entry["mimeType"], entry["byteLength"]) for entry in manifest])
    allow_unknown = bool(getattr(args, "allow_unknown_page_count", False))
    if intake["approval"] is None and (intake["approveUpToCredits"], intake["allowUnknownPageCount"]) != (cap, allow_unknown):
        intake["approveUpToCredits"] = cap
        intake["allowUnknownPageCount"] = allow_unknown
        write_journal(pending_path, pending)
    approval = None
    if resumed and (intake["approvalPosted"] or intake["approval"] is not None):
        # A reload never guesses: it reads this same attempt's committed state first.
        approval = client.read_approval(intake["attemptKey"])
        if approval is None and intake["approval"] is not None:
            raise AgentError("the saved approval can no longer be read; refusing to approve the set again")
    if approval is None:
        if intake["quote"] is None:
            intake["quote"] = verify_quote(
                intake, client.quote({"clientManifestDigest": intake["clientManifestDigest"], "files": manifest}),
            )
            write_journal(pending_path, pending)
        # A saved quote is never replaced: a changed price is the caller's decision, not this agent's.
        quoted = intake["quote"]["quote"]
        if quoted["maximumCredits"] > cap:
            usd = quoted.get("maximumUsd")
            price = f" (up to {usd} USD)" if type(usd) in (int, float) else ""
            raise ReviewRequiredError(
                f"the quoted maximum for this {len(manifest)}-file set is {quoted['maximumCredits']} credits{price}, "
                f"above --approve-up-to-credits {cap}; nothing was approved, reserved or uploaded. Review the "
                f"quote, then rerun with --approve-up-to-credits {quoted['maximumCredits']} or more to approve "
                f"this same saved set, or {DISCARD_HINT}"
            )
        if not intake["approvalPosted"]:
            intake["approvalBody"] = {
                "attemptKey": intake["attemptKey"],
                "clientManifestDigest": intake["clientManifestDigest"],
                "pricingFingerprint": intake["quote"]["pricingFingerprint"],
                "aggregateMaximumCredits": quoted["maximumCredits"],
                "files": manifest,
            }
            intake["approvalPosted"] = True
            write_journal(pending_path, pending)
        approval = client.create_approval(intake["approvalBody"])
    held = verify_approval(intake, approval, cap)
    if intake["approval"] is None:
        intake["approval"] = {
            "approvalId": approval["approvalId"],
            "scopeDigest": approval["scopeDigest"],
            "pricingFingerprint": approval["pricingFingerprint"],
            "aggregateMaximumCredits": approval["aggregateMaximumCredits"],
        }
        for file_key, member in members.items():
            member["documentId"] = held[file_key]["documentId"]
            member["phase"] = "approved"
        # Every identity is durable before any capability is requested.
        write_journal(pending_path, pending)
    attempt = {
        "attemptKey": intake["attemptKey"],
        "scopeDigest": intake["approval"]["scopeDigest"],
        "pricingFingerprint": intake["approval"]["pricingFingerprint"],
    }
    root = args.root.resolve(strict=True) if args.root else None
    for entry in manifest:
        file_key = entry["fileKey"]
        member = members[file_key]
        file_state = held[file_key]["fileState"]
        if file_state == "confirmed":
            # Confirmed under this attempt already: reuse its document and never upload it again.
            if member["phase"] != "confirmed":
                member["phase"] = "confirmed"
                write_journal(pending_path, pending)
            continue
        if file_state == "cancelled":
            raise ReviewRequiredError(
                f"an approved file in this set was cancelled and its hold released, so the set cannot complete; {DISCARD_HINT}"
            )
        if root is None and cloud is None:
            cloud = s3_client(args)
        source, cleanup = sealed_source(args, root, cloud, member["nativeId"], pending["files"][member["nativeId"]], entry)

        def record(phase: str, member: dict[str, Any] = member) -> None:
            member["phase"] = phase
            write_journal(pending_path, pending)

        try:
            document_id = client.upload(
                source,
                {**entry, "documentId": member["documentId"], "approvedMaximumCredits": held[file_key]["approvedMaximumCredits"]},
                attempt,
                record,
            )
        finally:
            cleanup()
        if document_id != member["documentId"]:
            raise AgentError("Foundation confirmed a different document than the approved member")
        record("confirmed")
    documents = {member["nativeId"]: member["documentId"] for member in members.values()}
    events = [
        dict(event, documentId=documents[event["nativeId"]]) if event["nativeId"] in documents else event
        for event in intake["events"]
    ]
    check_batch_size(args, events)
    # The cursor advances only when the Foundation accepts this complete, original batch.
    pending["body"] = {
        "batchId": intake["batchId"],
        "previousCursorSha256": intake["previousCursorSha256"],
        "nextCursorSha256": intake["nextCursorSha256"],
        "manifestSha256": "sha256:" + sha256(canonical(events)),
        "events": events,
    }
    write_journal(pending_path, pending)
    return commit_pending(args, client, pending_path, pending)


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


class SourceAgentArgumentParser(argparse.ArgumentParser):
    """Keep sync's required local bindings while allowing an unbound plan."""

    def parse_args(self, args=None, namespace=None):
        parsed = super().parse_args(args, namespace)
        if not parsed.dry_run_plan and (parsed.connection_id is None or parsed.state is None):
            self.error("normal sync requires --connection-id and --state")
        return parsed


def run(args: argparse.Namespace, *, sleep=time.sleep, emit=print) -> int:
    if args.dry_run_plan:
        if args.root is None:
            raise AgentError("--dry-run-plan supports only an explicitly mounted --root")
        plan = plan_mount(args.root)
        emit(canonical(plan))
        return 0 if plan["scanComplete"] else 2
    if args.connection_id is None or args.state is None:
        raise AgentError("normal sync requires --connection-id and --state")
    if args.poll_seconds < 1 or args.retry_limit < 0 or args.retry_limit > 10 or args.max_cycles < 0 or args.max_events < 1 or args.max_events > 5000 or args.max_file_bytes < 1 or args.max_upload_bytes < 1 or args.timeout_seconds <= 0:
        raise AgentError("invalid bounded agent settings")
    if getattr(args, "approve_up_to_credits", None) is not None:
        approval_cap(args)
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
    value = SourceAgentArgumentParser(description="Sync mounted or S3-compatible storage to TAVONEL")
    source = value.add_mutually_exclusive_group(required=True)
    source.add_argument("--root", type=Path, help="Mounted read-only SMB/NFS/SFTP directory")
    source.add_argument("--s3-bucket", help="AWS S3, Cloudflare R2, or MinIO bucket")
    value.add_argument(
        "--connection-id", help="UUID shown in Workspace > Connections (required for sync)"
    )
    value.add_argument("--state", type=Path, help="Local cursor state file (required for sync)")
    value.add_argument(
        "--dry-run-plan", action="store_true",
        help="Print a bounded metadata-only mounted-root intake plan; no credentials or API calls",
    )
    value.add_argument("--base-url", default=os.environ.get("TAVONEL_BASE_URL", DEFAULT_BASE_URL))
    value.add_argument("--max-file-bytes", type=int, default=512 * 1024 * 1024)
    value.add_argument("--timeout-seconds", type=float, default=60.0)
    value.add_argument("--watch", action="store_true", help="Repeat bounded sync cycles until stopped")
    value.add_argument("--poll-seconds", type=float, default=30.0)
    value.add_argument("--max-cycles", type=int, default=0, help="Stop after N cycles; 0 is unlimited watch")
    value.add_argument("--retry-limit", type=int, default=3, help="Bounded retries for transient HTTP/network errors")
    value.add_argument("--max-events", type=int, default=5000)
    value.add_argument("--max-upload-bytes", type=int, default=512 * 1024 * 1024, help="Maximum supported-file bytes uploaded per cycle")
    value.add_argument(
        "--approve-up-to-credits", type=int,
        help=f"Most credits approved for one cycle's whole changed upload set (1-{MAX_APPROVE_CREDITS}); "
        "required whenever a cycle has files to upload, which are quoted before anything is approved",
    )
    value.add_argument(
        "--allow-unknown-page-count", action="store_true",
        help=f"Approve non-image files, whose page count is not known, at the {FOUNDATION_MAX_SOURCE_PAGES}-page server ceiling",
    )
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
    except ReviewRequiredError as exc:
        # Counts, credits and flags only: never a path, URL, credential or raw response body.
        print(canonical({"status": "failed", "code": "SOURCE_REVIEW_REQUIRED", "checkpointPreserved": True, "instructions": str(exc)}))
        return 1
    except (AgentError, ValueError, OSError):
        # No raw HTTP body, source path, URL, credentials or traceback in unattended logs.
        print(canonical({"status": "failed", "code": "SOURCE_SYNC_FAILED", "checkpointPreserved": True}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
