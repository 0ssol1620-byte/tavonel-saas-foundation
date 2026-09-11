import { createHash, createHmac, randomUUID } from "node:crypto";
import { readCompiledWorldValidationChecks, regionsOrNone } from "../../shared/compiledWorldValidation";
import {
  GENERIC_MIXED_CORPUS_BLUEPRINT,
  advertisedOntologyRelations,
  type CollectionCandidateArtifact,
  type CollectionOcrInput,
  type CoreKnowledgeEdge,
  type RevisionCompileSnapshot,
} from "./collection-compiler";
import { CORE_CLIENT_TIMEOUT_MS, CORE_MAX_LATENCY_MS } from "./execution-budget";

export const PRODUCT_CORE_REQUEST_SCHEMA = "tavonel.product_core.compile_request.v2" as const;
export const PRODUCT_CORE_RESPONSE_SCHEMA = "tavonel.product_core.compile_response.v2" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/**
 * The env flag that turns a re-compile of an already-active collection into a revision compile.
 *
 * Off by default, and deliberately: the wire contract on this side is written against
 * `packages/product-core/src/akc_product_core/contracts.py` as it stands in the
 * `codex/tavonel-p0p2-productization` worktree, and nothing here verifies that the *deployed*
 * lambda is built from that revision. Sending `operationClass: "incremental_recompile"` to a
 * Core that does not accept it is a refused compile, not a wrong World -- but it is still a
 * refusal a customer would see, so the switch is an operator's to throw after the checks in
 * `CA_LANE_REPORT_knowledge.md` pass.
 */
export const CORE_V2_REVISION_COMPILE_FLAG = "TAVONEL_CORE_V2_REVISION_COMPILE" as const;

export function revisionCompileEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env[CORE_V2_REVISION_COMPILE_FLAG] === "1";
}

export type ProductCoreV2Env = {
  url: string;
  hmac: string;
};

export type ProductCoreV2CompileRequest = {
  schemaVersion: typeof PRODUCT_CORE_REQUEST_SCHEMA;
  requestId: string;
  idempotencyKey: string;
  tenantId: string;
  workspaceId: string;
  collectionId: string;
  requestedAt: string;
  route: {
    /*
      The two literals `contracts.py` accepts for this caller, and the rule that binds them.

      `ProductCoreCompileRequest.validate_scope_and_operation` refuses an `initial_compile`
      that carries a previous world *and* a non-initial class that does not, so the pairing is
      not a convention here -- it is the wire's own invariant. `verification_oracle` is the
      third literal the contract allows and is not sent from this caller.
    */
    operationClass: "initial_compile" | "incremental_recompile";
    qualityRequirement: "high_assurance";
    maxCostCredits: number;
    maxLatencyMs: number;
    privacyPolicy: "foundation_synthetic_only";
  };
  documents: Array<{
    nativeId: string;
    connectorType: "foundation-r2";
    immutableObjectKey: string;
    ocrObjectKey: string;
    contentSha256: string;
    title: string;
    sourceFilename: string;
    pageCount: number;
    regions: Array<{
      regionId: string;
      pageIndex0: number;
      pageNumber1: number;
      order: number;
      blockType: "paragraph";
      text: string;
      bbox1000?: [number, number, number, number];
      confidence?: number;
      authority: "unclassified" | "unknown" | "informal" | "official" | "contractual";
    }>;
  }>;
  /** `PreviousWorldSnapshot` in contracts.py. Required by a non-initial operation class. */
  previousActiveWorld?: {
    worldStateId: string;
    manifestDigest: string;
    units: Array<Record<string, unknown>>;
    artifactHashes: Record<string, string>;
  };
};

type ProductCoreV2Candidate = {
  worldStateId: string;
  parentWorldStateId?: string;
  manifestDigest: string;
  lifecycle: "candidate" | "review_required" | "rejected";
  canonicalDocuments: unknown[];
  canonicalKnowledgeModel: Record<string, unknown>;
  units: unknown[];
  artifactHashes: Record<string, string>;
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  package: {
    roots: string[];
    files: Array<{
      path: string;
      mediaType: string;
      sizeBytes: number;
      sha256: string;
      content: string;
    }>;
    signatureStatus: "external_signer_required";
  };
  validation: Record<string, unknown>;
  diff: Record<string, unknown>;
  impact: Record<string, unknown>;
  recompilation: Record<string, unknown>;
  reviewReasons: string[];
};

