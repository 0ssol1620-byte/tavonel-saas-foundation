import type { ContextPacket } from "./context-packet";
import { verifyGroundedCitations } from "./context-packet";

// GeneratorAdapter is the replaceable seam for LLM-based answer generation. It never
// receives raw document text outside a ContextPacket, and its output is never trusted as
// grounded until generateGroundedAnswer verifies every citation against that same packet
// (see the STATUS note this replaces in context-packet.ts). A generator that invents an
// evidence ID not present in the packet must never reach the caller as a grounded answer.
//
// STATUS (Wave 2): this is the enforcement contract, not yet an implementation or a
// production call site. No concrete GeneratorAdapter (an actual LLM provider integration)
// exists anywhere in this repo yet, and no API route calls generateGroundedAnswer --
// nextjs/app/api/collections/[id]/ask/route.ts still calls the pre-existing
// excerpt-concatenation path (answerGroundedQuestion in grounded-ask.ts) unchanged, since
// it builds citations directly from evidence and cannot hallucinate one. Choosing and
// wiring a real LLM provider is a product decision (which model, which prompt, cost/latency
// tradeoffs) explicitly out of Wave 2's scope; ship no LLM-based generator without routing
// it through generateGroundedAnswer when that decision is made.
export type GeneratorModelIdentity = {
  provider: string;
  model: string;
  revision: string;
  runtimeImage?: string;
};

// The model may only assert an evidenceId (which must exist in the packet) plus the quote
// it says supports it. It must never assert page/bbox/authority/sourceVersionId itself —
// those are looked up from the packet's own items, not taken on the model's word.
export type GeneratorCitation = {
  evidenceId: string;
  quote: string;
};

export type GeneratorAnswerCandidate = {
  answer: string;
  citations: GeneratorCitation[];
};

export type GeneratorReceipt = {
  provider: string;
  model: string;
  revision: string;
  runtimeImage?: string;
  inputDigest: string;
  outputDigest: string | null;
  durationMs: number;
  timedOut: boolean;
};

export type GeneratorResult =
  | { status: "ok"; candidate: GeneratorAnswerCandidate; receipt: GeneratorReceipt }
  | { status: "error"; reason: string; receipt: GeneratorReceipt };

export type GeneratorInvokeOptions = {
  timeoutMs?: number;
};

export type GeneratorAdapter = {
  identity(): GeneratorModelIdentity;
  generate(packet: ContextPacket, options?: GeneratorInvokeOptions): Promise<GeneratorResult>;
};

export type GroundedGenerationCitation = {
  evidenceId: string;
  quote: string;
  sourceVersionId: string;
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  authority: string;
};

export type GroundedGenerationOutcome =
  | { status: "grounded"; answer: string; citations: GroundedGenerationCitation[]; receipt: GeneratorReceipt }
  | { status: "abstained"; reason: string; receipt: GeneratorReceipt | null };

// The enforcement point the Wave 1 audit required before any LLM-based generator could
// ship: ContextPacket -> GeneratorAdapter -> AnswerCandidate -> verifyGroundedCitations ->
// GroundedAnswer. Three distinct abstention reasons, not one generic failure, so a caller
// (and a receipt) can tell "nothing to ground on" apart from "the provider is unavailable"
// apart from "the model tried to cite evidence that doesn't exist" -- the last of these is
// the citation-hallucination guard actually firing, not a degraded-but-safe path.
export async function generateGroundedAnswer(
  adapter: GeneratorAdapter,
  packet: ContextPacket,
  options?: GeneratorInvokeOptions,
): Promise<GroundedGenerationOutcome> {
  if (packet.items.length === 0) {
    return { status: "abstained", reason: "NO_CONTEXT_TO_GROUND", receipt: null };
  }

  const result = await adapter.generate(packet, options);
  if (result.status === "error") {
    return { status: "abstained", reason: `GENERATOR_PROVIDER_ERROR: ${result.reason}`, receipt: result.receipt };
  }

  if (result.candidate.citations.length === 0) {
    // verifyGroundedCitations([], packet) is vacuously valid -- there are no unknown ids
    // among zero cited ids -- which would let an answer with real content but no evidence
    // behind it sail through as "grounded". A grounded answer must cite something.
    return { status: "abstained", reason: "NO_CITATIONS_PROVIDED", receipt: result.receipt };
  }

  const citedEvidenceIds = result.candidate.citations.map((citation) => citation.evidenceId);
  const verification = verifyGroundedCitations(citedEvidenceIds, packet);
  if (!verification.valid) {
    return {
      status: "abstained",
      reason: `FABRICATED_CITATION_REJECTED: unknown evidence id(s) ${verification.unknownEvidenceIds.join(", ")}`,
      receipt: result.receipt,
    };
  }

  const evidenceIndex = new Map<string, ContextPacket["items"][number]>();
  for (const item of packet.items) {
    for (const evidenceId of item.evidenceIds) evidenceIndex.set(evidenceId, item);
  }

  const citations: GroundedGenerationCitation[] = result.candidate.citations.map((citation) => {
    const item = evidenceIndex.get(citation.evidenceId);
    return {
      evidenceId: citation.evidenceId,
      quote: citation.quote,
      sourceVersionId: item?.sourceVersionId ?? "",
      pageNumber1: item?.pageNumber1 ?? null,
      bbox1000: item?.bbox1000 ?? null,
      authority: item?.authority ?? "",
    };
  });

  return { status: "grounded", answer: result.candidate.answer, citations, receipt: result.receipt };
}
