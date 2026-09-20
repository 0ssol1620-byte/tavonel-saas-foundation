export const COMPILER_SPECIMEN_SOURCE = {
  id: "apple-2026-q1-10-q",
  filename: "apple-2026-q1-10-q-reference.pdf",
  form: "10-Q",
  page: 4,
  pageCount: 30,
  regionId: "apple-2026-q1-10-q-p4-r14",
  bbox1000: [64, 476, 932, 538] as const,
  digest:
    "sha256:7fe2683c59e0b48f6c112bc17b3900d907f64236c138d1dd32f40d544b1ba89f",
  excerpt:
    "Operating expenses: Research and development 10,887 8,268 Selling, general and administrative 7,492 7,175 Total operating expenses 18,379 15,443",
  question: "What were operating expenses for research and development?",
  statement: "Condensed consolidated statements of operations",
  unit: "USD millions",
  currentPeriod: "Dec 27, 2025",
  priorPeriod: "Dec 28, 2024",
  currentValue: "10,887",
  priorValue: "8,268",
} as const;

export const COMPILER_SPECIMEN_STAGES = [
  { id: "page", label: "Page" },
  { id: "structure", label: "Structure" },
  { id: "evidence", label: "Evidence" },
  { id: "knowledge", label: "Knowledge" },
  { id: "intelligence", label: "Intelligence" },
] as const;

export type CompilerSpecimenStage = (typeof COMPILER_SPECIMEN_STAGES)[number];

export type CompilerSpecimenPlayback = {
  requested: boolean;
  reducedMotion: boolean;
  inView: boolean;
  documentVisible: boolean;
};

/** Keeps environmental pauses separate from the visitor's play/pause intent. */
export function compilerSpecimenShouldAdvance(
  state: CompilerSpecimenPlayback
): boolean {
  return (
    state.requested &&
    !state.reducedMotion &&
    state.inView &&
    state.documentVisible
  );
}

/** Returns the next frame in the one-pass sequence; the final frame has no successor. */
export function nextCompilerStage(index: number): number | null {
  return index >= 0 && index < COMPILER_SPECIMEN_STAGES.length - 1
    ? index + 1
    : null;
}