export type ProductCoreV2CompileResponse = {
  schemaVersion: typeof PRODUCT_CORE_RESPONSE_SCHEMA;
  status: "completed" | "review_required" | "rejected";
  runtime: "tavonel-python-core-v2";
  candidate: ProductCoreV2Candidate;
  artifacts: Array<{
    artifactId: string;
    kind: string;
    contentSha256: string;
    byteLength: number;
  }>;
  receipt: {
    requestId: string;
    inputSha256: string;
    outputSha256: string;
    coreReleaseDigest: string;
    matchingPolicy: "legacy";
    candidatePromotion: false;
    equivalence: "passed" | "failed" | "not_run";
    totalArtifacts: number;
    rebuiltArtifacts: number;
    workAvoidedArtifacts: number;
  };
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function readProductCoreV2Env(): ProductCoreV2Env | null {
  const url = process.env.FOUNDATION_CORE_V2_URL?.trim() ?? "";
  const hmac = process.env.FOUNDATION_CORE_V2_HMAC ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(url) || hmac.length < 32) return null;
  return { url: url.replace(/\/$/, ""), hmac };
}

function documentBinding(workspaceId: string, documents: CollectionOcrInput[]) {
  const binding = [...documents]
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .map((document) => `${document.documentId}:${document.versionKey}`)
    .join("\n");
  return `${workspaceId}\n${binding}`;
}

/**
 * The collection id this document set compiles under, derived the one way the request derives it.
 *
 * Exported so `collection-compile-run.ts` can look up the active World under the same id the
 * dispatch will send, instead of a second derivation that can drift from it.
 *
 * Worth knowing before reading TM01: this id is a hash of the document/version binding, so a
 * source revision produces a *different* collection id and therefore finds no prior active
 * World. A revision compile is reachable here only for a re-compile of an identical binding.
 * Carrying a collection's identity across a source revision needs a stable collection key that
 * this wire does not have, and that gap is written up in the lane report rather than papered
 * over with a looser lookup.
 */
export function productCoreV2CollectionId(workspaceId: string, documents: CollectionOcrInput[]) {
  return `collection-${sha256(documentBinding(workspaceId, documents)).slice(0, 32)}`;
}

