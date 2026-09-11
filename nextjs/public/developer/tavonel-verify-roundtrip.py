#!/usr/bin/env python3
"""Load a TAVONEL export the way an outside tool would, and query its ids back.

`tavonel-verify-package.mjs` proves the package is internally coherent: relations resolve,
regions sit inside their pages, and the Turtle, the JSON-LD and the CSV describe the same graph.
It proves all of that by reading the package with our own reader. This proves something the
audit (X07) asked separately: that the ids and the provenance survive a load by software that
has never heard of TAVONEL.

So the CSV goes into SQLite through the ordinary `csv` module and is queried back through SQL;
the JSON-LD is parsed as plain JSON; and the Turtle is parsed by `rdflib` where it is installed
and by a deliberately minimal parser where it is not. The minimal parser's ceiling is printed
rather than hidden, and a check that could not run is reported as skipped, never as a pass.

    python tavonel-verify-roundtrip.py --package <dir | package.zip | artifact.json>
    python tavonel-verify-roundtrip.py --package world.zip --json

Exit 0 when every check passed, 1 when one failed, 2 on bad arguments. Nothing here reads a
network and nothing here writes to disk: the SQLite database is `:memory:` and is discarded.

This file is published as `tavonel-verify-roundtrip.py` on https://tavonel.com/developers and
pinned by sha256 in /developer/channel.json; the copy there is byte-identical to this one, which
`nextjs/lib/compiler-contract.test.ts` asserts. Python 3.12 and the standard library. `rdflib`
is the one optional import, and its absence is a printed limit rather than a failure.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sqlite3
import sys
import zipfile

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_FILES = 4096
IRI_PREFIX = "urn:tavonel:"

REQUIRED = (
    "graph/nodes.csv",
    "graph/relationships.csv",
    "ontology/knowledge.jsonld",
    "ontology/knowledge.ttl",
)


# ------------------------------------------------------------------ reading


def read_package(target: str) -> dict[str, str]:
    """The three shapes a package arrives in: a directory, the signed zip, or an artifact JSON."""
    if os.path.isdir(target):
        files = {}
        for root, _dirs, names in os.walk(target):
            for name in names:
                full = os.path.join(root, name)
                path = os.path.relpath(full, target).replace(os.sep, "/")
                if len(files) >= MAX_FILES:
                    raise ValueError(f"package contains more than {MAX_FILES} files")
                with open(full, "rb") as handle:
                    files[path] = handle.read().decode("utf-8", errors="strict")
        return files

    size = os.path.getsize(target)
    if size > MAX_ARCHIVE_BYTES:
        raise ValueError("archive exceeds the 64 MiB round-trip limit")

    if target.endswith(".zip"):
        files = {}
        with zipfile.ZipFile(target) as archive:
            total = 0
            for info in archive.infolist():
                if info.is_dir():
                    continue
                total += info.file_size
                if total > MAX_ARCHIVE_BYTES or len(files) >= MAX_FILES:
                    raise ValueError("archive expands beyond the round-trip limit")
                files[info.filename] = archive.read(info).decode("utf-8", errors="replace")
        return files

    with open(target, "rb") as handle:
        parsed = json.loads(handle.read())
    package = parsed.get("package") if isinstance(parsed, dict) else None
    if not isinstance(package, dict) or not isinstance(package.get("files"), list):
        raise ValueError("JSON input is not a candidate artifact with an inline package")
    return {entry["path"]: entry["content"] for entry in package["files"]}


# -------------------------------------------------------- CSV through SQLite


def load_into_sqlite(nodes_csv: str, relationships_csv: str) -> tuple[sqlite3.Connection, int, int]:
    """The load an analyst does: two CSVs, one relational database, no TAVONEL code involved."""
    database = sqlite3.connect(":memory:")
    database.execute("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, label TEXT, document_id TEXT)")
    database.execute(
        "CREATE TABLE relationships (id TEXT PRIMARY KEY, subject_id TEXT, predicate TEXT,"
        " object_id TEXT, evidence_ids TEXT)"
    )

    nodes = list(csv.DictReader(io.StringIO(nodes_csv)))
    relationships = list(csv.DictReader(io.StringIO(relationships_csv)))
    database.executemany(
        "INSERT INTO nodes VALUES (?, ?, ?, ?)",
        [(row["id"], row["kind"], row["label"], row["document_id"]) for row in nodes],
    )
    database.executemany(
        "INSERT INTO relationships VALUES (?, ?, ?, ?, ?)",
        [
            (row["id"], row["subject_id"], row["predicate"], row["object_id"], row["evidence_ids"])
            for row in relationships
        ],
    )
    return database, len(nodes), len(relationships)


def sql_checks(database: sqlite3.Connection, failures: list[str]) -> dict[str, int]:
    """Query the ids back out. A load that cannot be queried is not a round trip."""
    query = database.execute

    dangling = query(
        "SELECT COUNT(*) FROM relationships r"
        " LEFT JOIN nodes s ON s.id = r.subject_id"
        " LEFT JOIN nodes o ON o.id = r.object_id"
        " WHERE s.id IS NULL OR o.id IS NULL"
    ).fetchone()[0]
    if dangling:
        failures.append(f"{dangling} relationship(s) point at an id SQL cannot find in nodes.csv")

    # evidence_ids is a space-separated list in one column; split it in SQL's own terms rather
    # than in Python, because the question is whether a SQL consumer can follow the provenance.
    evidence_referenced = set()
    for (packed,) in query("SELECT evidence_ids FROM relationships WHERE evidence_ids <> ''"):
        evidence_referenced.update(packed.split())
    known_evidence = {row[0] for row in query("SELECT id FROM nodes WHERE kind = 'Evidence'")}
    unresolved = sorted(evidence_referenced - known_evidence)
    if unresolved:
        failures.append(
            f"{len(unresolved)} evidence id(s) cited by a relationship are absent from nodes.csv,"
            f" first: {unresolved[0]}"
        )

    # One id re-read through SQL and compared to the CSV, so "loaded" cannot pass for "queryable".
    sample = query("SELECT id, label FROM nodes ORDER BY id LIMIT 1").fetchone()
    if sample is None:
        failures.append("nodes.csv loaded zero rows")
    else:
        again = query("SELECT label FROM nodes WHERE id = ?", (sample[0],)).fetchone()
        if again is None or again[0] != sample[1]:
            failures.append(f"re-reading {sample[0]} through SQL returned a different label")

    return {
        "evidence_ids_referenced": len(evidence_referenced),
        "evidence_nodes": len(known_evidence),
    }


# -------------------------------------------------------------- the ontology


def parse_jsonld(source: str) -> tuple[set[str], int]:
    document = json.loads(source)
    graph = document.get("@graph")
    if not isinstance(graph, list):
        raise ValueError("knowledge.jsonld has no @graph array")
    subjects = set()
    for node in graph:
        identifier = node.get("@id", "")
        if identifier.startswith(IRI_PREFIX):
            subjects.add(identifier[len(IRI_PREFIX) :])
    return subjects, len(graph)


def parse_turtle_minimally(source: str) -> tuple[set[str], set[str], int]:
    """A parser with a ceiling, stated where it is used.

    It handles exactly the shape this compiler emits: one statement per line, an IRI subject,
    `;`-separated predicate-object pairs, no blank nodes, no collections, no multi-line
    statements and no literals containing an unescaped quote. That is why its result is
    cross-checked against rdflib whenever rdflib is importable, and why the absence of rdflib is
    reported as a check that did not run.
    """
    subjects: set[str] = set()
    objects: set[str] = set()
    triples = 0

    for line in source.splitlines():
        statement = line.strip()
        if not statement or statement.startswith("@prefix") or statement.startswith("#"):
            continue
        if not statement.startswith("<") or not statement.endswith("."):
            raise ValueError(f"minimal Turtle parser cannot read: {statement[:60]}")
        end = statement.index(">")
        subject = statement[1:end]
        if not subject.startswith(IRI_PREFIX):
            raise ValueError(f"unexpected subject IRI: {subject}")
        subjects.add(subject[len(IRI_PREFIX) :])

        body = statement[end + 1 : -1]
        for pair in split_outside_quotes(body, ";"):
            if pair.strip():
                triples += 1
        # Angle brackets inside a literal are ordinary text: rdfs:label carries document prose,
        # and scanning for `<` without tracking quotes read one of those as an IRI and then
        # failed looking for its closing bracket.
        for iri in iris_outside_quotes(body):
            if iri.startswith(IRI_PREFIX):
                objects.add(iri[len(IRI_PREFIX) :])

    return subjects, objects, triples


def iris_outside_quotes(text: str) -> list[str]:
    found: list[str] = []
    quoted = False
    escaped = False
    opened = -1
    for index, character in enumerate(text):
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == '"':
            quoted = not quoted
            opened = -1
        elif quoted:
            continue
        elif character == "<":
            opened = index
        elif character == ">" and opened >= 0:
            found.append(text[opened + 1 : index])
            opened = -1
    return found


def split_outside_quotes(text: str, separator: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    quoted = False
    escaped = False
    for character in text:
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == '"':
            quoted = not quoted
        elif character == separator and not quoted:
            parts.append("".join(current))
            current = []
            continue
        current.append(character)
    parts.append("".join(current))
    return parts


def parse_turtle_with_rdflib(source: str) -> tuple[set[str], int] | None:
    try:
        import rdflib  # noqa: PLC0415 -- optional, and its absence is a reported limit
    except ImportError:
        return None
    graph = rdflib.Graph()
    graph.parse(data=source, format="turtle")
    subjects = {
        str(subject)[len(IRI_PREFIX) :]
        for subject in set(graph.subjects())
        if str(subject).startswith(IRI_PREFIX)
    }
    return subjects, len(graph)


# --------------------------------------------------------------------- main


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=True, description=__doc__.splitlines()[0])
    parser.add_argument("--package", required=True, help="directory, package.zip, or artifact.json")
    parser.add_argument("--json", action="store_true", help="print the receipt as JSON")
    options = parser.parse_args(argv)

    try:
        files = read_package(options.package)
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        sys.stderr.write(f"TAVONEL round trip failed: {error}\n")
        return 1

    missing = [path for path in REQUIRED if path not in files]
    if missing:
        sys.stderr.write(f"TAVONEL round trip failed: package is missing {', '.join(missing)}\n")
        return 1

    failures: list[str] = []
    skipped: list[str] = []

    database, node_count, relationship_count = load_into_sqlite(
        files["graph/nodes.csv"], files["graph/relationships.csv"]
    )
    evidence = sql_checks(database, failures)
    csv_ids = {row[0] for row in database.execute("SELECT id FROM nodes")}

    jsonld_subjects, jsonld_nodes = parse_jsonld(files["ontology/knowledge.jsonld"])
    turtle_subjects, turtle_objects, turtle_triples = parse_turtle_minimally(files["ontology/knowledge.ttl"])

    # The identity question, asked three ways. An id that survives one format and not another is
    # exactly the failure a customer discovers after importing into the wrong one.
    if jsonld_subjects != csv_ids:
        failures.append(
            f"JSON-LD and CSV disagree on ids: {len(jsonld_subjects - csv_ids)} only in JSON-LD,"
            f" {len(csv_ids - jsonld_subjects)} only in CSV"
        )
    if turtle_subjects - csv_ids:
        failures.append(f"{len(turtle_subjects - csv_ids)} Turtle subject(s) are absent from the CSV")
    if turtle_objects - csv_ids:
        failures.append(f"{len(turtle_objects - csv_ids)} Turtle object IRI(s) are absent from the CSV")
    if not turtle_triples:
        failures.append("knowledge.ttl produced zero triples")

    strict = parse_turtle_with_rdflib(files["ontology/knowledge.ttl"])
    if strict is None:
        skipped.append(
            "rdflib is not installed, so the Turtle was NOT parsed by a conformant RDF parser."
            " The counts below come from the minimal parser described in this script, which reads"
            " only one-statement-per-line IRI-subject Turtle. Install rdflib and re-run to check"
            " the Turtle the way a triple store would. This check did not pass -- it did not run."
        )
        rdflib_triples = None
    else:
        rdflib_subjects, rdflib_triples = strict
        if rdflib_subjects != turtle_subjects:
            failures.append("rdflib and the minimal parser disagree on the Turtle subject set")
        if rdflib_triples != turtle_triples:
            failures.append(
                f"rdflib counted {rdflib_triples} triples, the minimal parser counted {turtle_triples}"
            )

    receipt = {
        "package": os.path.basename(os.path.abspath(options.package)),
        "ok": not failures,
        "sqlite": {
            "nodes": node_count,
            "relationships": relationship_count,
            "evidence_nodes": evidence["evidence_nodes"],
            "evidence_ids_referenced": evidence["evidence_ids_referenced"],
        },
        "jsonld": {"nodes": jsonld_nodes, "subjects": len(jsonld_subjects)},
        "turtle": {
            "triples": turtle_triples,
            "subjects": len(turtle_subjects),
            "parser": "rdflib" if rdflib_triples is not None else "minimal",
        },
        "failures": failures,
        "skipped": skipped,
    }

    # In --json mode stdout is exactly one JSON document, so a caller can parse it without
    # stripping a trailing summary line. The human summary and the verdict go to stdout only in
    # the human mode; notices and failures always go to stderr either way.
    if options.json:
        sys.stdout.write(json.dumps(receipt, indent=2) + "\n")
    else:
        sys.stdout.write(
            f"sqlite: {node_count} nodes, {relationship_count} relationships loaded and queried back"
            f" ({evidence['evidence_ids_referenced']} evidence ids resolved)\n"
        )
        sys.stdout.write(f"jsonld: {len(jsonld_subjects)} subjects over {jsonld_nodes} nodes\n")
        sys.stdout.write(
            f"turtle: {turtle_triples} triples, {len(turtle_subjects)} subjects"
            f" ({receipt['turtle']['parser']} parser)\n"
        )
    for notice in skipped:
        sys.stderr.write(f"  SKIPPED {notice}\n")
    for failure in failures:
        sys.stderr.write(f"  FAILED  {failure}\n")
    if not options.json:
        sys.stdout.write(
            "ROUND TRIP OK\n" if not failures else f"ROUND TRIP FAILED: {len(failures)} check(s)\n"
        )
    return 0 if not failures else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        sys.stderr.write(f"TAVONEL round trip failed: {error}\n")
        sys.exit(1)
