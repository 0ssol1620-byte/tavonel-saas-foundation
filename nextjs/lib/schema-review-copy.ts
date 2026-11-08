/*
  Every sentence the workspace Schema screen (C1) says, in English and Korean.

  Same mechanism as lib/workspace-ask-copy.ts: the browser's first preferred language picks the
  table, Korean is a literal translation of the English beside it, spelled with lib/ko-terms.ts
  (근거 evidence, 원문 source, 후보 candidate, 검토 review, 관계 relation, World kept in English).
  lib/schema-review-copy.test.ts runs koTermDrift over the Korean table and checks both tables carry
  the same keys; lib/brand-copy.test.ts sweeps this file for barred phrases.

  What the screen must not say, because it is not true in this wave: that the schema was built
  automatically, that anything was certified without a person, or that a certified type is already
  used to extract anything. Typed extraction is C2 and has not shipped.
*/

export type SchemaReviewCopy = {
  title: string;
  intro: string;
  storedOnly: string;
  noWorld: string;
  noRun: string;
  loading: string;
  derive: string;
  deriving: string;
  derived: string;
  proposedBy: (when: string) => string;
  classes: string;
  properties: string;
  emptyKind: string;
  state: Record<"proposed" | "certified" | "rejected", string>;
  certify: string;
  reject: string;
  edit: string;
  cancel: string;
  submit: Record<"certify" | "reject" | "edit", string>;
  reasonLabel: string;
  reasonHint: string;
  labelLabel: string;
  descriptionLabel: string;
  page: (page: number) => string;
  box: string;
  evidenceHeading: string;
  proposedAs: (label: string) => string;
  history: Record<"certify" | "reject" | "edit", string>;
  saved: Record<"certify" | "reject" | "edit", string>;
  loadFailed: string;
  errors: Record<string, string>;
};

const EN: SchemaReviewCopy = {
  title: "Proposed schema",
  intro: "Types and relations proposed from this World’s evidence. Each one shows the source passages it came from. Nothing here is certified until a person certifies it.",
  storedOnly: "Certified types are stored with who certified them and why. They are not used to extract anything yet.",
  noWorld: "Open a compiled World first. A schema is proposed from one World’s evidence.",
  noRun: "No schema has been proposed for this World yet.",
  loading: "Reading the proposed schema.",
  derive: "Propose a schema from this World",
  deriving: "Proposing a schema from this World’s evidence…",
  derived: "Schema proposed. Review each candidate below.",
  proposedBy: (when) => `Proposed ${when} by the deterministic baseline, which reads names in the evidence. It does not use a language model.`,
  classes: "Types",
  properties: "Relations",
  emptyKind: "None proposed.",
  state: { proposed: "Awaiting review", certified: "Certified", rejected: "Rejected" },
  certify: "Certify",
  reject: "Reject",
  edit: "Edit",
  cancel: "Cancel",
  submit: { certify: "Certify this type", reject: "Reject this candidate", edit: "Save the edit" },
  reasonLabel: "Reason",
  reasonHint: "Say why, in at least eight characters. It is recorded with your decision.",
  labelLabel: "Name",
  descriptionLabel: "Description",
  page: (page) => `Page ${page}`,
  box: "Region",
  evidenceHeading: "Evidence",
  proposedAs: (label) => `Proposed as “${label}”`,
  history: { certify: "Certified", reject: "Rejected", edit: "Edited" },
  saved: { certify: "Certified. Recorded with your reason.", reject: "Rejected. Recorded with your reason.", edit: "Edit saved. It still needs a decision." },
  loadFailed: "The proposed schema could not be read. Nothing is shown rather than a partial list.",
  errors: {
    ONTOLOGY_ROLE_REQUIRED: "Only a workspace owner or admin can propose or decide a schema.",
    ONTOLOGY_DECISION_REASON_REQUIRED: "Give a reason of at least eight characters.",
    ONTOLOGY_CANDIDATE_ALREADY_DECIDED: "Someone has already decided this candidate. Reload to see the decision.",
    ONTOLOGY_CANDIDATE_NOT_FOUND: "This candidate is no longer in the latest proposal. Reload the list.",
    ONTOLOGY_SOURCE_DELETED: "A source document of this proposal was deleted, so it can no longer be decided.",
    ONTOLOGY_SOURCE_UNBOUND: "This World’s evidence is not bound to workspace documents, so no schema is proposed from it.",
    ONTOLOGY_NO_EVIDENCE: "This World has no evidence to propose a schema from.",
    ONTOLOGY_NO_CANDIDATES: "The evidence in this World did not support any type. Nothing was stored.",
    ONTOLOGY_WORLD_CHANGED: "This World changed while you were reading it. Reload and try again.",
    default: "That did not work, and nothing was recorded. Try again.",
  },
};

