/**
 * One name per stage, for every surface that names the stages.
 *
 * The hero film's chapter strip, the "how it works" step grid, the workspace compile stage and
 * the workspace board labels were each spelling the same four beats differently — ingest/parse/
 * extract/publish in one place, upload/read/organise/ready in another — so a reader who watched
 * the film and then opened the workspace was shown a second vocabulary for the thing they had
 * just been taught. One constant, four entries, imported by all of them.
 *
 * `ko` is a literal translation of the English label, not a second claim: /ko says what / says.
 */
export const PIPELINE_STAGES = [
  { key: "source", label: "Source", ko: "원본" },
  { key: "read", label: "Read", ko: "읽기" },
  { key: "organize", label: "Organize", ko: "정리" },
  { key: "ready", label: "Ready for AI", ko: "AI 준비 완료" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineStageKey = PipelineStage["key"];