export function buildProductCoreV2Request(
  workspaceId: string,
  documents: CollectionOcrInput[],
  now = new Date(),
  requestId = `core-${randomUUID()}`,
  previousActiveWorld: ProductCoreV2CompileRequest["previousActiveWorld"] | null = null,
): ProductCoreV2CompileRequest {
  const binding = documentBinding(workspaceId, documents);
  const collectionId = productCoreV2CollectionId(workspaceId, documents);
  return {
    schemaVersion: PRODUCT_CORE_REQUEST_SCHEMA,
    requestId,
    /*
      The identity of the work, not of the attempt.

      This used to hash `requestId` as well, and `requestId` defaults to a fresh UUID -- so every
      call carried a different idempotency key and a retry after a timeout was, to Core, a compile
      it had never seen. That is a second World and a second charge for the one the caller could
      not confirm, which is exactly what an idempotency key exists to prevent. The attempt is
      still identified, by `requestId`, which is what the receipt binds to.

      The prior World joins the key when there is one, and that is not a nicety. The Core caches
      on (tenant, workspace, idempotencyKey) and answers CORE_IDEMPOTENCY_CONFLICT when a cached
      entry's `inputSha256` differs (api.py) -- so a revision compile of a binding that was
      already compiled from scratch carries the same key, a different body, and would be
      refused. A revision compile *from a named prior World* is different work than the initial
      compile of the same documents, and the key now says so.
    */
    idempotencyKey: `compile-${sha256(
      previousActiveWorld ? `${binding}\n${previousActiveWorld.manifestDigest}` : binding,
    ).slice(0, 40)}`,
    tenantId: workspaceId,
    workspaceId,
    collectionId,
    requestedAt: now.toISOString(),
    route: {
      operationClass: previousActiveWorld ? "incremental_recompile" : "initial_compile",
      qualityRequirement: "high_assurance",
      maxCostCredits: 10,
      // Never more than this process will wait; see lib/execution-budget.ts.
      maxLatencyMs: CORE_MAX_LATENCY_MS,
      privacyPolicy: "foundation_synthetic_only",
    },
    documents: [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((document) => ({
        nativeId: document.documentId,
        connectorType: "foundation-r2" as const,
        immutableObjectKey: document.sourceImmutableKey,
        ocrObjectKey: document.ocrJsonKey,
        contentSha256: document.inputSha256,
        title: `Document ${document.documentId.slice(0, 8)}`,
        sourceFilename: `${document.documentId}.pdf`,
        pageCount: document.pageCount,
        /*
          Regions are copied, never conjured.

          This used to end in `?? [{ regionId: "ocr-full-document-…", pageNumber1: 1, text:
          <the whole document> }]` -- a region the input did not contain, invented so a
          legacy-OCR document would satisfy the Core's "at least one region" schema. Every
          citation from such a document then pointed at page 1, and the customer who followed
          one landed on the cover page and found the fact was not there. `regionsOrNone` is the
          one reading of "absent" both compile paths take, and the compile is refused before
          dispatch anyway (OCR_REGIONS_REQUIRED in collection-compile-run.ts).
        */
        regions: regionsOrNone(document).map((region) => ({
          regionId: region.regionId,
          pageIndex0: region.pageIndex0,
          pageNumber1: region.pageNumber1,
          order: region.order,
          blockType: region.blockType,
          text: region.text,
          bbox1000: region.bbox1000,
          confidence: region.confidence,
          authority: region.authority,
        })),
      })),
    ...(previousActiveWorld ? { previousActiveWorld } : {}),
  };
}

function validCandidate(value: unknown): value is ProductCoreV2Candidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ProductCoreV2Candidate;
  return (
    IDENTIFIER.test(candidate.worldStateId) &&
    SHA256.test(candidate.manifestDigest) &&
    ["candidate", "review_required", "rejected"].includes(candidate.lifecycle) &&
    Array.isArray(candidate.canonicalDocuments) &&
    Boolean(candidate.canonicalKnowledgeModel) &&
    Array.isArray(candidate.units) &&
    Object.values(candidate.artifactHashes ?? {}).every((digest) => SHA256.test(digest)) &&
    Array.isArray(candidate.directoryPlan) &&
    Array.isArray(candidate.package?.files) &&
    Array.isArray(candidate.reviewReasons)
  );
}

/*
  Every kind `akc_cir.knowledge_model.KnowledgeObjectKind` defines, sorted into what the
  projection does with it. There is no "everything else" bucket on purpose.

  Four kinds become nodes and two become edges. The rest are kinds the Core can emit that this
  artifact shape has no place for -- `block` is the region a claim was read from and reaches the
  customer through the retrieval chunk instead, `ontology_term` is the blueprint vocabulary.
  Naming them is what makes the difference between "not projected, deliberately" and "dropped
  because nobody looked": a kind outside this list refuses the whole projection
  (CORE_V2_PROJECTION_INVALID) rather than disappearing, so the day the Core grows an object
  type the compile stops instead of quietly shipping a World missing part of the model. That is
  the same defect R3-K09 found for `relation` and `validation_record`, which were silently
  filtered out here while the Core computed them with full evidence bindings.
*/
const NODE_KIND_NAME = { document: "Document", entity: "Entity", claim: "Claim", evidence: "Evidence" } as const;
const EDGE_KINDS = new Set(["relation", "validation_record"]);
const NOT_PROJECTED_KINDS = new Set([
  "collection", "document_version", "page", "region", "block", "table", "figure", "note",
  "asset", "ontology_term", "export_artifact",
]);

/*
  The relation predicates this projection accepts, read off the Core rather than trusted.

  `SemanticRelation.predicate` is `Literal["mentions"]` in semantics.py -- one predicate, the
  claim-to-entity mention. An unrecognised predicate is refused rather than passed through as an
  edge type nobody has looked at: a predicate name is not evidence that the thing it names was
  read, and `advertisedOntologyRelations` publishes whatever lands here as a capability of the
  artifact. Adding a predicate is one line, next to the Core change that starts emitting it.
*/
const CORE_RELATION_PREDICATES = new Set(["mentions"]);
const CONTRADICTION_REASONS = new Set(["numeric_disagreement", "polarity_disagreement"]);

