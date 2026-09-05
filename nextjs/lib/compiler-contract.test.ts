import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCapabilities } from "./capabilities";
import { CLAIM_STATE } from "./claim-state";
import {
  CONTRACT_CLAUSES,
  CONTRACT_STATE,
  INTEROP_STANDARDS,
  PACKAGE_FORMATS,
  clause,
  isClaimedCapability,
  type ContractClause,
} from "./compiler-contract";

/*
  The Compiler Contract page makes eight statements about what this product guarantees, and the
  interesting failure is not a crash. It is one adjective moving: a clause quietly going from
  "direction" to "qualified" in a copy pass, on a page whose whole argument is that the two are
  different words. So the states are asserted here, and the one that would be most valuable to
  overstate -- selective recompilation -- is asserted against the live capability grid rather
  than against a copy of its wording.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

/** Comments explain what a page may not say and must not themselves count as saying it. */
const stripComments = (source: string) =>
  source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

describe("compiler contract clauses", () => {
  it("carries the eight clauses of the contract, in contract order", () => {
    expect(CONTRACT_CLAUSES.map((entry) => entry.name)).toEqual([
      "Evidence-preserving",
      "Stable semantic identity",
      "Typed dependencies",
      "Temporal integrity",
      "Selective recompilation",
      "Full-rebuild equivalence",
      "Multi-model verification",
      "Portable World",
    ]);
  });

  it("gives every clause a slug that can be linked to, with no duplicates", () => {
    const ids = CONTRACT_CLAUSES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, `${id} is not a URL fragment`).toMatch(/^[a-z][a-z-]*[a-z]$/);
    expect(clause("portable-world").name).toBe("Portable World");
    expect(() => clause("no-such-clause")).toThrow();
  });

  /*
    A clause with no way to check it is an opinion in a table.

    Every clause names a file, a route or a package path. This does not check that the pointer is
    correct -- nothing in a unit test can -- but it does stop a clause being added with nothing
    behind it, which is the shape the fabricated ones take.
  */
  it("points every clause at something in this repository", () => {
    for (const entry of CONTRACT_CLAUSES) {
      expect(entry.evidence.length, `${entry.name} cites nothing`).toBeGreaterThan(20);
      expect(entry.body.length, `${entry.name} has no explanation`).toBeGreaterThan(200);
      expect(entry.promise.length, `${entry.name} has no one-line promise`).toBeGreaterThan(20);
    }
  });

  /*
    Fail closed on the strongest word.

    "Qualified" means qualification evidence exists for a named scope. Nothing on this deployment
    has that, and the way to change it is to attach a receipt -- not to edit the state. A clause
    marked qualified without one fails here rather than shipping.
  */
  it("refuses a qualified clause that names no receipt", () => {
    for (const entry of CONTRACT_CLAUSES) {
      if (entry.state !== "qualified") continue;
      expect(
        typeof entry.receipt === "string" && entry.receipt.length > 0,
        `${entry.name} is marked ${CONTRACT_STATE.qualified.label} but names no receipt`,
      ).toBe(true);
    }
    const withoutReceipt: ContractClause = { ...clause("portable-world"), state: "qualified", receipt: undefined };
    expect(isClaimedCapability(withoutReceipt)).toBe(false);
    expect(isClaimedCapability({ ...withoutReceipt, receipt: "docs/evidence/artifacts/example" })).toBe(true);
  });

  it("claims no qualified capability on this deployment", () => {
    // Not a style rule: no equivalence, benchmark or qualification receipt is published on this
    // branch, so a qualified clause here would be a claim with nothing behind it.
    expect(CONTRACT_CLAUSES.filter(isClaimedCapability)).toEqual([]);
  });

  it("takes its state words from the shared vocabulary instead of inventing new ones", () => {
    expect(CONTRACT_STATE.qualified.label).toBe(CLAIM_STATE.qualified.label);
    expect(CONTRACT_STATE.demonstrated.label).toBe(CLAIM_STATE.demonstrated.label);

    const grid = readCapabilities(null, false);
    const direction = grid.filter((capability) => capability.tone === "direction");
    expect(direction.length, "the capability grid no longer has a Direction row to borrow from")
      .toBeGreaterThan(0);
    expect(CONTRACT_STATE.direction.label).toBe(direction[0]!.state.toUpperCase());
  });

  /*
    The clause the product is most tempted to upgrade.

    The live capability grid says selective recompilation is Direction and not offered as a
    shipped capability. This page says the same thing in its own words, and both files are read
    here so the two cannot drift apart without something failing.
  */
  it("says the same thing about selective recompilation as the live capability grid", () => {
    const grid = readCapabilities(null, false).find((c) => c.name === "Selective recompilation");
    expect(grid, "the capability grid no longer carries a selective recompilation row").toBeTruthy();
    expect(grid!.state).toBe("Direction");
    expect(grid!.note).toContain("Not offered as a shipped capability");

    const selective = clause("selective-recompilation");
    expect(selective.state).toBe("direction");
    expect(selective.body).toContain("Demonstrated on fixture data");
    expect(selective.body).toContain("Not offered as a shipped capability");
  });

  it("keeps equivalence, identity and second-read verification out of the shipped column", () => {
    for (const id of ["full-rebuild-equivalence", "multi-model-verification", "stable-semantic-identity"]) {
      expect(clause(id).state, `${id} must not be presented as shipped`).toBe("direction");
    }
  });

  /*
    The evidence chain the first clause describes has to be the one the compiler writes.

    An earlier draft of this clause copied the blueprint's aspirational chain -- relation, claim,
    *statement*, block or *table cell* -- into a clause graded DEMONSTRATED. Neither rung exists:
    there is no statement object anywhere in the compiled model, and `blockType` has exactly one
    member, so a table-cell region is rejected by the very validator the clause was citing. Those
    are the details a technical evaluator quotes back, which is what makes them worth a test.
  */
  it("describes only the evidence rungs the compiler actually emits", () => {
    const compiler = read("./collection-compiler.ts");
    // The rung the clause names, in the order the clause names it: a typed relation carrying its
    // own evidence, a claim reaching that evidence, and the region where the coordinates live.
    expect(compiler).toContain('type: "supported_by"');
    expect(compiler).toContain("evidenceIds: [evidenceId]");
    expect(compiler).toContain("sourceVersionId: input.versionKey");
    expect(compiler).toContain("pageNumber1: region.pageNumber1");
    expect(compiler).toContain("bbox1000: region.bbox1000");
    expect(compiler).toContain("claimIds: regionClaimIds");
    // The version key is the sha256 of the bytes that were read, checked against inputSha256.
    expect(compiler).toContain("`sha256:${input.versionKey.toLowerCase()}`");
    // The only block type a region may carry, enforced in validateCollectionOcrInput.
    expect(compiler).toContain('region.blockType !== "paragraph"');
    expect(compiler.toLowerCase()).not.toContain("table cell");
    expect(compiler.toLowerCase()).not.toContain("statement");
    // The abstention the clause promises, at the one place a bad region reaches the compiler.
    expect(read("./collection-compile-run.ts")).toContain('code: "OCR_BINDING_INVALID"');

    const body = clause("evidence-preserving").body.toLowerCase();
    for (const invented of ["statement", "table cell"]) {
      expect(body, `the evidence clause claims a "${invented}" rung the compiler does not build`)
        .not.toContain(invented);
    }
    for (const named of ["supported_by", "ocr_binding_invalid", "bounding box"]) {
      expect(body, `the evidence clause no longer names "${named}", which the test above pins`)
        .toContain(named);
    }
  });

  /*
    The dependency clause has to describe the graph the compiler writes, not the one it wants.

    This is the same defect the test above catches on clause 01, found a second time on clause 03:
    the blueprint's ladder -- region supports claim, claim supports relation, relation projected
    into a retrieval unit -- was pasted verbatim into a clause graded DEMONSTRATED. Three of those
    rungs are absent from the emitter, and the sentence "typed rather than implied by
    co-occurrence" inverted what two of the three edge types actually are. Clause 01 was pinned
    and clause 03 was not, which is exactly why it survived a round of review, so it is pinned
    here in both directions: the edges the compiler emits, and the words the clause may not use.
  */
  it("describes only the dependency edges the compiler actually emits", () => {
    const compiler = read("./collection-compiler.ts");
    // The entire edge vocabulary. A fourth type means the clause is re-derived, not extended.
    expect(compiler).toContain('type: "discusses_topic" | "mentions_entity" | "supported_by";');
    // The one claim edge runs claim -> evidence, and that evidence is a whole document version.
    expect(compiler).toContain('type: "supported_by"');
    expect(compiler).toContain("from: claimId");
    expect(compiler).toContain("to: evidenceId");
    expect(compiler).toContain('const evidenceId = stableId("evidence", input.documentId, input.versionKey)');
    // Both document edges are derived from the whole document text, which is co-occurrence.
    expect(compiler).toContain("const text = normalizeText(input.text);");
    expect(compiler).toContain("for (const topic of topicsFor(text))");
    expect(compiler).toContain("for (const entity of entitiesFor(text))");
    // The header the clause quotes, taken from the emitter rather than retyped.
    expect(compiler).toContain('"id,subject_id,predicate,object_id,evidence_ids"');
    // A retrieval unit carries claims and entities and no relation of any kind.
    const chunkType = /export type GroundedChunk = \{[\s\S]*?\n\};/.exec(read("./grounded-ask.ts"))?.[0];
    expect(chunkType, "GroundedChunk is no longer a type literal this test can read").toBeTruthy();
    expect(chunkType!).toContain("claimIds: string[]");
    expect(chunkType!.toLowerCase(), "a retrieval unit now carries a relation; the clause may say so")
      .not.toContain("relation");
    expect(read("./world-gate.ts")).toContain('reason: "NO_EVIDENCE_BOUND"');

    const body = clause("typed-dependencies").body.toLowerCase();
    for (const absent of [
      "a claim supports a relation",
      "a relation is projected into a retrieval unit",
      "rather than implied by co-occurrence",
    ]) {
      expect(body, `the dependency clause claims "${absent}", which the compiler does not do`)
        .not.toContain(absent);
    }
    for (const named of ["discusses_topic", "mentions_entity", "supported_by", "co-occurrence"]) {
      expect(body, `the dependency clause no longer names "${named}", which the test above pins`)
        .toContain(named);
    }
  });

  /*
    The package validator is an offline check, and the clause has to keep saying so.

    `validateCompiledWorldPackage` is imported by exactly one module -- its own test -- and is
    otherwise reached through the `verify:package` CLI. Describing it as an emission gate would
    promise a runtime refusal that no code performs, on the clause carrying the stronger word.
  */
  it("does not present the package validator as a gate on the emit path", () => {
    const importers = ["./collection-compiler.ts", "./collection-download.ts", "./retrieval-compile.ts"]
      .filter((path) => read(path).includes("compiled-world/validate"));
    expect(importers, "the validator now runs on the emit path; the clause may be upgraded").toEqual([]);

    const body = clause("evidence-preserving").body;
    expect(body).toContain("offline check");
    expect(body, "the clause promises a refusal the emit path does not perform")
      .not.toContain("is not emitted");
  });
});