const KO: SchemaReviewCopy = {
  title: "제안된 스키마",
  intro: "이 World의 근거에서 제안된 유형과 관계입니다. 각 항목에 그 항목이 나온 원문 구절이 표시됩니다. 사람이 인증하기 전에는 아무것도 인증되지 않습니다.",
  storedOnly: "인증된 유형은 누가, 왜 인증했는지와 함께 저장됩니다. 아직 어떤 추출에도 사용되지 않습니다.",
  noWorld: "먼저 컴파일된 World를 여세요. 스키마는 하나의 World의 근거에서 제안됩니다.",
  noRun: "이 World에 대해 제안된 스키마가 아직 없습니다.",
  loading: "제안된 스키마를 읽는 중입니다.",
  derive: "이 World에서 스키마 제안하기",
  deriving: "이 World의 근거에서 스키마를 제안하는 중…",
  derived: "스키마가 제안되었습니다. 아래에서 각 후보를 검토하세요.",
  proposedBy: (when) => `${when}에 결정적 기준선이 제안했습니다. 기준선은 근거 속 이름을 읽으며 언어 모델을 사용하지 않습니다.`,
  classes: "유형",
  properties: "관계",
  emptyKind: "제안된 항목이 없습니다.",
  state: { proposed: "검토 대기", certified: "인증됨", rejected: "거절됨" },
  certify: "인증",
  reject: "거절",
  edit: "편집",
  cancel: "취소",
  submit: { certify: "이 유형 인증하기", reject: "이 후보 거절하기", edit: "편집 저장하기" },
  reasonLabel: "사유",
  reasonHint: "여덟 자 이상으로 이유를 적어 주세요. 결정과 함께 기록됩니다.",
  labelLabel: "이름",
  descriptionLabel: "설명",
  page: (page) => `${page}쪽`,
  box: "영역",
  evidenceHeading: "근거",
  proposedAs: (label) => `“${label}”(으)로 제안됨`,
  history: { certify: "인증됨", reject: "거절됨", edit: "편집됨" },
  saved: { certify: "인증되었습니다. 사유와 함께 기록되었습니다.", reject: "거절되었습니다. 사유와 함께 기록되었습니다.", edit: "편집이 저장되었습니다. 아직 결정이 필요합니다." },
  loadFailed: "제안된 스키마를 읽지 못했습니다. 일부만 보여 주지 않고 아무것도 표시하지 않습니다.",
  errors: {
    ONTOLOGY_ROLE_REQUIRED: "워크스페이스 소유자나 관리자만 스키마를 제안하거나 결정할 수 있습니다.",
    ONTOLOGY_DECISION_REASON_REQUIRED: "여덟 자 이상의 사유를 적어 주세요.",
    ONTOLOGY_CANDIDATE_ALREADY_DECIDED: "다른 사람이 이미 이 후보를 결정했습니다. 다시 불러와서 결정을 확인하세요.",
    ONTOLOGY_CANDIDATE_NOT_FOUND: "이 후보는 최신 제안에 더 이상 없습니다. 목록을 다시 불러오세요.",
    ONTOLOGY_SOURCE_DELETED: "이 제안의 원문 문서가 삭제되어 더 이상 결정할 수 없습니다.",
    ONTOLOGY_SOURCE_UNBOUND: "이 World의 근거가 워크스페이스 문서에 묶여 있지 않아 스키마를 제안하지 않습니다.",
    ONTOLOGY_NO_EVIDENCE: "이 World에는 스키마를 제안할 근거가 없습니다.",
    ONTOLOGY_NO_CANDIDATES: "이 World의 근거로는 어떤 유형도 제안되지 않았습니다. 아무것도 저장하지 않았습니다.",
    ONTOLOGY_WORLD_CHANGED: "읽는 동안 이 World가 바뀌었습니다. 다시 불러와서 시도하세요.",
    default: "처리되지 않았으며 아무것도 기록되지 않았습니다. 다시 시도하세요.",
  },
};

export const SCHEMA_REVIEW_COPY = { en: EN, ko: KO } as const;

/** `languages` is navigator.languages; only its first entry counts, as in workspace-ask-copy.ts. */
export function schemaReviewCopy(languages: readonly string[] = []): SchemaReviewCopy {
  return languages[0]?.toLowerCase().startsWith("ko") ? KO : EN;
}

export function schemaReviewError(copy: SchemaReviewCopy, code: string | undefined): string {
  return (code && copy.errors[code]) || copy.errors.default!;
}
