/*
  What the workspace says when Ask abstains, and which cited source region it may open.

  Abstention used to mean one thing -- no region-bound evidence matched -- and the page said so
  for every abstention. An answer whose selected evidence is too long to return complete is a
  different abstention: the evidence exists and its citations stay listed, but no partial
  answer is shown. Telling that reader to add a source would be false. Not every listed
  citation can be opened, either -- see resolveCitationRegion -- so the copy does not promise it.

  The overflow branch and the unavailable-source marker follow the browser language (English or
  Korean); every other abstention keeps its existing English copy. Not a locale framework.

  The reason code is repeated here rather than imported: grounded-ask.ts pulls in node:crypto
  and must not reach the client bundle. workspace-ask-copy.test.ts pins the two together.
*/

export const EVIDENCE_EXCEEDS_ANSWER_LIMIT = "EVIDENCE_EXCEEDS_ANSWER_LIMIT";

export type AskAbstentionCopy = { notice: string; result: string; action: string | null };
export type AskSourceCopy = { unavailable: string; unverified: string; missing: string };

const NO_EVIDENCE: AskAbstentionCopy = {
  notice: "The active world abstained because no region-bound evidence matched the question.",
  result: "No region-bound evidence matched this question.",
  action: null,
};

const OVERFLOW: Record<"en" | "ko", AskAbstentionCopy> = {
  en: {
    notice:
      "The active world abstained: evidence was selected, but it is too long to return as one complete answer, so no partial answer is shown. A cited source region below opens only where the active World can locate it exactly; the others are marked unavailable. You can also ask a narrower question.",
    result:
      "The selected evidence is too long for a complete answer, so no partial answer is shown. Open a cited source region below where one is available, or ask a narrower question.",
    action: "Ask a narrower question",
  },
  ko: {
    notice:
      "활성 World가 답변을 보류했습니다. 근거는 선택되었지만 하나의 완전한 답변으로 반환하기에는 너무 길어 일부만 잘라낸 답변은 표시하지 않습니다. 아래 인용된 원문 영역은 활성 World에서 정확히 찾을 수 있을 때만 열리며, 나머지는 열 수 없음으로 표시됩니다. 더 좁은 질문을 해 주셔도 됩니다.",
    result:
      "선택된 근거가 너무 길어 완전한 답변을 표시할 수 없으며, 일부만 잘라낸 답변은 표시하지 않습니다. 열 수 있는 인용 원문 영역이 있으면 아래에서 열어 보거나 더 좁은 질문을 해 주세요.",
    action: "더 좁은 질문하기",
  },
};

const SOURCE: Record<"en" | "ko", AskSourceCopy> = {
  en: {
    unavailable:
      "This cited source region cannot be opened: the active World has no single region matching its evidence, version, page and box. The citation stays listed; no location is guessed.",
    unverified:
      "This cited source region cannot be opened here: the loaded World is not confirmed as the same collection and revision that answered this question, or is still loading. The citation stays listed; no location is guessed.",
    missing: "unavailable",
  },
  ko: {
    unavailable:
      "이 인용 원문 영역은 열 수 없습니다. 활성 World에 근거, 버전, 페이지, 영역이 모두 일치하는 영역이 하나로 확인되지 않습니다. 인용은 그대로 표시되며 위치를 추측하지 않습니다.",
    unverified:
      "이 인용 원문 영역은 여기서 열 수 없습니다. 불러온 World가 이 질문에 답한 것과 같은 컬렉션·리비전으로 확인되지 않았거나 아직 불러오는 중입니다. 인용은 그대로 표시되며 위치를 추측하지 않습니다.",
    missing: "정보 없음",
  },
};

