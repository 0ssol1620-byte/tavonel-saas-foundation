import { createHash, createPublicKey } from "node:crypto";
import {
  canonicalize,
  compileCollectionCandidate,
  validateCollectionOcrInput,
  type CollectionOcrInput,
} from "./collection-compiler";
import { buildSignedCollectionZip } from "./collection-download";
import { createExportSigner, verifyExportSignature } from "./export-signing";
import { answerGroundedQuestion } from "./grounded-ask";
import { validatePromoteWorldMutation } from "./world-store";
import rawInputs from "./entity-extraction-eval.inputs.json";

/**
 * B32 public product-engine demonstration.
 *
 * The repository-owned synthetic PDFs are compiled through the same candidate, grounded Ask,
 * promotion-envelope and signed-package contracts as the product. Fixed sample times and a
 * public fixture key make the output deterministic. The key carries no trust outside this demo.
 */

export const SIGNED_PRODUCT_DEMO_DISCLOSURE =
  "PUBLIC SAMPLE · SYNTHETIC DATA. This deterministic path describes no customer, benchmark, certification or production run.";

export const SIGNED_PRODUCT_DEMO_IDS = {
  operationId: "00000000-0000-4000-8000-000000000031",
  workspaceKey: "workspace-public-sample",
  worldStateId: "world-public-sample-fp200-r1",
  actorUserId: "00000000-0000-4000-8000-000000000032",
  reviewEventId: "review-public-sample-fp200-r1",
  activationEventId: "activation-public-sample-fp200-r1",
  signingKeyId: "public-sample-ed25519-2026",
} as const;

// Intentionally public fixture material. Never use this key outside the synthetic sample.
const SAMPLE_PRIVATE_KEY_PKCS8_DER_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEIJIrGGwGyOgh5UwmfozrzyRKx//PaMGjyDxlEMfFwpqp";
const SAMPLE_PUBLIC_KEY_SPKI_DER_BASE64 =
  "MCowBQYDK2VwAyEAeJTDWBqjYOG+gVqXnUF/evHrJCPvZJihXCfdo454oBA=";

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function readInputs(): CollectionOcrInput[] {
  const inputs = (rawInputs as unknown[]).map((value) => validateCollectionOcrInput(value));
  if (inputs.some((input) => input === null)) {
    throw new Error("signed_product_demo_inputs_invalid");
  }
  return inputs as CollectionOcrInput[];
}

const inputs = readInputs();
const compiled = compileCollectionCandidate(inputs);
if (compiled.lifecycle !== "candidate" || compiled.validation.status !== "passed") {
  throw new Error("signed_product_demo_candidate_not_promotable");
}

const executionOutputSha256 = sha256(JSON.stringify(compiled));
const artifact = {
  ...compiled,
  coreExecution: {
    status: "completed" as const,
    runtime: "tavonel-collection-compiler-ts-v1/public-sample",
    worldStateId: SIGNED_PRODUCT_DEMO_IDS.worldStateId,
    receipt: {
      requestId: `public-sample-${compiled.collectionId}`,
      inputSha256: sha256(canonicalize(inputs)),
      outputSha256: executionOutputSha256,
      manifestDigest: compiled.manifestDigest,
      candidatePromotion: false as const,
      equivalence: "passed" as const,
    },
  },
};

const candidateObjectKey =
  `immutable/${SIGNED_PRODUCT_DEMO_IDS.workspaceKey}/${SIGNED_PRODUCT_DEMO_IDS.workspaceKey}` +
  `/collections/${compiled.collectionId}/${compiled.manifestDigest.slice(7)}/candidate-world.json`;
const promotion = {
  operationId: SIGNED_PRODUCT_DEMO_IDS.operationId,
  workspaceKey: SIGNED_PRODUCT_DEMO_IDS.workspaceKey,
  collectionId: compiled.collectionId,
  manifestDigest: compiled.manifestDigest,
  candidateObjectKey,
  worldStateId: SIGNED_PRODUCT_DEMO_IDS.worldStateId,
  coreOutputSha256: executionOutputSha256,
  actorUserId: SIGNED_PRODUCT_DEMO_IDS.actorUserId,
  expectedCurrentManifest: null,
  expectedCurrentRevision: 0,
  reason: "Synthetic public sample reviewed for the B32 product path.",
};
if (!validatePromoteWorldMutation(promotion)) {
  throw new Error("signed_product_demo_activation_contract_invalid");
}

// Ask is evaluated only after the sample promotion envelope passes the same fail-closed shape
// gate as a real activation. The sample never calls the store mutation itself.
const question = "What is the current full-service interval for FP-200?";
const groundedAnswer = answerGroundedQuestion(artifact, question);
if (!groundedAnswer || groundedAnswer.status !== "grounded") {
  throw new Error("signed_product_demo_answer_not_grounded");
}
const primaryCitation = groundedAnswer.citations.find(
  (citation) =>
    citation.sourceId === "fp200-maintenance-manual" &&
    citation.excerpt.includes("2,000 operating hours"),
);
if (!primaryCitation) throw new Error("signed_product_demo_primary_citation_missing");

