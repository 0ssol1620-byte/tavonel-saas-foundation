#!/usr/bin/env python3
"""Recipe 2 — read the public sample World and follow every claim to its evidence.

No API key. No signup. Python 3.12 and the standard library, nothing else.

/docs/integration-recipes described this script and the file lived in a private repository, so
the page's own credibility claim -- "each one is executed by a smoke script, so a recipe that has
drifted from the product fails a check rather than a customer's afternoon" -- was something no
reader could check (G3-017). It is published here now, pinned by sha256 in
https://tavonel.com/developer/channel.json like every other file in the distribution.

What it proves, in order:

  1. The bytes you received are the bytes we served. `Content-Digest: sha-256=:...:` is computed
     over the exact response body; this recomputes it and refuses a mismatch.
  2. Every object that claims evidence resolves to an evidence record that exists. A dangling
     reference is the failure mode the whole compiler is built to make impossible, so a sample
     that has one is a sample worth failing on.
  3. Every region sits inside its page in the 0-1000 coordinate frame. The frame is
     resolution-independent on purpose -- a bbox is a fraction of a page, not a pixel offset.
  4. The object marked `research_frontier` cites no evidence at all. That is the honest half: an
     unproven claim is published as unproven and carries nothing it cannot support.

The sample is a product fixture and says so in its own `disclosure` field. It is unsigned, it is
not a promoted customer World, and it is not a quality measurement. Use it to build against the
shape, not to judge extraction.

    python tavonel-public-sample.py --base-url https://tavonel.com
    python tavonel-public-sample.py --json

Exits 0 when every check passes and 1 on the first that does not.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import urllib.error
import urllib.request

PATH = "/reproducibility/sample-world"
TIMEOUT_SECONDS = 30


class CheckFailed(Exception):
    """A check that did not pass. Never caught to keep going -- the run stops here."""


def fetch(base_url: str) -> tuple[bytes, str | None]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{PATH}",
        headers={"accept": "application/json", "user-agent": "tavonel-public-sample/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.read(), response.headers.get("Content-Digest")
    except urllib.error.HTTPError as error:  # noqa: PERF203 - one call, one handler
        raise CheckFailed(f"{PATH} answered {error.code}") from error
    except urllib.error.URLError as error:
        raise CheckFailed(f"{base_url} is not reachable: {error.reason}") from error


def check_digest(body: bytes, header: str | None) -> str:
    """Recompute the digest the response declared over its own bytes."""
    if not header:
        raise CheckFailed("the response carried no Content-Digest header")
    computed = f"sha-256=:{base64.b64encode(hashlib.sha256(body).digest()).decode()}:"
    if computed != header.strip():
        raise CheckFailed(f"digest mismatch\n  served:   {header.strip()}\n  computed: {computed}")
    return computed


def check_evidence(world: dict) -> list[str]:
    """Every cited evidence id resolves, and every region is inside its page."""
    evidence = {record["id"]: record for record in world["evidence"]}
    lines: list[str] = []
    for record in world["evidence"]:
        box = record["bbox1000"]
        if len(box) != 4:
            raise CheckFailed(f"{record['id']} has {len(box)} bbox values, not 4")
        left, top, right, bottom = box
        # 0-1000 is the whole page. A region outside it is not a region on that page.
        if not all(0 <= value <= 1000 for value in box):
            raise CheckFailed(f"{record['id']} bbox {box} leaves the 0-1000 page frame")
        if left >= right or top >= bottom:
            raise CheckFailed(f"{record['id']} bbox {box} has no area")
        if record["page"] < 1:
            raise CheckFailed(f"{record['id']} cites page {record['page']}")
        lines.append(f"  {record['id']} -> {record['sourceVersionId']} page {record['page']} bbox {box}")

    frontier_seen = False
    for obj in world["objects"]:
        refs = obj.get("evidenceRefs", [])
        if obj.get("state") == "research_frontier":
            frontier_seen = True
            if refs:
                raise CheckFailed(f"{obj['id']} is research_frontier and cites {refs}")
            continue
        if not refs:
            raise CheckFailed(f"{obj['id']} is {obj.get('state')} and cites no evidence")
        for ref in refs:
            if ref not in evidence:
                raise CheckFailed(f"{obj['id']} cites {ref}, which is not in this World")
    if not frontier_seen:
        raise CheckFailed("no object is marked research_frontier; the sample has changed shape")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Read the TAVONEL public sample World and check it.")
    parser.add_argument("--base-url", default="https://tavonel.com")
    parser.add_argument("--json", action="store_true", help="Print the receipt as JSON instead of prose.")
    args = parser.parse_args()

    try:
        body, header = fetch(args.base_url)
        digest = check_digest(body, header)
        world = json.loads(body)
        if world.get("schema") != "tavonel.public_sample_world.v1":
            raise CheckFailed(f"unexpected schema {world.get('schema')!r}")
        lines = check_evidence(world)
    except CheckFailed as failure:
        print(f"PUBLIC SAMPLE FAILED: {failure}", file=sys.stderr)
        return 1

    receipt = {
        "ok": True,
        "baseUrl": args.base_url,
        "objects": len(world["objects"]),
        "evidence": len(world["evidence"]),
        "bytes": len(body),
        "digest": digest,
        "disclosure": world.get("disclosure"),
    }
    if args.json:
        print(json.dumps(receipt, indent=2))
        return 0
    print(f"sample: {receipt['objects']} objects, {receipt['evidence']} evidence records, {receipt['bytes']} bytes")
    print(f"digest: {digest}")
    for line in lines:
        print(line)
    print(f"disclosure: {receipt['disclosure']}")
    print("PUBLIC SAMPLE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