/*
  The promise line, which nothing was reading.

  Two rounds of review went into the clause *bodies* -- clause 01's evidence rungs and clause 03's
  edge types are both pinned to `collection-compiler.ts` literal by literal -- while the field
  above them was held by `promise.length > 20`. That is the field the page renders a step larger
  than the body, and it is the sentence a reader who reads one sentence per clause reads. Clause
  01 spent both of those rounds promising that every promoted fact "resolves to a region of a page
  of a source revision" directly above a paragraph explaining that a document read without regions
  emits no region at all -- the page contradicting itself, with the false half in the larger type.

  So the eight promises are frozen here. This is a weaker kind of test than the body pins below it
  and it is worth saying which kind: it does not know whether a promise is true. It makes changing
  one an edit to this file, where the sentence sits next to the code that has to support it, in a
  diff a reviewer sees. The clauses whose truth can be pinned are pinned underneath.
*/
describe("contract promises", () => {
  const PROMISES: ReadonlyArray<readonly [string, string]> = [
    ["evidence-preserving", "Every promoted fact names the exact source version it was read from, and every region names its page and its box."],
    ["stable-semantic-identity", "The same thing named four ways is one object, or it is left unresolved."],
    ["typed-dependencies", "The edges between knowledge units are typed and carry their own evidence."],
    ["temporal-integrity", "A fact that has been replaced cannot be served as current."],
    ["selective-recompilation", "Two changed pages rebuild what depends on them, not the corpus."],
    ["full-rebuild-equivalence", "A selective result must match a full rebuild, or it does not publish."],
    ["multi-model-verification", "A reader's own confidence is not evidence that it read the page correctly."],
    ["portable-world", "A compiled World leaves as a signed package you can verify without us."],
  ];

  it("publishes exactly the eight promise lines this file was reviewed with", () => {
    expect(CONTRACT_CLAUSES.map((entry) => [entry.id, entry.promise])).toEqual(
      PROMISES.map(([id, promise]) => [id, promise]),
    );
  });

  /*
    Clause 01's promise, against the code that would have to keep it.

    A region is optional twice over. `validateCollectionOcrInput` accepts `regions: undefined` as
    a valid input, and the caller only ever passes regions for an OCR v2 read -- so a v1 document
    compiles to Claim nodes and zero region-bound retrieval units. Even where regions exist, a
    claim is bound to one by substring match, and `input.text` is the region texts joined with a
    newline while claims are split on sentence punctuation, so a sentence crossing a region
    boundary matches no region. What is true of *every* promoted fact is the version it was read
    from: the Claim node's only evidence id is keyed by documentId + versionKey, and versionKey is
    checked against the sha256 of the bytes. The promise says that, and may not say more.
  */
  it("promises a source version for every fact and a region only where one exists", () => {
    const compiler = read("./collection-compiler.ts");
    // Regions are optional at validation, and absent entirely from a v1 read.
    expect(compiler).toContain("if (input.regions !== undefined) {");
    expect(compiler).toContain("for (const region of input.regions ?? []) {");
    expect(read("./collection-compile-run.ts"))
      .toContain('regions: json.schemaVersion === "tavonel.ocr_result.v2" ? json.regions : undefined');
    // A claim's evidence is a whole document version; the page and box live on the region.
    expect(compiler).toContain('const evidenceId = stableId("evidence", input.documentId, input.versionKey)');
    expect(compiler).toContain('nodes.push({ id: claimId, kind: "Claim", label: claim, documentId: input.documentId, evidenceIds: [evidenceId] });');
    expect(compiler).toContain("pageNumber1: region.pageNumber1");
    expect(compiler).toContain("bbox1000: region.bbox1000");
    expect(compiler).toContain("`sha256:${input.versionKey.toLowerCase()}`");

    const promise = clause("evidence-preserving").promise.toLowerCase();
    for (const overclaim of ["resolves to a region", "region of a page of a source revision"]) {
      expect(promise, `the promise claims every fact "${overclaim}", which an OCR v1 read does not produce`)
        .not.toContain(overclaim);
    }
    expect(promise, "the promise no longer names the binding that does hold for every fact")
      .toContain("exact source version");
  });

  /*
    No sentence a visitor reads may name a tool only this repository can run.

    The page told a reader to run `pnpm verify:export` against a downloaded archive. That script
    is `scripts/verify-signed-export.mjs` in the private site repository: it is not in the package,
    not in `public/developer/`, and not a command in the published CLI. It was the only pnpm script
    named in the visible copy of any page in this app, so it was not a convention a reader would
    discount -- it was an instruction that fails. The `evidence` field is exempt on purpose: it is
    declared as a pointer into this repository, and "WHERE TO CHECK IT" is addressed to someone
    reading the source, not to someone holding a zip.
  */
  it("names no repository-only script in a sentence addressed to a reader", () => {
    for (const entry of CONTRACT_CLAUSES) {
      expect(entry.promise, `${entry.name} promises a command a reader cannot run`).not.toMatch(/\bpnpm\s/);
      expect(entry.body, `${entry.name} tells a reader to run a repository script`).not.toMatch(/\bpnpm\s/);
    }
    expect(stripComments(read("../app/product/continuous-knowledge/page.tsx")), "the page names a pnpm script")
      .not.toMatch(/\bpnpm\s/);

    // And the verifier is still absent from everything a holder receives.
    const shipped = readdirSync(resolve(import.meta.dirname, "../public/developer"));
    expect(shipped.filter((file) => file.toLowerCase().includes("verify")), "a verifier now ships to /developer; the portable-world copy can be re-derived")
      .toEqual([]);
    expect(read("../public/developer/tavonel-cli.mjs")).not.toContain("verify:export");
    expect(read("./collection-download.ts"), "the archive no longer writes the README the clause describes")
      .toContain("Verify manifest/export-manifest.json against signatures/export-manifest.ed25519.json");
  });

  /*
    What is left of the portable-world promise once the tool is gone.

    "A signed package you can verify without us" survives only because the archive carries the
    public key the signature was made with and states the algorithm. Both are asserted here, so
    the promise fails with the thing that supports it rather than outliving it.
  */
  it("keeps the archive self-describing enough for the offline check it promises", () => {
    const download = read("./collection-download.ts");
    expect(download).toContain("Every listed file was SHA-256 checked, then the exact export manifest bytes were signed with Ed25519.");
    expect(download).toContain('entries["signatures/export-manifest.ed25519.json"]');
    // The signature object carries the key, not only its fingerprint -- otherwise "without us"
    // would require our endpoint to perform the check at all, rather than to pin the key.
    expect(read("./export-signing.ts")).toContain("publicKeySpkiDerBase64");

    const body = clause("portable-world").body;
    expect(body).toContain("Ed25519");
    expect(body).toContain("EXPORT_SIGNER_NOT_CONFIGURED");
    expect(read("../app/api/collections/[id]/download/route.ts")).toContain("EXPORT_SIGNER_NOT_CONFIGURED");
  });
});

