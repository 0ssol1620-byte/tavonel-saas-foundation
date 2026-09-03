import { describe, expect, it } from "vitest";
// The validator is dependency-light .mjs so it can be published and read on its own.
import { filesFromArtifact, validateCompiledWorldPackage } from "../scripts/compiled-world/validate.mjs";
import { exploreSampleArtifact } from "./explore-sample";

/*
  Does the validator find anything?

  A validator that passes everything and a validator that works look identical from the outside,
  and the first one is worse than nothing: it converts "we did not check" into "we checked". So
  every rule below is exercised twice -- once against a package the compiler actually produced,
  which must be clean, and once against that same package with one field broken, which must fail
  with the specific code and not merely "some error".

  The clean fixture is the /explore sample, which is compiled from three committed PDFs by the
  same function that compiles a customer's documents. Nothing here is hand-written, so a change
  to the compiler that breaks the package contract fails here rather than in a customer's
  retrieval pipeline.
*/

type Files = Map<string, string>;

const REQUIRED = [
  "source/collection-files.json",
  "canonical/model.json",
  "ontology/knowledge.ttl",
  "ontology/knowledge.jsonld",
  "graph/nodes.csv",
  "graph/relationships.csv",
  "rag/documents.jsonl",
  "rag/chunks.jsonl",
  "provenance/activities.jsonl",
  "validation/report.json",
];

function samplePackage(): Files {
  return filesFromArtifact(exploreSampleArtifact) as Files;
}

/** Break one thing inside canonical/model.json and hand back the package. */
function withModel(mutate: (model: Record<string, never>) => void): Files {
  const files = samplePackage();
  const model = JSON.parse(files.get("canonical/model.json")!);
  mutate(model);
  files.set("canonical/model.json", JSON.stringify(model, null, 2) + "\n");
  return files;
}

