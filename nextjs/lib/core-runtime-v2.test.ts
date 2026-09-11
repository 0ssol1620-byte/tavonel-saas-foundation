import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_MIXED_CORPUS_BLUEPRINT,
  advertisedOntologyRelations,
  type CollectionOcrInput,
} from "./collection-compiler";
import { validateDownloadableCollectionArtifact, validatePromotableCollectionArtifact } from "./collection-download";
import { CONTRACT_CLAUSES, clause } from "./compiler-contract";
import {
  CORE_V2_REVISION_COMPILE_FLAG,
  PRODUCT_CORE_RESPONSE_SCHEMA,
  buildProductCoreV2Request,
  dispatchProductCoreV2,
  projectProductCoreV2Candidate,
  readProductCoreV2Env,
  readRevisionCompileSnapshot,
  revisionCompileEnabled,
} from "./core-runtime-v2";

/** One reader for the source files these tests assert against, rather than four inline URLs. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;

function inputs(): CollectionOcrInput[] {
  return ["a", "b"].map((letter, index) => {
    const versionKey = letter.repeat(64);
    const documentId = `doc-${index + 1}`;
    const sanitizedKey = `immutable/pilot/pilot/${documentId}/${versionKey}/sanitized.pdf`;
    const text = `Document ${index + 1} evidence is complete.`;
    return {
      documentId,
      versionKey,
      sanitizedKey,
      ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
      pageCount: 1,
      text,
      inputSha256: `sha256:${versionKey}`,
      sourceImmutableKey: sanitizedKey,
      regions: [{
        regionId: `native-${documentId}`,
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph" as const,
        text,
        bbox1000: [100, 120, 900, 240] as [number, number, number, number],
        confidence: 1,
        authority: "informal" as const,
      }],
    };
  });
}

/** The validation record the Core sends and the projection now has to read rather than replace. */
const CORE_CHECKS = {
  deterministicMaterialization: true,
  sourceCoverage: true,
  evidenceCoverage: true,
  immutableInputsOnly: true,
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const requiredPaths = [
  "ontology/knowledge.jsonld",
  "ontology/knowledge.ttl",
  "graph/nodes.csv",
  "graph/relationships.csv",
  "rag/documents.jsonl",
  "rag/chunks.jsonl",
  "provenance/activities.jsonl",
  "validation/report.json",
];

async function candidateFixture() {
  const collectionId = "collection-00000000000000000000000000000001";
  const files = await Promise.all(requiredPaths.map(async (path) => {
    const content = path === "validation/report.json"
      ? `${JSON.stringify({ status: "passed", reviewReasons: [] })}\n`
      : `${path}\n`;
    return {
      path,
      mediaType: path.endsWith(".csv") ? "text/csv" : "application/json",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      sha256: await digest(content),
      content,
    };
  }));
  return {
    worldStateId: "ws_candidate_1",
    manifestDigest: sha("a"),
    lifecycle: "candidate" as const,
    canonicalDocuments: [{}],
    canonicalKnowledgeModel: {
      collectionId,
      objects: [
        { stableId: "document-1", kind: "document", payload: { title: "Source one" }, sourceRefs: [{ documentId: "doc-1" }], links: [] },
        { stableId: "evidence-1", kind: "evidence", payload: { evidenceId: "evidence-1" }, sourceRefs: [{ documentId: "doc-1" }], links: [] },
        { stableId: "claim-1", kind: "claim", payload: { text: "Grounded claim" }, sourceRefs: [{ documentId: "doc-1" }], links: ["evidence-1"] },
      ],
    },
    units: [],
    artifactHashes: { "canonical/model": sha("b") },
    directoryPlan: [{ path: "Sources", kind: "root", sourceIds: [] }],
    package: { roots: ["ontology", "graph", "rag", "provenance", "validation"], files, signatureStatus: "external_signer_required" as const },
    validation: { status: "passed", ...CORE_CHECKS },
    diff: {},
    impact: {},
    recompilation: {},
    reviewReasons: [],
  };
}

describe("Python Product-Core v2 dispatch", () => {
  it("uses a dedicated v2 HMAC so the v1 fallback can rotate independently", () => {
    vi.stubEnv("FOUNDATION_CORE_V2_URL", "https://core-v2.example");
    vi.stubEnv("FOUNDATION_CORE_HMAC", "v1-secret-that-must-not-be-reused".repeat(2));
    vi.stubEnv("FOUNDATION_CORE_V2_HMAC", "v2-secret-that-is-independently-rotatable".repeat(2));

    expect(readProductCoreV2Env()).toEqual({
      url: "https://core-v2.example",
      hmac: "v2-secret-that-is-independently-rotatable".repeat(2),
    });
  });

  /*
    D7-03. The request carries the regions the input carried, and no others.

    This assertion used to be the opposite: it required `regions[0].regionId` to contain
    "ocr-full-document" and to have no bbox -- the invented page-1 region the wire synthesised so
    a legacy-OCR document would satisfy the Core's mandatory `regions`. Every citation from such a
    document then pointed at the cover page, and because the bbox was omitted rather than invented
    the UI drew a page with no highlight, which reads as a rendering bug rather than as the
    misattribution it was.
  */
  it("leaves Core-derived identities absent and emits no region the input did not contain", () => {
    const documents = inputs();
    const request = buildProductCoreV2Request("pilot", documents, new Date("2026-08-29T00:00:00Z"), "request-1");

    // The one reading of "absent", imported by both compile paths so they cannot drift again.
    expect(readFileSync(fileURLToPath(new URL("./core-runtime-v2.ts", import.meta.url)), "utf8"))
      .toContain("regions: regionsOrNone(document).map(");
    expect(request.documents[0]).not.toHaveProperty("sourceId");
    expect(request.documents[0]).not.toHaveProperty("sourceVersionId");
    expect(request.documents[0]?.regions).toHaveLength(documents[0].regions?.length ?? 0);
    expect(request.documents.flatMap((document) => document.regions).map((item) => item.regionId))
      .toEqual(documents.flatMap((document) => document.regions ?? []).map((item) => item.regionId));

    // The contract check: given a document with no regions, the wire produces none.
    const empty = buildProductCoreV2Request(
      "pilot",
      documents.map((document) => ({ ...document, regions: [] })),
      new Date("2026-08-29T00:00:00Z"),
      "request-empty",
    );
    expect(empty.documents.flatMap((document) => document.regions)).toEqual([]);
  });

  /*
    The published clause and the production code are checked against each other.

    `compiler-contract.ts` publishes "a document read without regions emits no retrieval unit
    rather than a guessed page or box" as a `demonstrated` clause, on a page a customer reads. It
    was false on the path production uses. Asserting the sentence alone would have passed the
    whole time it was false, so this asserts the sentence *and* the absence of a synthesised
    locator in both compile paths.
  */
  it("publishes the abstention clause only while no compile path fabricates a locator", () => {
    const clause = CONTRACT_CLAUSES.find((item) => item.id === "evidence-preserving")!;
    expect(clause.state).toBe("demonstrated");
    expect(clause.body).toContain("emits no retrieval unit rather than a guessed page or box");

    // Comments quote the defect they describe; the code is what the claim is about.
    const withoutComments = (source: string) => source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    for (const path of ["./core-runtime-v2.ts", "./collection-compiler.ts"]) {
      const source = withoutComments(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
      expect(source, path).not.toContain("ocr-full-document");
      expect(source, path).not.toMatch(/pageNumber1:\s*1\b/);
    }
  });

  it("keeps one idempotency scope across attempts at the same compile", () => {
    const first = buildProductCoreV2Request(
      "pilot",
      inputs(),
      new Date("2026-08-29T00:00:00Z"),
      "request-1",
    );
    const second = buildProductCoreV2Request(
      "pilot",
      inputs(),
      new Date("2026-08-29T00:00:01Z"),
      "request-2",
    );

    /*
      This assertion used to require the opposite: a different key per requestId, which defaults
      to a fresh UUID. That made the key an attempt id, so a retry after a timeout was a compile
      Core had never seen -- a second World and a second charge. The key is the document binding;
      requestId identifies the attempt and is what the receipt binds to.
    */
    expect(first.collectionId).toBe(second.collectionId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.requestId).not.toBe(second.requestId);

    const otherDocuments = buildProductCoreV2Request(
      "pilot-other",
      inputs(),
      new Date("2026-08-29T00:00:00Z"),
      "request-1",
    );
    expect(first.idempotencyKey).not.toBe(otherDocuments.idempotencyKey);
  });

  it("preserves qualified OCR page regions and evidence coordinates", () => {
    const qualified = inputs().map((input) => ({
      ...input,
      regions: [{
        regionId: `native-${input.documentId}`,
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph" as const,
        text: input.text,
        bbox1000: [100, 120, 900, 240] as [number, number, number, number],
        confidence: 1,
        authority: "informal" as const,
      }],
    }));
    const request = buildProductCoreV2Request("pilot", qualified, new Date("2026-08-29T00:00:00Z"), "request-2");

    expect(request.documents[0]?.regions[0]).toEqual(expect.objectContaining({
      bbox1000: [100, 120, 900, 240],
      confidence: 1,
      authority: "informal",
    }));
  });

  it("accepts only a digest-bound legacy-policy candidate receipt", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const envelope = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      const candidate = await candidateFixture();
      return Response.json({
        schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate,
        artifacts: ["cir", "knowledge", "dependency", "retrieval", "candidate"].map((kind, index) => ({
          artifactId: `artifact-${index}`,
          kind,
          contentSha256: sha("c"),
          byteLength: 1,
        })),
        receipt: {
          requestId: envelope.requestId,
          inputSha256: headers.get("x-tavonel-input-sha256"),
          outputSha256: await digest(canonicalize(candidate)),
          coreReleaseDigest: sha("d"),
          matchingPolicy: "legacy",
          candidatePromotion: false,
          equivalence: "not_run",
          totalArtifacts: 5,
          rebuiltArtifacts: 5,
          workAvoidedArtifacts: 0,
        },
      });
    }));

    const result = await dispatchProductCoreV2(
      { url: "https://core-v2.example", hmac: "x".repeat(32) },
      "pilot",
      inputs(),
      new Date("2026-08-29T00:00:00Z"),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.receipt.matchingPolicy).toBe("legacy");
      const projected = projectProductCoreV2Candidate(result.result, inputs());
      expect(projected?.ontology.edges).toContainEqual(expect.objectContaining({ type: "supported_by" }));
      expect(validateDownloadableCollectionArtifact({
        ...projected,
        coreExecution: {
          status: "completed",
          runtime: result.result.runtime,
          receipt: result.result.receipt,
        },
      }, projected?.collectionId ?? "")).not.toBeNull();
    }
  });

  it("fails closed when the candidate output digest is forged", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const envelope = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      const candidate = await candidateFixture();
      return Response.json({
        schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
        status: "completed",
        runtime: "tavonel-python-core-v2",
        candidate,
        artifacts: Array.from({ length: 5 }, (_, index) => ({ artifactId: `artifact-${index}`, kind: "candidate", contentSha256: sha("b"), byteLength: 1 })),
        receipt: { requestId: envelope.requestId, inputSha256: headers.get("x-tavonel-input-sha256"), outputSha256: sha("0"), coreReleaseDigest: sha("d"), matchingPolicy: "legacy", candidatePromotion: false, equivalence: "not_run", totalArtifacts: 5, rebuiltArtifacts: 5, workAvoidedArtifacts: 0 },
      });
    }));

    await expect(dispatchProductCoreV2(
      { url: "https://core-v2.example", hmac: "x".repeat(32) },
      "pilot",
      inputs(),
    )).resolves.toEqual({ ok: false, code: "CORE_V2_RECEIPT_INVALID" });
  });

  it("projects review-required Core output for signed inspection without making it promotable", async () => {
    const baseCandidate = await candidateFixture();
    const reviewReasons = ["CONTRADICTION_CANDIDATE:claim-a:claim-b"];
    const validationContent = `${JSON.stringify({ status: "review_required", reviewReasons })}\n`;
    const candidate = {
      ...baseCandidate,
      lifecycle: "review_required" as const,
      validation: { status: "review_required", ...CORE_CHECKS },
      reviewReasons,
      package: {
        ...baseCandidate.package,
        files: await Promise.all(baseCandidate.package.files.map(async (file) => file.path === "validation/report.json" ? {
          ...file,
          content: validationContent,
          sizeBytes: Buffer.byteLength(validationContent, "utf8"),
          sha256: await digest(validationContent),
        } : file)),
      },
    };
    const result = {
      schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
      status: "review_required" as const,
      runtime: "tavonel-python-core-v2" as const,
      candidate,
      artifacts: [],
      receipt: {
        requestId: "request-review",
        inputSha256: sha("1"),
        outputSha256: sha("2"),
        coreReleaseDigest: sha("3"),
        matchingPolicy: "legacy" as const,
        candidatePromotion: false as const,
        equivalence: "not_run" as const,
        totalArtifacts: 0,
        rebuiltArtifacts: 0,
        workAvoidedArtifacts: 0,
      },
    };

    const projected = projectProductCoreV2Candidate(result, inputs());
    expect(projected).toEqual(expect.objectContaining({
      lifecycle: "review_required",
      reviewReasons: candidate.reviewReasons,
      validation: expect.objectContaining({ status: "review_required" }),
    }));
    const stored = {
      ...projected,
      coreExecution: {
        status: "review_required",
        runtime: result.runtime,
        receipt: result.receipt,
      },
    };
    expect(validateDownloadableCollectionArtifact(stored, projected?.collectionId ?? "")).not.toBeNull();
    expect(validatePromotableCollectionArtifact(stored, projected?.collectionId ?? "")).toBeNull();
  });
});

