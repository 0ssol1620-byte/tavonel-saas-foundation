import { readFileSync } from "node:fs";
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
