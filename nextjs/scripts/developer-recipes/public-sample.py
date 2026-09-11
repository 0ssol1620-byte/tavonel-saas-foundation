#!/usr/bin/env python3
"""Read the public sample World, check the bytes, and follow one claim to its evidence.

Recipe 2 of /docs/integration-recipes. No API key, no account, no upload: the sample World is
published unauthenticated so that a developer can see the shape of a TAVONEL answer -- an object,
the evidence it rests on, the source version, the page and the region -- before deciding whether
to send us a document.

    python public-sample.py
    python public-sample.py --base-url https://tavonel.com

What it checks, in the order a consumer would:

  1. the response carries a `Content-Digest: sha-256=:...:` header and the body hashes to it,
     so the sample is byte-verifiable the same way a signed package is;
  2. every object's `evidenceRefs` resolves to an evidence record in the same document;
  3. every evidence record carries a source version, a 1-based page and a bbox inside the
     0-1000 page frame, which is the coordinate contract the whole product is built on;
  4. the sample says out loud that it is a sample. An object whose state is `research_frontier`
     has no evidence and must not be read as a finding.

Exit 0 when all four hold, 1 otherwise. Python 3.12 and the standard library.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import urllib.request

SAMPLE_PATH = "/reproducibility/sample-world"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:3207")
    options = parser.parse_args(argv)
    url = options.base_url.rstrip("/") + SAMPLE_PATH

    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        digest_header = response.headers.get("Content-Digest", "")

    failures: list[str] = []

    # 1. The bytes.
    expected = base64.b64encode(hashlib.sha256(raw).digest()).decode()
    if digest_header != f"sha-256=:{expected}:":
        failures.append(f"Content-Digest {digest_header!r} does not describe the {len(raw)} bytes received")

    world = json.loads(raw)
    evidence = {record["id"]: record for record in world.get("evidence", [])}

    # 2 and 4. Objects, their evidence, and the one that deliberately has none.
    for obj in world.get("objects", []):
        refs = obj.get("evidenceRefs", [])
        if obj.get("state") == "research_frontier":
            if refs:
                failures.append(f"{obj['id']} is marked research_frontier but cites evidence")
            continue
        if not refs:
            failures.append(f"{obj['id']} is not research_frontier and cites no evidence")
        for ref in refs:
            if ref not in evidence:
                failures.append(f"{obj['id']} cites {ref}, which is not in this sample")

    # 3. The coordinate contract.
    for record in evidence.values():
        if not record.get("sourceVersionId"):
            failures.append(f"{record['id']} has no source version")
        page = record.get("page")
        if not isinstance(page, int) or page < 1:
            failures.append(f"{record['id']} has no 1-based page number")
        box = record.get("bbox1000")
        if not (isinstance(box, list) and len(box) == 4):
            failures.append(f"{record['id']} has no four-number region")
            continue
        left, top, right, bottom = box
        if not (0 <= left < right <= 1000 and 0 <= top < bottom <= 1000):
            failures.append(f"{record['id']} region {box} is not inside the 0-1000 page frame")

    if world.get("disclosure") != "deterministic_product_sample_not_customer_proof":
        failures.append("the sample no longer declares itself a sample rather than customer proof")

    print(f"sample: {len(world.get('objects', []))} objects, {len(evidence)} evidence records, {len(raw)} bytes")
    print(f"digest: {digest_header}")
    for record in evidence.values():
        print(f"  {record['id']} -> {record['sourceVersionId']} page {record['page']} bbox {record['bbox1000']}")
    for failure in failures:
        sys.stderr.write(f"  FAILED  {failure}\n")
    print("PUBLIC SAMPLE OK" if not failures else f"PUBLIC SAMPLE FAILED: {len(failures)} check(s)")
    return 0 if not failures else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        sys.stderr.write(f"public sample check failed: {error}\n")
        sys.exit(1)