/*
  D7-05. The Core's verdict survives the projection.

  `projectProductCoreV2Candidate` used to write four `true` literals here and never read
  `result.candidate.validation` at all -- so if the Core had detected incomplete source coverage
  or non-deterministic materialisation, the customer's downloadable package still asserted four
  green checks. The projection was structurally incapable of reporting a Core-detected integrity
  problem; the only signals that survived were the coarse status and the review-reason list.
*/
describe("the Core's validation record is projected rather than replaced", () => {
  async function reviewRequiredResponse(validation: Record<string, unknown>) {
    const baseCandidate = await candidateFixture();
    const reviewReasons = ["SOURCE_COVERAGE_INCOMPLETE"];
    const validationContent = `${JSON.stringify({ status: "review_required", reviewReasons })}\n`;
    return {
      schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
      status: "review_required" as const,
      runtime: "tavonel-python-core-v2" as const,
      candidate: {
        ...baseCandidate,
        lifecycle: "review_required" as const,
        validation,
        reviewReasons,
        package: {
          ...baseCandidate.package,
          files: await Promise.all(baseCandidate.package.files.map(async (file) => file.path === "validation/report.json" ? {
            ...file,
            content: validationContent,
            sizeBytes: Buffer.byteLength(validationContent, "utf8"),
            sha256: await digest(validationContent),
          } : file)),
        },
      },
      artifacts: [],
      receipt: {
        requestId: "request-projection",
        inputSha256: sha("1"),
        outputSha256: sha("2"),
        coreReleaseDigest: sha("3"),
        matchingPolicy: "legacy" as const,
        candidatePromotion: false as const,
        equivalence: "not_run" as const,
        totalArtifacts: 0,
        rebuiltArtifacts: 0,
        workAvoidedArtifacts: 0,
      },
    };
  }

  it("carries a false check through to the artifact and refuses to promote it", async () => {
    const result = await reviewRequiredResponse({ status: "review_required", ...CORE_CHECKS, sourceCoverage: false });
    const projected = projectProductCoreV2Candidate(result, inputs());

    expect(projected?.validation.sourceCoverage).toBe(false);
    expect(projected?.validation.evidenceCoverage).toBe(true);
    const stored = {
      ...projected,
      coreExecution: { status: "review_required", runtime: result.runtime, receipt: result.receipt },
    };
    expect(validatePromotableCollectionArtifact(stored, projected?.collectionId ?? "")).toBeNull();
  });

  it("refuses the projection when a check is missing instead of defaulting it true", async () => {
    const { evidenceCoverage: _absent, ...incomplete } = CORE_CHECKS;
    const result = await reviewRequiredResponse({ status: "review_required", ...incomplete });
    expect(projectProductCoreV2Candidate(result, inputs())).toBeNull();
  });

  it("refuses the projection when a check is not a boolean", async () => {
    const result = await reviewRequiredResponse({ status: "review_required", ...CORE_CHECKS, evidenceCoverage: "true" });
    expect(projectProductCoreV2Candidate(result, inputs())).toBeNull();
  });

  it("refuses a completed compile whose own record says a check failed", async () => {
    const base = await reviewRequiredResponse({ status: "passed", ...CORE_CHECKS, evidenceCoverage: false });
    const contradictory = {
      ...base,
      status: "completed" as const,
      candidate: { ...base.candidate, lifecycle: "candidate" as const, reviewReasons: [] },
    };
    expect(projectProductCoreV2Candidate(contradictory, inputs())).toBeNull();
  });
});