function withChunks(mutate: (chunks: Record<string, never>[]) => void): Files {
  const files = samplePackage();
  const chunks = files.get("rag/chunks.jsonl")!.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  mutate(chunks);
  files.set("rag/chunks.jsonl", chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n");
  return files;
}

function codes(result: { errors: Array<{ code: string }> }) {
  return result.errors.map((error) => error.code);
}

describe("a package the compiler produced", () => {
  it("passes every check", () => {
    const result = validateCompiledWorldPackage(samplePackage());
    // Printed on failure, because "expected true, got false" would say nothing about which rule.
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("counts what is in it rather than what the report claims", () => {
    const result = validateCompiledWorldPackage(samplePackage());
    // `counts` is null only when canonical/model.json could not be read, which the case above
    // rules out -- so a null here is a finding, not a reason to reach for optional chaining.
    expect(result.counts).not.toBeNull();
    expect(result.counts!.documents).toBe(3);
    expect(result.counts!.evidence).toBeGreaterThan(0);
    expect(result.counts!.relations).toBeGreaterThan(0);
  });

  it("reports an unsigned package as unsigned instead of passing it as signed", () => {
    /*
      The compiler cannot sign: `signatureStatus` is `external_signer_required` and the signing
      key lives outside this process. A validator that stayed silent about that would let an
      unsigned package look like a checked one.
    */
    const result = validateCompiledWorldPackage(samplePackage());
    expect(result.notices.map((notice: { code: string }) => notice.code)).toContain("SIGNATURE_ABSENT");
    expect(codes(result)).not.toContain("SIGNATURE_ABSENT");

    const required = validateCompiledWorldPackage(samplePackage(), { requireSignature: true });
    expect(codes(required)).toContain("SIGNATURE_ABSENT");
    expect(required.ok).toBe(false);
  });

  it("names the mislabeled CSV header without failing the package for it", () => {
    // The defect is real and the fix moves every artifact digest, so it is a warning with a
    // name rather than a silent pass or a red build. `validate.mjs` records why in full.
    const result = validateCompiledWorldPackage(samplePackage());
    expect(result.warnings.map((warning: { code: string }) => warning.code)).toContain("GRAPH_CSV_HEADER_MISLABELED");
    expect(result.ok).toBe(true);
  });
});

describe("structure", () => {
  it.each(REQUIRED)("fails when %s is missing", (path) => {
    const files = samplePackage();
    files.delete(path);
    expect(codes(validateCompiledWorldPackage(files))).toContain("PACKAGE_FILE_MISSING");
  });

  it("refuses a file outside the declared roots", () => {
    const files = samplePackage();
    files.set("scripts/postinstall.js", "console.log('hello')");
    expect(codes(validateCompiledWorldPackage(files))).toContain("PACKAGE_ROOT_UNKNOWN");
  });

  it("refuses a path that would escape the extraction directory", () => {
    const files = samplePackage();
    files.set("canonical/../../etc/passwd", "root:x:0:0");
    expect(codes(validateCompiledWorldPackage(files))).toContain("PATH_UNSAFE");
  });

  it("refuses a model that is not JSON at all", () => {
    const files = samplePackage();
    files.set("canonical/model.json", "{ not json");
    expect(codes(validateCompiledWorldPackage(files))).toContain("FILE_NOT_PARSEABLE");
  });
});

describe("schema and compatibility", () => {
  it("refuses a schema version it does not know", () => {
    const files = withModel((model) => { model.schemaVersion = "akc.canonical-knowledge-model.v2" as never; });
    expect(codes(validateCompiledWorldPackage(files))).toContain("SCHEMA_UNSUPPORTED");
  });

  it("refuses a blueprint it does not know", () => {
    // Compatibility in the §22.3 sense: a consumer must be told the shape changed rather than
    // reading a v2 package with v1 assumptions and finding fields silently absent.
    const files = withModel((model) => { (model.blueprint as unknown as { version: string }).version = "2.0.0"; });
    expect(codes(validateCompiledWorldPackage(files))).toContain("BLUEPRINT_UNSUPPORTED");
  });
});

describe("stable identity", () => {
  it("refuses an object whose id does not carry its kind", () => {
    const files = withModel((model) => {
      const nodes = model.nodes as unknown as Array<{ id: string; kind: string }>;
      const topic = nodes.find((node) => node.kind === "Topic")!;
      topic.id = topic.id.replace("topic-", "thing-");
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("ID_NOT_STABLE");
  });

  it("refuses a duplicated id", () => {
    const files = withModel((model) => {
      const nodes = model.nodes as unknown as Array<{ id: string }>;
      nodes[1].id = nodes[0].id;
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("ID_DUPLICATE");
  });

  it("refuses an unknown object kind", () => {
    const files = withModel((model) => {
      (model.nodes as unknown as Array<{ kind: string }>)[0].kind = "Vibe";
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("OBJECT_KIND_UNKNOWN");
  });
});

describe("referential integrity", () => {
  it("refuses a relation whose subject is not in the package", () => {
    /*
      The failure this rule exists for: a graph that loads, renders and answers, with an edge
      pointing at an object that was dropped somewhere upstream. Nothing throws; the answer is
      just missing a hop nobody can see.
    */
    const files = withModel((model) => {
      (model.edges as unknown as Array<{ from: string }>)[0].from = `document-${"0".repeat(32)}`;
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("RELATION_DANGLING");
  });

  it("refuses a relation whose predicate the blueprint never declared", () => {
    const files = withModel((model) => {
      (model.edges as unknown as Array<{ type: string }>)[0].type = "probably_relates_to";
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("PREDICATE_UNDECLARED");
  });

  it("refuses an object citing evidence the package does not contain", () => {
    const files = withModel((model) => {
      const nodes = model.nodes as unknown as Array<{ evidenceIds: string[] }>;
      const cited = nodes.find((node) => node.evidenceIds.length > 0)!;
      cited.evidenceIds = [`evidence-${"0".repeat(32)}`];
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("EVIDENCE_DANGLING");
  });

  it("refuses an object bound to a document that was never read", () => {
    const files = withModel((model) => {
      const nodes = model.nodes as unknown as Array<{ kind: string; documentId?: string }>;
      nodes.find((node) => node.kind === "Document")!.documentId = "doc-that-was-not-compiled";
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("SOURCE_UNBOUND");
  });
});

describe("source version binding", () => {
  it("refuses an input binding without a content version key", () => {
    const files = withModel((model) => {
      (model.inputBinding as unknown as Array<{ versionKey: string }>)[0].versionKey = "v1";
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("SOURCE_VERSION_INVALID");
  });

  it("refuses an input binding without a source digest", () => {
    const files = withModel((model) => {
      (model.inputBinding as unknown as Array<{ inputSha256: string }>)[0].inputSha256 = "unknown";
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("SOURCE_DIGEST_INVALID");
  });
});

describe("the evidence coordinate system", () => {
  it("refuses a region outside the page frame", () => {
    const files = withChunks((chunks) => {
      (chunks[0] as unknown as { bbox1000: number[] }).bbox1000 = [0, 0, 1200, 400];
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("COORDINATE_OUT_OF_RANGE");
  });

  it("refuses a region with no area, which would highlight nothing", () => {
    const files = withChunks((chunks) => {
      (chunks[0] as unknown as { bbox1000: number[] }).bbox1000 = [400, 400, 400, 400];
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("COORDINATE_DEGENERATE");
  });

  it("refuses a bbox that is not four integers", () => {
    const files = withChunks((chunks) => {
      (chunks[0] as unknown as { bbox1000: unknown }).bbox1000 = [0.5, 1, 2, 3];
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("COORDINATE_MALFORMED");
  });

  it("refuses a zero-based page number", () => {
    // Pages are 1-based everywhere a person sees them. A 0 here is an off-by-one that sends a
    // reader to the wrong page of their own document.
    const files = withChunks((chunks) => {
      (chunks[0] as unknown as { pageNumber1: number }).pageNumber1 = 0;
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("PAGE_OUT_OF_RANGE");
  });

  it("refuses a chunk citing a claim that is not an object in the package", () => {
    const files = withChunks((chunks) => {
      (chunks[0] as unknown as { claimIds: string[] }).claimIds = [`claim-${"0".repeat(32)}`];
    });
    expect(codes(validateCompiledWorldPackage(files))).toContain("CLAIM_DANGLING");
  });
});

describe("the four representations are one graph", () => {
  it("catches a CSV that lost a row", () => {
    const files = samplePackage();
    const rows = files.get("graph/nodes.csv")!.split("\n").filter(Boolean);
    files.set("graph/nodes.csv", rows.slice(0, -1).join("\n") + "\n");
    expect(codes(validateCompiledWorldPackage(files))).toContain("GRAPH_DISAGREEMENT");
  });

  it("catches JSON-LD that describes a different number of objects", () => {
    const files = samplePackage();
    const jsonld = JSON.parse(files.get("ontology/knowledge.jsonld")!);
    jsonld["@graph"].pop();
    files.set("ontology/knowledge.jsonld", JSON.stringify(jsonld, null, 2) + "\n");
    expect(codes(validateCompiledWorldPackage(files))).toContain("GRAPH_DISAGREEMENT");
  });

  it("catches Turtle that states a different number of facts", () => {
    const files = samplePackage();
    const lines = files.get("ontology/knowledge.ttl")!.split("\n");
    files.set("ontology/knowledge.ttl", lines.filter((line) => !line.startsWith("<urn:tavonel:")).join("\n"));
    expect(codes(validateCompiledWorldPackage(files))).toContain("GRAPH_DISAGREEMENT");
  });

  it("catches a report that counts something the package does not hold", () => {
    const files = samplePackage();
    const report = JSON.parse(files.get("validation/report.json")!);
    report.counts.claims += 1;
    files.set("validation/report.json", JSON.stringify(report, null, 2) + "\n");
    expect(codes(validateCompiledWorldPackage(files))).toContain("COUNTS_DISAGREE");
  });
});
