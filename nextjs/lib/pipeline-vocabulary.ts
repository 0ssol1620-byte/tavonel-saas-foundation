// L1 owns this file (TOKEN_CONTRACT_0917 §Pipeline vocabulary). Copied here so the workspace
// lane compiles on its own; the integrator keeps L1's copy.

export const PIPELINE_STAGES = [
  { key: "source", label: "Source", ko: "원본" },
  { key: "read", label: "Read", ko: "읽기" },
  { key: "organize", label: "Organize", ko: "정리" },
  { key: "ready", label: "Ready for AI", ko: "AI 준비 완료" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];