/*
  R3-K09. The relation and contradiction objects the Core computes now reach the artifact.

  `compiler.py` builds a KnowledgeObjectKind.RELATION object per claim-to-entity mention and a
  VALIDATION_RECORD per contradiction candidate, both with evidence-bound source refs, and this
  projection filtered every object whose kind was not one of four into nothing. Concretely
  computed, evidence-bound data was discarded between the Core and the customer's World, its
  exports and its retrieval index -- the same class of defect as the four `true` literals above,
  found a second time. The fixture is built from the shapes in
  `packages/product-core/src/akc_product_core/{compiler,semantics}.py`:
  `SemanticRelation.as_record()` carries predicate and evidenceId,
  `ContradictionCandidate.as_record()` carries reason and claimIds, and an evidence object's
  `payload.evidenceId` is a different string from its own `stableId` -- which is why the two
  differ here rather than being the same convenient literal.
*/
describe("Core-computed relations and contradictions survive the projection", () => {
  const COLLECTION = "collection-00000000000000000000000000000001";
  const CONTRADICTION = "contradiction-1";

  function object(kind: string, stableId: string, links: string[], payload: Record<string, unknown>) {
    return { stableId, kind, payload, sourceRefs: [{ documentId: "doc-1" }], links };
  }

  const SEMANTIC_OBJECTS = [
    object("document", "document-1", [], { title: "Source one" }),
    object("evidence", "evidence-1", [], { evidenceId: "ev-1" }),
    object("evidence", "evidence-2", [], { evidenceId: "ev-2" }),
    object("claim", "claim-1", ["evidence-1", "entity-1"], { text: "The pump ran at 42 bar." }),
    object("claim", "claim-2", ["evidence-2", "entity-1"], { text: "The pump ran at 51 bar." }),
    object("entity", "entity-1", [], { canonicalName: "Feedwater Pump 200" }),
    object("relation", "relation-object-1", ["claim-1", "entity-1"], {
      relationId: "relation-object-1",
      subjectId: "claim-1",
      predicate: "mentions",
      objectId: "entity-1",
      evidenceId: "ev-1",
    }),
    object("validation_record", CONTRADICTION, ["claim-1", "claim-2"], {
      contradictionId: CONTRADICTION,
      claimIds: ["claim-1", "claim-2"],
      reason: "numeric_disagreement",
      topicKey: "pump",
      temporalRefs: [],
      adjudication: "human_review_required",
    }),
    // Kinds the Core emits that this artifact shape has no place for: skipped, never refused.
    object("block", "block-1", [], { text: "The pump ran at 42 bar.", blockType: "paragraph" }),
    object("ontology_term", "ontology-term-1", [], { term: "Equipment" }),
  ];

  async function response(objects: unknown[], reviewReasons = [`CONTRADICTION_CANDIDATE:${CONTRADICTION}`]) {
    const base = await candidateFixture();
    const validationContent = `${JSON.stringify({ status: "review_required", reviewReasons })}\n`;
    return {
      schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
      status: "review_required" as const,
      runtime: "tavonel-python-core-v2" as const,
      candidate: {
        ...base,
        lifecycle: "review_required" as const,
        canonicalKnowledgeModel: { collectionId: COLLECTION, objects },
        validation: { status: "review_required", ...CORE_CHECKS },
        reviewReasons,
        package: {
          ...base.package,
          files: await Promise.all(base.package.files.map(async (file) => file.path === "validation/report.json" ? {
            ...file,
            content: validationContent,
            sizeBytes: Buffer.byteLength(validationContent, "utf8"),
            sha256: await digest(validationContent),
          } : file)),
        },
      },
      artifacts: [],
      receipt: {
        requestId: "request-semantics",
        inputSha256: sha("1"),
        outputSha256: sha("2"),
        coreReleaseDigest: sha("3"),
        matchingPolicy: "legacy" as const,
        candidatePromotion: false as const,
        equivalence: "not_run" as const,
        totalArtifacts: 0,
        rebuiltArtifacts: 0,
        workAvoidedArtifacts: 0,
      },
    };
  }

  it("emits a mentions edge and a contradicts edge, each carrying its own evidence", async () => {
    const projected = projectProductCoreV2Candidate(await response(SEMANTIC_OBJECTS), inputs());

    expect(projected).not.toBeNull();
    expect(projected!.ontology.edges).toContainEqual({
      id: expect.stringMatching(/^relation-[0-9a-f]{32}$/),
      type: "mentions",
      from: "claim-1",
      to: "entity-1",
      // The relation's own evidence ref, in the namespace the supported_by edges already use.
      evidenceIds: ["ev-1"],
    });
    expect(projected!.ontology.edges).toContainEqual({
      id: expect.stringMatching(/^relation-[0-9a-f]{32}$/),
      type: "contradicts",
      from: "claim-1",
      to: "claim-2",
      evidenceIds: ["ev-1", "ev-2"],
      reason: "numeric_disagreement",
    });
    // The supported_by edges this projection already emitted are unchanged.
    expect(projected!.ontology.edges.filter((edge) => edge.type === "supported_by")).toHaveLength(2);
    // A contradiction that reached the graph also reached review, and is counted separately.
    expect(projected!.reviewReasons).toContain(`CONTRADICTION_CANDIDATE:${CONTRADICTION}`);
    expect(projected!.validation.reviewReasons).toContain(`CONTRADICTION_CANDIDATE:${CONTRADICTION}`);
    expect(projected!.validation.counts.contradictions).toBe(1);
    expect(projected!.lifecycle).toBe("review_required");
    // Block and ontology_term are not nodes, and their absence is a decision, not a refusal.
    expect(projected!.ontology.nodes.map((node) => node.id).sort())
      .toEqual(["claim-1", "claim-2", "document-1", "entity-1", "evidence-1", "evidence-2"]);

    const stored = {
      ...projected,
      coreExecution: {
        status: "review_required",
        runtime: "tavonel-python-core-v2",
        receipt: { requestId: "request-semantics", outputSha256: sha("2"), candidatePromotion: false },
      },
    };
    expect(validateDownloadableCollectionArtifact(stored, COLLECTION)).not.toBeNull();
  });

  /*
    K01. The artifact advertises the predicates it contains, and nothing else.

    `GENERIC_MIXED_CORPUS_BLUEPRINT.ontologyRelations` was attached verbatim to Core V2
    candidates, so an artifact from an engine with no Topic object anywhere in its model
    advertised `discusses_topic` in its own blueprint metadata -- a capability claim the compile
    that produced it could not keep.
  */
  it("advertises exactly the predicates the compile emitted", async () => {
    const projected = projectProductCoreV2Candidate(await response(SEMANTIC_OBJECTS), inputs());

    expect(projected!.blueprint.ontologyRelations).toEqual(["contradicts", "mentions", "supported_by"]);
    expect(projected!.blueprint.ontologyRelations)
      .toEqual(advertisedOntologyRelations(projected!.ontology.edges));
    expect(projected!.blueprint.ontologyRelations, "the live engine has no Topic object at all")
      .not.toContain("discusses_topic");
    expect(projected!.blueprint.id).toBe(GENERIC_MIXED_CORPUS_BLUEPRINT.id);

    /*
      And the other half of the same inconsistency, which the blueprint fix leaves standing on its
      own: `counts.topics` is a hard-coded 0. That is the true count today -- the projection emits
      no Topic node and drops the Core ontology terms -- but a literal cannot notice the day it
      stops being true, and the pair (blueprint implies topics / count says none) is exactly what
      the evidence lane flagged. Tied to the projection here, so either half moving fails.
    */
    expect(projected!.validation.counts.topics, "counts.topics is a literal; keep it honest").toBe(0);
    expect(projected!.ontology.nodes.some((node) => node.kind === "Topic"))
      .toBe(projected!.validation.counts.topics > 0);
  });

  it("refuses an object kind it has never been taught instead of dropping it", async () => {
    const invented = [...SEMANTIC_OBJECTS, object("statement", "statement-1", [], { text: "invented" })];
    expect(projectProductCoreV2Candidate(await response(invented), inputs())).toBeNull();
  });

  it("refuses a relation whose endpoint or evidence does not resolve", async () => {
    const dangling = SEMANTIC_OBJECTS.map((item) => item.stableId === "relation-object-1"
      ? object("relation", "relation-object-1", ["claim-1", "entity-missing"], { predicate: "mentions", evidenceId: "ev-1" })
      : item);
    expect(projectProductCoreV2Candidate(await response(dangling), inputs())).toBeNull();

    const unknownEvidence = SEMANTIC_OBJECTS.map((item) => item.stableId === "relation-object-1"
      ? object("relation", "relation-object-1", ["claim-1", "entity-1"], { predicate: "mentions", evidenceId: "ev-nowhere" })
      : item);
    expect(projectProductCoreV2Candidate(await response(unknownEvidence), inputs())).toBeNull();
  });

  it("refuses a predicate the Core is not known to emit rather than publishing it as a capability", async () => {
    const invented = SEMANTIC_OBJECTS.map((item) => item.stableId === "relation-object-1"
      ? object("relation", "relation-object-1", ["claim-1", "entity-1"], { predicate: "supersedes", evidenceId: "ev-1" })
      : item);
    expect(projectProductCoreV2Candidate(await response(invented), inputs())).toBeNull();
  });

  it("refuses a contradiction that never reached review, and one with no reason", async () => {
    expect(projectProductCoreV2Candidate(await response(SEMANTIC_OBJECTS, ["SEMANTIC_CLAIMS_EMPTY"]), inputs()))
      .toBeNull();

    const reasonless = SEMANTIC_OBJECTS.map((item) => item.stableId === CONTRADICTION
      ? object("validation_record", CONTRADICTION, ["claim-1", "claim-2"], { claimIds: ["claim-1", "claim-2"] })
      : item);
    expect(projectProductCoreV2Candidate(await response(reasonless), inputs())).toBeNull();
  });
});

