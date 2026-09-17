// L1 owns this file (TOKEN_CONTRACT_0917, "Pipeline vocabulary"). Written here so this lane
// compiles; the integrator keeps L1's copy.

/*
  One name per stage, everywhere the pipeline is named.

  The landing page alone carried four vocabularies for the same four steps: the hero chapter
  strip said SOURCE / READ / ORGANIZE / READY FOR AI, the works film tabs said FILES / ORGANIZE /
  UPDATES / USE WITH AI, the step grid said "Checking files / Reading content / ..." and the
  workspace board said something else again. A reader cannot learn a pipeline from that.
*/
export const PIPELINE_STAGES = [
  { key: "source", label: "Source", ko: "원본" },
  { key: "read", label: "Read", ko: "읽기" },
  { key: "organize", label: "Organize", ko: "정리" },
  { key: "ready", label: "Ready for AI", ko: "AI 준비 완료" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