/** `languages` is the browser's preference list (navigator.languages); only its first entry counts. */
function language(languages: readonly string[]): "en" | "ko" {
  return languages[0]?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function askAbstentionCopy(reason: string | null, languages: readonly string[] = []): AskAbstentionCopy {
  if (reason !== EVIDENCE_EXCEEDS_ANSWER_LIMIT) return NO_EVIDENCE;
  return OVERFLOW[language(languages)];
}

export function askSourceCopy(languages: readonly string[] = []): AskSourceCopy {
  return SOURCE[language(languages)];
}

/*
  The source-reference fields both Ask citation shapes share. The fallback builder always sends
  `sourceId`, a page and a box; the compiled builder sends no `sourceId` and may send a null page
  or box. Structural on purpose: importing either builder would pull node:crypto into the client.
*/
export type AskCitationSource = {
  evidenceId: string;
  sourceId?: string;
  sourceVersionId: string;
  pageNumber1: number | null;
  bbox1000: readonly number[] | null;
};

/* The fields of an active read-model evidence region (WorldEvidence) the resolver reads. */
export type ActiveSourceRegion = {
  id: string;
  blockId: string;
  sourceId: string;
  sourceVersionId: string;
  page: number;
  bbox: readonly number[];
};

function validBbox(value: unknown): value is readonly [number, number, number, number] {
  return Array.isArray(value) && value.length === 4
    && value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000)
    && value[0] < value[2] && value[1] < value[3];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * The id of the one active read-model region a citation names, or null.
 *
 * A region is the citation's only when its id is exactly `${citation.evidenceId}:${blockId}`
 * (the id the read model builds -- never a prefix test, never a split on the first colon, since
 * ids may contain colons) and its version, page and all four box coordinates are equal, plus
 * its sourceId when the citation carries one. Nothing else is authority: not sourceId and page,
 * not a nearby box, not another of the citation's evidence ids, not a version mapping. Missing
 * or malformed fields, no read model, no match, or more than one match -- including a region id
 * shared by two regions -- all return null, and the citation stays listed but unopenable.
 */
export function resolveCitationRegion(
  citation: AskCitationSource,
  evidence: readonly ActiveSourceRegion[] | null | undefined,
): string | null {
  const { evidenceId, sourceId, sourceVersionId, pageNumber1: page, bbox1000: bbox } = citation;
  if (
    !Array.isArray(evidence) || !nonEmpty(evidenceId) || !nonEmpty(sourceVersionId) ||
    !Number.isInteger(page) || (page as number) < 1 || !validBbox(bbox) ||
    (sourceId !== undefined && !nonEmpty(sourceId))
  ) return null;
  // Rows are checked at runtime too: a null, non-object or sourceId-less row never resolves and
  // never throws. The region's own sourceId is required even when the citation carries none.
  const matches = evidence.filter((row: unknown) => {
    if (!isObject(row)) return false;
    const region = row;
    const regionBbox: unknown = region.bbox;
    return nonEmpty(region.blockId) && region.id === `${evidenceId}:${region.blockId}` &&
      region.sourceVersionId === sourceVersionId && region.page === page &&
      nonEmpty(region.sourceId) && (sourceId === undefined || region.sourceId === sourceId) &&
      Array.isArray(regionBbox) && regionBbox.length === 4 && bbox.every((coordinate, index) => regionBbox[index] === coordinate);
  });
  if (matches.length !== 1) return null;
  const id = matches[0]!.id;
  // Any other object row carrying the same id makes the open ambiguous, whatever its other fields.
  return evidence.filter((row: unknown) => isObject(row) && row.id === id).length === 1 ? id : null;
}

/* The identity fields of a loaded World read model (WorldReadModel.world) the qualifier reads. */
export type AskWorldModel = { world: { id: string; manifestDigest: string } };
/* A selected collection (collectionId, manifestDigest) or an Ask answer receipt: both carry the pair. */
export type AskWorldIdentity = { collectionId?: unknown; manifestDigest?: unknown };

const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const MANIFEST_DIGEST = /^sha256:[a-f0-9]{64}$/;

/**
 * The loaded read model, unchanged, when it is the World that answered -- otherwise null.
 *
 * Ask answers the active World, while the workspace loads the read model of whichever collection
 * and manifest are selected (possibly a candidate). A region may be opened only when the model's
 * world id, the selected collection and the answer receipt all name one well-formed collection id,
 * and the model's manifest, the selected manifest and the receipt's manifest are one well-formed
 * digest. Any absent, null or malformed side -- identical malformed strings included -- refuses.
 * This is identity binding by equality, not signature or authenticity verification, and it reads
 * no mutable active pointer, status or numeric revision in place of these fields.
 */
export function qualifyAskWorldModel<Model extends AskWorldModel>(
  model: Model | null | undefined,
  selected: AskWorldIdentity | null | undefined,
  receipt: AskWorldIdentity | null | undefined,
): Model | null {
  if (!isObject(model) || !isObject(selected) || !isObject(receipt)) return null;
  const world: unknown = model.world;
  if (!isObject(world)) return null;
  const { id, manifestDigest } = world;
  return typeof id === "string" && COLLECTION_ID.test(id) &&
    typeof manifestDigest === "string" && MANIFEST_DIGEST.test(manifestDigest) &&
    selected.collectionId === id && receipt.collectionId === id &&
    selected.manifestDigest === manifestDigest && receipt.manifestDigest === manifestDigest
    ? model
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