/*
  TM01. The revision-compile wire, and the flag that keeps it off.

  `operationClass` was the literal "initial_compile" on every call and `previousActiveWorld` was
  never populated, so `plan_recompilation` and `verify_equivalence` -- both present and
  unit-tested in `akc_cir`, both branched on in `compiler.py` -- were never executed in
  production and `receipt.equivalence` was always "not_run". What these tests pin is the wire:
  the non-initial literal `contracts.py` accepts, the pairing rule it enforces, and the
  idempotency key, which has to change with the prior World or the Core answers
  CORE_IDEMPOTENCY_CONFLICT to every revision compile of a binding it has already seen.
*/
describe("the revision-compile request", () => {
  const snapshot = {
    worldStateId: "ws_previous_1",
    manifestDigest: sha("e"),
    artifactHashes: { "canonical/model": sha("f") },
    units: [{
      logicalId: "unit-1",
      sourceId: "src-1",
      sourceVersionId: "srcv-1",
      sourceContentSha256: sha("a"),
      text: "The pump ran at 42 bar.",
      documentPath: ["Sources", "doc-1"],
      anchor: "doc-1#p1",
      neighbourAnchors: [],
      evidenceId: "ev-1",
      pageNumber1: 1,
      authority: "informal",
      identityState: "matched",
    }],
  };

  it("asks for an initial compile with no previous world by default", () => {
    const request = buildProductCoreV2Request("pilot", inputs(), new Date("2026-09-11T00:00:00Z"), "request-initial");

    expect(request.route.operationClass).toBe("initial_compile");
    expect(request).not.toHaveProperty("previousActiveWorld");
  });

  it("sends the non-initial operation class contracts.py requires, with the prior world beside it", () => {
    const initial = buildProductCoreV2Request("pilot", inputs(), new Date("2026-09-11T00:00:00Z"), "request-initial");
    const revision = buildProductCoreV2Request("pilot", inputs(), new Date("2026-09-11T00:00:00Z"), "request-revision", snapshot);

    expect(revision.route.operationClass).toBe("incremental_recompile");
    expect(revision.previousActiveWorld).toEqual(snapshot);
    // Same documents, so the same collection: a revision of this World, not a second one.
    expect(revision.collectionId).toBe(initial.collectionId);
    /*
      And a different idempotency key, which is not cosmetic. The Core caches on
      (tenant, workspace, idempotencyKey) and returns CORE_IDEMPOTENCY_CONFLICT when a cached
      entry's inputSha256 differs (api.py), so a revision compile that reused the initial
      compile's key would be refused every time.
    */
    expect(revision.idempotencyKey).not.toBe(initial.idempotencyKey);
  });

  it("reads a prior snapshot back only when it is complete and bound to the active world", () => {
    const stored = { revisionCompile: snapshot };
    const active = { worldStateId: snapshot.worldStateId, manifestDigest: snapshot.manifestDigest };

    expect(readRevisionCompileSnapshot(stored, active)).toEqual(snapshot);
    // A candidate stored before the flag existed carries no snapshot: not usable, not invented.
    expect(readRevisionCompileSnapshot({}, active)).toBeNull();
    expect(readRevisionCompileSnapshot({ revisionCompile: { ...snapshot, units: [] } }, active)).toBeNull();
    expect(readRevisionCompileSnapshot(stored, { ...active, manifestDigest: sha("0") })).toBeNull();
    expect(readRevisionCompileSnapshot(
      { revisionCompile: { ...snapshot, units: [{ ...snapshot.units[0], anchor: undefined }] } },
      active,
    )).toBeNull();
    expect(readRevisionCompileSnapshot(
      { revisionCompile: { ...snapshot, artifactHashes: { "canonical/model": "not-a-digest" } } },
      active,
    )).toBeNull();
    // `PreviousUnit` declares both of these as tuples of strings, so the elements are checked.
    expect(readRevisionCompileSnapshot(
      { revisionCompile: { ...snapshot, units: [{ ...snapshot.units[0], documentPath: ["Sources", 7] }] } },
      active,
    )).toBeNull();
    expect(readRevisionCompileSnapshot(
      { revisionCompile: { ...snapshot, units: [{ ...snapshot.units[0], neighbourAnchors: [null] }] } },
      active,
    )).toBeNull();
    // Absent is legal: the contract gives `neighbourAnchors` a default.
    const { neighbourAnchors: _dropped, ...withoutAnchors } = snapshot.units[0];
    expect(readRevisionCompileSnapshot(
      { revisionCompile: { ...snapshot, units: [withoutAnchors] } },
      active,
    )).toEqual({ ...snapshot, units: [withoutAnchors] });
  });

  it("persists the Core's units only when the flag asked it to", async () => {
    const base = await candidateFixture();
    const result = {
      schemaVersion: PRODUCT_CORE_RESPONSE_SCHEMA,
      status: "completed" as const,
      runtime: "tavonel-python-core-v2" as const,
      candidate: { ...base, units: snapshot.units },
      artifacts: [],
      receipt: {
        requestId: "request-units",
        inputSha256: sha("1"),
        outputSha256: sha("2"),
        coreReleaseDigest: sha("3"),
        matchingPolicy: "legacy" as const,
        candidatePromotion: false as const,
        equivalence: "not_run" as const,
        totalArtifacts: 1,
        rebuiltArtifacts: 1,
        workAvoidedArtifacts: 0,
      },
    };

    // The flag is off: the artifact is exactly what it is today, with no extra copy of the text.
    expect(projectProductCoreV2Candidate(result, inputs())).not.toHaveProperty("revisionCompile");
    expect(projectProductCoreV2Candidate(result, inputs(), true)?.revisionCompile).toEqual({
      worldStateId: base.worldStateId,
      manifestDigest: base.manifestDigest,
      artifactHashes: base.artifactHashes,
      units: snapshot.units,
    });
  });

  it("is off unless the flag is exactly 1", () => {
    expect(revisionCompileEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(revisionCompileEnabled({ NODE_ENV: "test", [CORE_V2_REVISION_COMPILE_FLAG]: "0" })).toBe(false);
    expect(revisionCompileEnabled({ NODE_ENV: "test", [CORE_V2_REVISION_COMPILE_FLAG]: "true" })).toBe(false);
    expect(revisionCompileEnabled({ NODE_ENV: "test", [CORE_V2_REVISION_COMPILE_FLAG]: "1" })).toBe(true);
  });
});

/*
  The three clauses this lane owns, against what the code now does.

  Clause 03 graded DEMONSTRATED while naming three predicates, which was true of the fallback
  and wrong about the engine production runs -- and R3-K09 is why: the live engine's two extra
  predicates were computed and thrown away, so the clause described the artifact accurately by
  accident. Now that they reach the artifact the clause has to name them. Clauses 05 and 06 stay
  DIRECTION: the revision-compile wire exists and is off, and a switch nobody has thrown is not
  a shipped capability.
*/
describe("the compiler contract clauses this projection has to keep", () => {
  it("names the predicates the live engine emits, not only the fallback's three", () => {
    const body = clause("typed-dependencies").body;
    for (const predicate of ["discusses_topic", "mentions_entity", "supported_by", "mentions", "contradicts"]) {
      expect(body, `clause 03 does not name the emitted predicate ${predicate}`).toContain(predicate);
    }
    // The two engines are told apart, because they do not emit the same set.
    expect(body).toContain("Core V2");
    // And the emitted set is computed rather than asserted, which is what makes the clause hold.
    expect(read("./core-runtime-v2.ts")).toContain("advertisedOntologyRelations(edges)");
  });

  it("keeps selective recompilation and equivalence out of the shipped column while the flag is off", () => {
    expect(clause("selective-recompilation").state).toBe("direction");
    expect(clause("full-rebuild-equivalence").state).toBe("direction");
    // The clause may say the gate is written; it may not say a compile here is gated by it.
    expect(clause("full-rebuild-equivalence").body).toContain("not_run");
    expect(clause("selective-recompilation").body).toContain(CORE_V2_REVISION_COMPILE_FLAG);
  });
});