export function projectProductCoreV2Candidate(
  result: ProductCoreV2CompileResponse,
  documents: CollectionOcrInput[],
  /*
    Whether to persist the snapshot a later revision compile would need (TM01).

    A parameter rather than a `process.env` read inside a pure projection, so the test says
    which behaviour it is asserting. With it false -- the default, and what the production
    route passes while `TAVONEL_CORE_V2_REVISION_COMPILE` is unset -- the artifact is exactly
    what it is today.
  */
  keepRevisionSnapshot = false,
): CollectionCandidateArtifact | null {
  if (result.status === "rejected" || result.candidate.lifecycle === "rejected") return null;
  if (
    (result.status === "completed" && result.candidate.lifecycle !== "candidate") ||
    (result.status === "review_required" && result.candidate.lifecycle !== "review_required")
  ) return null;
  /*
    The Core is the authority on integrity, so its verdict is read rather than replaced.

    This function used to write four `true` literals here and never touch
    `result.candidate.validation` at all. If the Core had detected incomplete source coverage or
    non-deterministic materialisation, the customer's downloadable package still asserted four
    green checks -- the projection was structurally incapable of reporting a Core-detected
    problem. A missing or non-boolean field is a refusal (`CORE_V2_PROJECTION_INVALID` at
    collection-compile-run.ts), never a default: an unreported check and a passed one must not
    look the same.
  */
  const coreChecks = readCompiledWorldValidationChecks(result.candidate.validation);
  if (!coreChecks) return null;
  /*
    A completed compile whose own record says a check failed contradicts itself, and the site is
    not the place to decide which half to believe. Refusing keeps `passed` meaning passed: the
    alternative is an artifact the promote gate accepts because its status says `passed` while a
    boolean beside it says the source was not fully covered.
  */
  if (result.status === "completed" && Object.values(coreChecks).some((check) => !check)) return null;
  const model = result.candidate.canonicalKnowledgeModel;
  const collectionId = typeof model.collectionId === "string" ? model.collectionId : "";
  const objects = Array.isArray(model.objects) ? model.objects as Array<Record<string, unknown>> : [];
  if (!IDENTIFIER.test(collectionId) || objects.length === 0) return null;
  /*
    An object whose kind this projection has never been taught refuses the compile.

    It used to be a `filter`, so `relation` and `validation_record` -- the claim-to-entity
    mentions and the contradiction candidates, both computed with evidence bindings -- left the
    Core and reached nothing. A filter cannot tell "we chose not to project this" from "we have
    never heard of this", and only the first of those is safe to do in silence.
  */
  if (objects.some((item) =>
    typeof item.kind !== "string" ||
    !(Object.hasOwn(NODE_KIND_NAME, item.kind) || EDGE_KINDS.has(item.kind) || NOT_PROJECTED_KINDS.has(item.kind))
  )) return null;
  const nodes = objects
    .filter((item) => Object.hasOwn(NODE_KIND_NAME, item.kind as string))
    .map((item) => {
      const kind = item.kind as keyof typeof NODE_KIND_NAME;
      const payload = item.payload && typeof item.payload === "object" ? item.payload as Record<string, unknown> : {};
      const refs = Array.isArray(item.sourceRefs) ? item.sourceRefs as Array<Record<string, unknown>> : [];
      const documentId = typeof refs[0]?.documentId === "string" ? refs[0].documentId : undefined;
      return {
        id: String(item.stableId),
        kind: NODE_KIND_NAME[kind],
        label: String(payload.title ?? payload.text ?? payload.evidenceId ?? item.stableId),
        ...(documentId ? { documentId } : {}),
        evidenceIds: kind === "evidence" ? [String(payload.evidenceId ?? item.stableId)] : [],
      };
    });
  const nodeKindById = new Map(nodes.map((node) => [node.id, node.kind]));
  const evidenceByObject = new Map(
    objects
      .filter((item) => item.kind === "evidence")
      .map((item) => [String(item.stableId), String((item.payload as Record<string, unknown>)?.evidenceId ?? item.stableId)]),
  );
  const edges: Array<CollectionCandidateArtifact["ontology"]["edges"][number]> = objects
    .filter((item) => item.kind === "claim" && Array.isArray(item.links))
    .flatMap((item) => (item.links as unknown[])
      .filter((link) => evidenceByObject.has(String(link)))
      .map((link) => ({
        id: `relation-${sha256(`${String(item.stableId)}\nsupported_by\n${String(link)}`).slice(0, 32)}`,
        type: "supported_by" as const,
        from: String(item.stableId),
        to: String(link),
        evidenceIds: [evidenceByObject.get(String(link))!],
      })));
  /** The evidence ids each claim reaches, so a contradiction can name the pages it rests on. */
  const claimEvidence = new Map(
    objects
      .filter((item) => item.kind === "claim" && Array.isArray(item.links))
      .map((item) => [
        String(item.stableId),
        (item.links as unknown[]).map(String).filter((link) => evidenceByObject.has(link))
          .map((link) => evidenceByObject.get(link)!),
      ]),
  );

  /*
    R3-K09, first half: the claim->entity relations the Core computed become edges.

    `compiler.py` builds one RELATION object per `semantics.relations` with
    `links=(subject_id, object_id)` and `payload=relation.as_record()`, whose `evidenceId` is
    the unit the mention was read in. Nothing is derived here that the Core did not send: the
    predicate, the two endpoints and the evidence are read, and a relation missing any of them
    -- an endpoint that is not a node, an evidence id no evidence object carries, a predicate
    outside the allowlist -- refuses the projection rather than shipping a dangling edge.
  */
  for (const item of objects.filter((object) => object.kind === "relation")) {
    const payload = item.payload && typeof item.payload === "object" ? item.payload as Record<string, unknown> : {};
    const links = Array.isArray(item.links) ? (item.links as unknown[]).map(String) : [];
    const predicate = typeof payload.predicate === "string" ? payload.predicate : "";
    const evidenceId = typeof payload.evidenceId === "string" ? payload.evidenceId : "";
    if (
      links.length !== 2 ||
      !nodeKindById.has(links[0]) ||
      !nodeKindById.has(links[1]) ||
      !CORE_RELATION_PREDICATES.has(predicate) ||
      ![...evidenceByObject.values()].includes(evidenceId)
    ) return null;
    edges.push({
      id: `relation-${sha256(`${links[0]}\n${predicate}\n${links[1]}`).slice(0, 32)}`,
      type: predicate as CoreKnowledgeEdge["type"],
      from: links[0],
      to: links[1],
      evidenceIds: [evidenceId],
    });
  }

  /*
    R3-K09, second half: a contradiction candidate becomes a `contradicts` edge between the two
    claims, and it has to be in review before it is in the graph.

    `semantics.py` flags a pair only on a numeric or a polarity disagreement inside one
    topic-and-time group, and `compiler.py` puts every one of them into `review_reasons` as
    `CONTRADICTION_CANDIDATE:<id>`, which is what makes the candidate `review_required` instead
    of promotable. So the review reason is required here, not assumed: a contradiction that
    reached the graph without reaching review would be a conflict drawn on a World a person was
    never asked to look at, and this projection is not the place to decide that is fine.
  */
  const contradictions = objects.filter((object) => object.kind === "validation_record");
  for (const item of contradictions) {
    const payload = item.payload && typeof item.payload === "object" ? item.payload as Record<string, unknown> : {};
    const links = Array.isArray(item.links) ? (item.links as unknown[]).map(String) : [];
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    const evidenceIds = [...new Set(links.flatMap((link) => claimEvidence.get(link) ?? []))];
    if (
      links.length !== 2 ||
      nodeKindById.get(links[0]) !== "Claim" ||
      nodeKindById.get(links[1]) !== "Claim" ||
      !CONTRADICTION_REASONS.has(reason) ||
      evidenceIds.length === 0 ||
      !result.candidate.reviewReasons.includes(`CONTRADICTION_CANDIDATE:${String(item.stableId)}`)
    ) return null;
    edges.push({
      id: `relation-${sha256(`${links[0]}\ncontradicts\n${links[1]}`).slice(0, 32)}`,
      type: "contradicts",
      from: links[0],
      to: links[1],
      evidenceIds,
      reason: reason as CoreKnowledgeEdge["reason"],
    });
  }

  const counts = {
    documents: documents.length,
    topics: 0,
    entities: nodes.filter((item) => item.kind === "Entity").length,
    claims: nodes.filter((item) => item.kind === "Claim").length,
    evidence: nodes.filter((item) => item.kind === "Evidence").length,
    relations: edges.length,
    contradictions: contradictions.length,
    packageFiles: result.candidate.package.files.length,
  };
  return {
    schemaVersion: "tavonel.collection_candidate.v1",
    executionAuthority: "tavonel-foundation-core-runtime-v1",
    lifecycle: result.candidate.lifecycle,
    candidatePromotion: false,
    collectionId,
    manifestDigest: result.candidate.manifestDigest,
    /*
      K01: the artifact advertises the predicates this compile emitted, not the ones the
      blueprint permits.

      `GENERIC_MIXED_CORPUS_BLUEPRINT.ontologyRelations` was attached verbatim, so a Core V2
      artifact -- from an engine with no Topic object anywhere in its model -- advertised
      `discusses_topic` in its own metadata. Reading the list off the edges makes the claim and
      the artifact one thing: publish a predicate here and there is a row in
      graph/relationships.csv that used it.
    */
    blueprint: { ...GENERIC_MIXED_CORPUS_BLUEPRINT, ontologyRelations: advertisedOntologyRelations(edges) },
    sourceDocuments: [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((document) => ({
        documentId: document.documentId,
        versionKey: document.versionKey,
        sanitizedKey: document.sanitizedKey,
        ocrJsonKey: document.ocrJsonKey,
        pageCount: document.pageCount,
        textCharacters: document.text.length,
        inputSha256: document.inputSha256,
      })),
    directoryPlan: result.candidate.directoryPlan,
    ontology: { nodes, edges },
    /*
      TM01: the only place the Core's retrieval units survive, and only when asked for.

      `candidate.units` is the `PreviousUnit` tuple a later `previousActiveWorld` has to carry,
      and no package file holds it -- `rag/chunks.jsonl` is units *grouped*, without their
      anchors or identity states, so a snapshot rebuilt from chunks would be a fiction. Carried
      through unread and unreshaped: this projection is not the Core's editor.
    */
    ...(keepRevisionSnapshot && Array.isArray(result.candidate.units)
      ? {
          revisionCompile: {
            worldStateId: result.candidate.worldStateId,
            manifestDigest: result.candidate.manifestDigest,
            artifactHashes: result.candidate.artifactHashes,
            units: result.candidate.units as Array<Record<string, unknown>>,
          } satisfies RevisionCompileSnapshot,
        }
      : {}),
    package: {
      roots: result.candidate.package.roots,
      files: result.candidate.package.files,
      signatureStatus: result.candidate.package.signatureStatus,
    },
    validation: {
      status: result.status === "completed" ? "passed" : "review_required",
      ...coreChecks,
      fullRebuildEquivalence: result.receipt.equivalence,
      reviewReasons: [...result.candidate.reviewReasons],
      counts,
    },
    reviewReasons: [...result.candidate.reviewReasons],
  };
}

/**
 * The prior active World, read back from a stored candidate, in the shape the wire wants.
 *
 * Structural rather than trusting: the snapshot is our own write, but it came back over the
 * network from object storage, and a malformed one must be a named refusal upstream rather than
 * a request the Core rejects with a validation dump. `null` means "this prior World cannot be
 * used for a revision compile" -- never "compile it as if it were the first time", which is the
 * silent fallback that would let a recompile report every unit as new.
 */
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function readRevisionCompileSnapshot(
  stored: unknown,
  expected: { worldStateId: string; manifestDigest: string },
): ProductCoreV2CompileRequest["previousActiveWorld"] | null {
  const artifact = stored && typeof stored === "object" ? stored as Record<string, unknown> : null;
  const snapshot = artifact?.revisionCompile && typeof artifact.revisionCompile === "object"
    ? artifact.revisionCompile as Record<string, unknown>
    : null;
  if (!snapshot) return null;
  const units = Array.isArray(snapshot.units) ? snapshot.units : null;
  const hashes = snapshot.artifactHashes && typeof snapshot.artifactHashes === "object"
    ? snapshot.artifactHashes as Record<string, unknown>
    : null;
  if (
    snapshot.worldStateId !== expected.worldStateId ||
    snapshot.manifestDigest !== expected.manifestDigest ||
    !units ||
    units.length === 0 ||
    !hashes ||
    !Object.values(hashes).every((digest) => typeof digest === "string" && SHA256.test(digest)) ||
    !units.every((unit) => Boolean(unit) && typeof unit === "object" &&
      ["logicalId", "sourceId", "sourceVersionId", "sourceContentSha256", "text", "anchor", "evidenceId", "identityState"]
        .every((field) => typeof (unit as Record<string, unknown>)[field] === "string") &&
      Number.isSafeInteger((unit as Record<string, unknown>).pageNumber1) &&
      /*
        `documentPath` and `neighbourAnchors` are `tuple[str, ...]` on `PreviousUnit`, so the
        element type is checked here too: a corrupted stored unit is refused with this lane's
        own `REVISION_COMPILE_PRIOR_WORLD_UNREADABLE` rather than left for the Core to answer
        with a 422 an operator then has to trace back to object storage. `neighbourAnchors`
        carries a default on the contract, so absent is legal; present and not a tuple of
        strings is not.
      */
      isStringArray((unit as Record<string, unknown>).documentPath) &&
      ((unit as Record<string, unknown>).neighbourAnchors === undefined ||
        isStringArray((unit as Record<string, unknown>).neighbourAnchors)))
  ) return null;
  return {
    worldStateId: expected.worldStateId,
    manifestDigest: expected.manifestDigest,
    units: units as Array<Record<string, unknown>>,
    artifactHashes: hashes as Record<string, string>,
  };
}

export async function dispatchProductCoreV2(
  env: ProductCoreV2Env,
  workspaceId: string,
  documents: CollectionOcrInput[],
  now = new Date(),
  previousActiveWorld: ProductCoreV2CompileRequest["previousActiveWorld"] | null = null,
): Promise<{ ok: true; result: ProductCoreV2CompileResponse } | { ok: false; code: string }> {
  const envelope = buildProductCoreV2Request(workspaceId, documents, now, undefined, previousActiveWorld);
  const body = JSON.stringify(envelope);
  const inputSha256 = `sha256:${sha256(body)}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", env.hmac)
    .update(`${timestamp}\n${envelope.requestId}\n${inputSha256}`, "utf8")
    .digest("hex");
  let response: Response;
  try {
    response = await fetch(`${env.url}/v2/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tavonel-core-timestamp": timestamp,
        "x-tavonel-core-request-id": envelope.requestId,
        "x-tavonel-input-sha256": inputSha256,
        "x-tavonel-core-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(CORE_CLIENT_TIMEOUT_MS),
    });
  } catch (cause) {
    /*
      A timeout and a refused connection are different problems with different recoveries, and
      collapsing both into CORE_V2_UNAVAILABLE meant the caller could not tell "Core is down, do
      not retry into it" from "Core is still working, this attempt gave up".

      A retry is safe now in a way it was not: the idempotency key no longer varies per attempt,
      so re-dispatching the same document binding reaches the same compile rather than starting a
      second one.
    */
    const timedOut = cause instanceof Error
      && (cause.name === "TimeoutError" || cause.name === "AbortError");
    return { ok: false, code: timedOut ? "CORE_V2_TIMEOUT" : "CORE_V2_UNAVAILABLE" };
  }
  const json = await response.json().catch(() => null) as ProductCoreV2CompileResponse | { code?: unknown } | null;
  if (!response.ok || !json) {
    const errorCode = (json as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof errorCode === "string" ? errorCode : `CORE_V2_HTTP_${response.status}` };
  }
  const result = json as ProductCoreV2CompileResponse;
  const lifecycleStatus = {
    completed: "candidate",
    review_required: "review_required",
    rejected: "rejected",
  } as const;
  if (
    result.schemaVersion !== PRODUCT_CORE_RESPONSE_SCHEMA ||
    result.runtime !== "tavonel-python-core-v2" ||
    !validCandidate(result.candidate) ||
    result.candidate.lifecycle !== lifecycleStatus[result.status] ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length < 5 ||
    result.artifacts.some((artifact) => !IDENTIFIER.test(artifact.artifactId) || !SHA256.test(artifact.contentSha256) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) ||
    result.receipt.requestId !== envelope.requestId ||
    result.receipt.inputSha256 !== inputSha256 ||
    result.receipt.outputSha256 !== `sha256:${sha256(canonicalize(result.candidate))}` ||
    !SHA256.test(result.receipt.coreReleaseDigest) ||
    result.receipt.matchingPolicy !== "legacy" ||
    result.receipt.candidatePromotion !== false ||
    result.receipt.rebuiltArtifacts > result.receipt.totalArtifacts ||
    result.receipt.workAvoidedArtifacts !== result.receipt.totalArtifacts - result.receipt.rebuiltArtifacts
  ) {
    return { ok: false, code: "CORE_V2_RECEIPT_INVALID" };
  }
  return { ok: true, result };
}