/*
  The three surfaces that say whether this route is public, and the one this lane cannot reach.

  The lane specification asks for the page in the sitemap. A previous revision instead withdrew
  the sitemap row and put `robots: { index: false }` on the page, so that the page would agree
  with the `Disallow: /product/continuous-knowledge` that `app/robots.ts` has carried since this
  route was a `notFound()` stub -- and reported that as three surfaces agreeing. Two of the three
  cannot both act: a crawler that obeys the disallow never fetches the page and never reads its
  meta tag, while `/product` -- indexed, in the sitemap -- keeps publishing a plain link to the
  URL, which is how a bare URL with no title lands in a result page.

  This test holds the two surfaces this lane owns. The third, `app/robots.ts`, belongs to no lane
  in this campaign and is deliberately not asserted here: pinning a line someone else has to
  delete would make the correct fix fail this file.
*/
describe("the crawl surface for the contract route", () => {
  const ROUTE = "/product/continuous-knowledge";

  it("lists the route in the sitemap, as the lane specification requires", () => {
    expect(read("../app/sitemap.ts")).toContain(`"${ROUTE}"`);
  });

  it("makes no noindex claim the crawler that reaches this page could act on", () => {
    // Stripped, because the comment above the metadata explains the field that used to be here.
    const page = stripComments(read("../app/product/continuous-knowledge/page.tsx"));
    expect(page, "the page is in the sitemap and noindex at once")
      .not.toMatch(/robots:\s*\{[^}]*index:\s*false/);
    expect(page).toContain(`canonical: "${ROUTE}"`);
    expect(page).toContain(`openGraph: { url: "${ROUTE}" }`);
  });

  it("is linked from the product index, which is what makes the disallow line matter", () => {
    expect(read("../app/product/page.tsx")).toContain(ROUTE);
  });
});