const signer = createExportSigner({
  keyId: SIGNED_PRODUCT_DEMO_IDS.signingKeyId,
  keyVersion: 1,
  privateKeyPkcs8DerBase64: SAMPLE_PRIVATE_KEY_PKCS8_DER_BASE64,
  notBefore: "2026-09-20T00:00:00.000Z",
  issuedAt: "2026-09-20T00:00:00.000Z",
  expiresAt: "2036-09-20T00:00:00.000Z",
});
if (!signer) throw new Error("signed_product_demo_signer_invalid");
const signedExport = buildSignedCollectionZip(artifact, signer);
const manifestBytes = Buffer.from(`${JSON.stringify(signedExport.exportManifest, null, 2)}\n`, "utf8");
const publicKey = createPublicKey({
  key: Buffer.from(SAMPLE_PUBLIC_KEY_SPKI_DER_BASE64, "base64"),
  format: "der",
  type: "spki",
}).export({ format: "der", type: "spki" });
if (!verifyExportSignature(manifestBytes, signedExport.signature, publicKey)) {
  throw new Error("signed_product_demo_signature_invalid");
}

const sourceById = new Map(inputs.map((input) => [input.documentId, input]));
const source = (documentId: string, label: string, href: string) => {
  const input = sourceById.get(documentId);
  if (!input) throw new Error(`signed_product_demo_source_missing:${documentId}`);
  return { documentId, label, href, sha256: input.inputSha256, pageCount: input.pageCount };
};

export const signedProductDemo = {
  schemaVersion: "tavonel.public_product_demo.v1",
  disclosure: SIGNED_PRODUCT_DEMO_DISCLOSURE,
  fixture: {
    title: "FP-200 maintenance interval",
    capturedAt: "2026-09-20T00:00:00.000Z",
    sources: [
      {
        documentId: "fp200-maintenance-manual-revB",
        label: "Maintenance manual · revision B",
        href: "/explore-sample/fp-200-maintenance-manual-revB.pdf",
        sha256: "sha256:1738896a4f79d2dc06930ccccb78940c579b0a91d80487afc56155beb9b11c5a",
        pageCount: 1,
      },
      source("fp200-maintenance-manual", "Maintenance manual · revision C", "/explore-sample/fp-200-maintenance-manual-revC.pdf"),
      source("fp200-change-notice-cn-2026-03", "Change notice · CN-2026-03", "/explore-sample/fp-200-change-notice-CN-2026-03.pdf"),
      source("fp200-service-log-2026", "Service log · 2026", "/explore-sample/fp-200-service-log-2026.pdf"),
    ],
  },
  change: {
    from: "1,500 operating hours",
    to: "2,000 operating hours",
    sourceDocumentId: "fp200-change-notice-cn-2026-03",
    sourceVersionId: sourceById.get("fp200-change-notice-cn-2026-03")!.versionKey,
  },
  candidate: {
    collectionId: compiled.collectionId,
    manifestDigest: compiled.manifestDigest,
    lifecycle: compiled.lifecycle,
    candidatePromotion: compiled.candidatePromotion,
    validationStatus: compiled.validation.status,
    validationChecks: {
      deterministicMaterialization: compiled.validation.deterministicMaterialization,
      sourceCoverage: compiled.validation.sourceCoverage,
      evidenceCoverage: compiled.validation.evidenceCoverage,
      immutableInputsOnly: compiled.validation.immutableInputsOnly,
    },
    counts: compiled.validation.counts,
    runtime: artifact.coreExecution.runtime,
    requestId: artifact.coreExecution.receipt.requestId,
    outputSha256: executionOutputSha256,
  },
  review: {
    eventId: SIGNED_PRODUCT_DEMO_IDS.reviewEventId,
    decision: "accepted" as const,
    actor: "sample-reviewer",
    recordedAt: "2026-09-20T00:00:01.000Z",
    evidenceId: primaryCitation.evidenceId,
    reason: "Revision C and its change notice agree on the current interval.",
  },
  activation: {
    eventId: SIGNED_PRODUCT_DEMO_IDS.activationEventId,
    worldStateId: promotion.worldStateId,
    revision: 1,
    status: "ACTIVE" as const,
    activatedAt: "2026-09-20T00:00:02.000Z",
    manifestDigest: promotion.manifestDigest,
    expectedPreviousManifest: promotion.expectedCurrentManifest,
    mutationContractValid: true,
  },
  answer: {
    question,
    status: groundedAnswer.status,
    text: groundedAnswer.answer,
    receipt: groundedAnswer.receipt,
    citation: primaryCitation,
    sourceHref: "/explore-sample/fp-200-maintenance-manual-revC.pdf#page=1",
  },
  signedExport: {
    schemaVersion: signedExport.exportManifest.schemaVersion,
    lifecycle: signedExport.exportManifest.lifecycle,
    candidatePromotion: signedExport.exportManifest.candidatePromotion,
    collectionId: signedExport.exportManifest.collectionId,
    manifestDigest: signedExport.exportManifest.manifestDigest,
    fileCount: signedExport.exportManifest.files.length,
    signature: signedExport.signature,
    verified: true,
    verifierHref: "/developer/tavonel-verify-export.mjs",
  },
} as const;

export type SignedProductDemo = typeof signedProductDemo;
