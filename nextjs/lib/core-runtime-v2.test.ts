import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionOcrInput } from "./collection-compiler";
import { validateDownloadableCollectionArtifact, validatePromotableCollectionArtifact } from "./collection-download";
import { CONTRACT_CLAUSES } from "./compiler-contract";
import {
  PRODUCT_CORE_RESPONSE_SCHEMA,
  buildProductCoreV2Request,
  dispatchProductCoreV2,
  projectProductCoreV2Candidate,
  readProductCoreV2Env,
} from "./core-runtime-v2";

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