/*
  The drawing has to agree with the clause list it illustrates.

  A flowchart is the one element a reader looks at instead of reading eight paragraphs, so a
  stage drawn solid under a legend that reads "RUNS IN THIS DEPLOYMENT" is a stronger claim than
  any sentence on the page. Each stage belongs to a clause; a stage whose clause is graded a
  direction may not be drawn as built. The diagram is a component, and vitest only collects
  `lib/**`, so it is read as text -- which is enough, because the states are literals.
*/
describe("compiler contract diagram", () => {
  const DIAGRAM = read("../components/compiler-contract-diagram.tsx");

  /** Which clause each drawn stage is an illustration of. Stages absent from the map stand alone. */
  const STAGE_CLAUSE: Record<string, string> = {
    "semantic-diff": "selective-recompilation",
    "dependency-impact": "selective-recompilation",
    preserved: "selective-recompilation",
    recompiled: "selective-recompilation",
    equivalence: "full-rebuild-equivalence",
    pass: "full-rebuild-equivalence",
    refuse: "full-rebuild-equivalence",
    "previous-world": "full-rebuild-equivalence",
  };

  // `title:` is what separates a stage entry from an edge entry; both carry an id and a state.
  const stages = [...DIAGRAM.matchAll(/\{ id: "([a-z-]+)", title: .*?state: "(built|direction)"/g)]
    .map(([, id, state]) => ({ id: id!, state: state! }));

  it("draws the ten stages of the contract", () => {
    expect(stages.map((entry) => entry.id)).toEqual([
      "source-change",
      "semantic-diff",
      "dependency-impact",
      "preserved",
      "recompiled",
      "equivalence",
      "pass",
      "refuse",
      "new-world",
      "previous-world",
    ]);
  });

  it("never draws a stage as built that its own clause grades a direction", () => {
    for (const entry of stages) {
      const owning = STAGE_CLAUSE[entry.id];
      if (!owning || entry.state !== "built") continue;
      expect(
        clause(owning).state,
        `the drawing shows "${entry.id}" as running here while clause "${owning}" is a direction`,
      ).not.toBe("direction");
    }
  });

  /*
    Only two stages run, and the deployment is the reason.

    `lib/pipeline.ts` compiles in four stages and none of them is a diff or an impact resolver,
    and `lib/world-version-diff.ts` compares two worlds that have both already been compiled in
    full. If either changes, this fails and the drawing is re-derived rather than left behind.
  */
  it("draws as built only the two stages this deployment executes", () => {
    expect(stages.filter((entry) => entry.state === "built").map((entry) => entry.id))
      .toEqual(["source-change", "new-world"]);

    const pipeline = read("./pipeline.ts");
    expect(pipeline).toContain('export type StageKey = "quarantine" | "sanitize" | "read" | "compile"');
    expect(read("./world-version-diff.ts")).toContain("derived from two compiled read models");
  });

  it("carries a solid route from the source change to the new World, because a full recompile is what runs", () => {
    expect(DIAGRAM).toContain('{ id: "full-recompile", d: bypass(), state: "built" }');
    expect(DIAGRAM).toContain("FULL RECOMPILE");
    // Every other edge is the contract, not the code path.
    const edges = [...DIAGRAM.matchAll(/\{ id: "([^"]+)", d: [a-z]+\([^)]*\), state: "(built|direction)" \}/g)]
      .map(([, id, state]) => ({ id: id!, state: state! }));
    expect(edges.filter((edge) => edge.state === "built").map((edge) => edge.id)).toEqual(["full-recompile"]);
  });

  it("says in its own description how many stages are solid, and why", () => {
    expect(DIAGRAM).toContain("Two stages are drawn");
    expect(DIAGRAM).toContain("rebuilds the whole collection it is given");
  });
});

describe("portable world formats", () => {
  /*
    Every format named on the page is a path the compiler writes.

    The list on a product page and the list the compiler emits are exactly the two things that
    drift, so the page's list is checked against the emitter rather than against the README.
  */
  it("names only paths the collection compiler actually writes", () => {
    const compiler = read("./collection-compiler.ts");
    for (const [, paths] of PACKAGE_FORMATS) {
      for (const path of paths.split(", ")) {
        const literal = path.replace("obsidian/Sources/*.md", "obsidian/Sources/");
        expect(compiler, `${path} is offered on the page but not written by the compiler`).toContain(literal);
      }
    }
  });

  it("offers the six formats the signed archive documents", () => {
    expect(PACKAGE_FORMATS.map(([name]) => name)).toEqual([
      "JSON",
      "Turtle",
      "JSON-LD",
      "CSV",
      "JSON Lines",
      "Markdown",
    ]);
  });
});

describe("interoperability standards", () => {
  it("lists the nine standards of the interoperability section", () => {
    expect(INTEROP_STANDARDS.map((entry) => entry.name)).toEqual([
      "RDF",
      "Turtle",
      "JSON-LD",
      "OWL 2",
      "SHACL",
      "PROV-O",
      "OpenLineage",
      "OpenAPI",
      "MCP",
    ]);
  });

  /*
    A standard is "demonstrated" only when a compile emits it.

    OWL 2, SHACL, PROV-O and OpenLineage are vocabularies this product references or intends to
    speak; none of the four is produced by the emitter. Naming them next to Turtle without that
    distinction is how a reader comes away believing nine standards are supported.
  */
  it("marks as emitted only the standards the compiler writes today", () => {
    const emitted = INTEROP_STANDARDS.filter((entry) => entry.state === "demonstrated").map((entry) => entry.name);
    expect(emitted).toEqual(["RDF", "Turtle", "JSON-LD", "OpenAPI", "MCP"]);

    const compiler = read("./collection-compiler.ts");
    expect(compiler).toContain("ontology/knowledge.ttl");
    expect(compiler).toContain("ontology/knowledge.jsonld");
    expect(compiler).not.toContain("shacl");
    expect(compiler).not.toContain("OpenLineage");
  });

  it("does not let PROV-O be read as an emitted provenance graph", () => {
    const provo = INTEROP_STANDARDS.find((entry) => entry.name === "PROV-O")!;
    expect(provo.state).toBe("direction");
    expect(provo.note).toContain("not emitted");
    // The reference the note describes is real, and is what the note is careful about.
    expect(read("./collection-compiler.ts")).toContain("prov#wasDerivedFrom");
  });

  it("gives every standard a note that says what is and is not there", () => {
    for (const entry of INTEROP_STANDARDS) {
      expect(entry.note.length, `${entry.name} has no note`).toBeGreaterThan(60);
    }
  });
});
