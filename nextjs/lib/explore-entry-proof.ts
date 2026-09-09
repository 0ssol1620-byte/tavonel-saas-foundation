import type { ExploreAnswerView } from "./explore-story";
import type { VisualEvidence } from "./visual-world-model";

/** Presentation selection only: never rewrite an answer, source excerpt or locator. */
export function chooseExploreEntryProof(
  evidence: readonly VisualEvidence[],
  answers: readonly ExploreAnswerView[],
): VisualEvidence | null {
  const cited = new Set(answers.flatMap((answer) => answer.regions.map((region) => region.evidenceId)));
  const candidates = evidence.filter((region) =>
    region.page > 2 && region.excerpt.trim().length >= 100 &&
    region.excerpt.trim().length <= 1_600 &&
    !/[●•]/.test(region.excerpt) &&
    !/^(?:table of contents|united states securities|form 10-[kq])\b/i.test(region.excerpt.trim()),
  );
  // The opening is a declared presentation choice: the annual filing's own
  // Company Background is easier to inspect than a cover or interleaved table.
  // Prefer an already-bound prepared-question citation next, then source text.
  // This ranking is not a confidence, correctness or model-quality score.
  const preferred = candidates.find((region) => region.form === "10-K" && /\bCompany Background\b/.test(region.excerpt))
    ?? candidates.find((region) => cited.has(region.id)) ?? candidates[0];
  return preferred ?? null;
}

export function excerptPreview(text: string, limit = 360): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const prefix = text.slice(0, limit);
  const space = prefix.lastIndexOf(" ");
  return { text: prefix.slice(0, space > limit / 2 ? space : limit), truncated: true };
}
