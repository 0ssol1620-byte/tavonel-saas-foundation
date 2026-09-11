"""K08 step 2: run the LIVE engine (Core V2) over the Explore corpus and count what it produces.

Audit K08: the public "6,300 objects" figure was measured against the TypeScript fallback engine's
candidate emission, not against Core V2 -- the engine the product is actually configured to dispatch
to. This script re-runs the measurement on the same bytes through Core V2 and writes a node-kind
breakdown, a duplicate-label rate and relation counts beside the TS engine's own numbers.

It imports `akc_product_core.ProductCoreCompiler` from an UNMODIFIED checkout
(D:\\CodexProjects\\ai-knowledge-compiler-p0p2-productization) and calls it in process. Nothing is
deployed, nothing is written to any database, and no request leaves the machine.

    <that checkout>\\.venv\\Scripts\\python.exe eval/k08-live-engine/run_core_v2.py

Run `emit-inputs.test.ts` first; it writes `results/core-v2-request.json`.

WHAT THIS IS NOT. `core_release_digest` is required by the compiler's constructor and, in the live
deployment, comes from that deployment's environment. This script computes a digest over the source
files of the local checkout instead and labels it `local_source_digest`. It is NOT the deployed Core
V2 release digest, so the output of this script is a same-engine measurement, not a same-release
one. Reading the deployed digest means calling the live service's /health, which this lane may not
do; the lane report carries that as an open item.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CORE_CHECKOUT = Path(r"D:\CodexProjects\ai-knowledge-compiler-p0p2-productization")


def fail(message: str) -> None:
    """Fail closed and loudly. A partial K08 measurement is worse than none."""
    print(f"K08 ABORTED: {message}", file=sys.stderr)
    raise SystemExit(2)


def local_source_digest() -> tuple[str, int]:
    """sha256 over every .py file of the two packages, sorted by path. Reproducible, and honest
    about being a property of this checkout rather than of a release."""
    roots = [
        CORE_CHECKOUT / "packages" / "product-core" / "src",
        CORE_CHECKOUT / "packages" / "cir-python" / "src",
    ]
    digest = hashlib.sha256()
    counted = 0
    for root in roots:
        if not root.is_dir():
            fail(f"expected package source at {root}")
        for path in sorted(root.rglob("*.py")):
            digest.update(str(path.relative_to(root)).replace("\\", "/").encode("utf-8"))
            digest.update(path.read_bytes())
            counted += 1
    return f"sha256:{digest.hexdigest()}", counted


LABEL_KEYS = ("label", "name", "text", "title", "value", "canonicalName", "statement")


def label_of(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in LABEL_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return re.sub(r"\s+", " ", value).strip().lower()
    return None


def duplicate_label_rate(objects: list[dict]) -> dict:
    """Same definition the TypeScript side uses: the share of labelled nodes whose (kind, normalised
    label) pair is not unique. Whitespace and case only -- anything cleverer would be a judgement
    about sameness, which belongs to the identity module, not to a metric."""
    groups: Counter[str] = Counter()
    labelled = 0
    for item in objects:
        label = label_of(item.get("payload"))
        if label is None:
            continue
        labelled += 1
        groups[f"{item.get('kind')}\0{label}"] += 1
    duplicated = sum(count for count in groups.values() if count > 1)
    return {
        "labelledNodes": labelled,
        "distinctLabels": len(groups),
        "nodesSharingALabel": duplicated,
        "rate": None if labelled == 0 else duplicated / labelled,
        "population": "nodes carrying a non-empty label",
    }


def main() -> None:
    request_path = RESULTS / "core-v2-request.json"
    if not request_path.is_file():
        fail(f"{request_path} is missing; run emit-inputs.test.ts first")

    try:
        from akc_product_core.compiler import ProductCoreCompiler
        from akc_product_core.contracts import ProductCoreCompileRequest
    except ImportError as error:  # pragma: no cover - environment problem, not logic
        fail(f"akc_product_core is not importable ({error}); use the p0p2 checkout's .venv python")
        return

    digest, source_files = local_source_digest()
    raw = request_path.read_bytes()
    request = ProductCoreCompileRequest.model_validate(json.loads(raw))
    input_sha256 = f"sha256:{hashlib.sha256(raw).hexdigest()}"

    started = time.perf_counter()
    response = ProductCoreCompiler(core_release_digest=digest).compile(
        request, input_sha256=input_sha256
    )
    elapsed = time.perf_counter() - started

    candidate = response.candidate
    model = candidate.canonical_knowledge_model
    objects = list(model.get("objects", []))
    if not objects:
        fail("Core V2 returned a knowledge model with no objects; refusing to report a count")

    kinds = Counter(str(item.get("kind")) for item in objects)
    relations = [item for item in objects if str(item.get("kind")) == "relation"]
    relation_predicates = Counter(
        str((item.get("payload") or {}).get("predicate", "unstated")) for item in relations
    )
    validation_records = [item for item in objects if str(item.get("kind")) == "validation_record"]

    payload = {
        "schema": "tavonel.k08.core-v2-counts.v1",
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "status": "IMPLEMENTED_NOT_PROVEN",
        "engine": "tavonel-python-core-v2 (the engine the product dispatches to)",
        "engineCheckout": str(CORE_CHECKOUT),
        "coreReleaseDigestUsed": digest,
        "coreReleaseDigestKind": "local_source_digest — NOT the deployed release digest",
        "sourceFilesHashed": source_files,
        "requestSha256": input_sha256,
        "collectionId": request.collection_id,
        "documents": len(request.documents),
        "regions": sum(len(document.regions) for document in request.documents),
        "elapsedSeconds": elapsed,
        "status_returned": response.status,
        "lifecycle": candidate.lifecycle,
        "reviewReasons": list(candidate.review_reasons),
        "manifestDigest": candidate.manifest_digest,
        "worldStateId": candidate.world_state_id,
        "knowledgeObjectTotal": len(objects),
        "nodeKinds": dict(sorted(kinds.items())),
        "relationTotal": len(relations),
        "relationPredicates": dict(sorted(relation_predicates.items())),
        "validationRecordTotal": len(validation_records),
        "duplicateLabels": duplicate_label_rate(objects),
        "unitTotal": len(candidate.units),
        "artifactHashes": dict(sorted(candidate.artifact_hashes.items())),
        "packageFiles": [file.path for file in candidate.package.files],
        "validation": candidate.validation,
        "receipt": {
            "inputSha256": response.receipt.input_sha256,
            "outputSha256": response.receipt.output_sha256,
            "coreReleaseDigest": response.receipt.core_release_digest,
            "equivalence": response.receipt.equivalence,
            "totalArtifacts": response.receipt.total_artifacts,
            "rebuiltArtifacts": response.receipt.rebuilt_artifacts,
            "workAvoidedArtifacts": response.receipt.work_avoided_artifacts,
        },
    }

    out = RESULTS / "core-v2-counts.json"
    out.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    print(
        f"objects={len(objects)} kinds={dict(sorted(kinds.items()))} "
        f"relations={len(relations)} validation_records={len(validation_records)} "
        f"lifecycle={candidate.lifecycle} elapsed={elapsed:.1f}s"
    )


if __name__ == "__main__":
    main()
