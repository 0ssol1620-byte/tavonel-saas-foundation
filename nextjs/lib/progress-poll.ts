import type { OcrProgress } from "./ocr-progress";

export const MAX_STATIONARY_PROGRESS_POLLS = 20;

export type ProgressPollState = {
  signature: string | null;
  stationaryPolls: number;
};

export type ProgressPollDecision = {
  continuePolling: boolean;
  state: ProgressPollState;
};

/** Stops a live view when its source is terminal or no longer producing evidence of work. */
export function advanceProgressPoll(
  previous: ProgressPollState | undefined,
  progress: OcrProgress | null,
): ProgressPollDecision {
  if (progress && progress.state !== "reading") {
    return { continuePolling: false, state: { signature: null, stationaryPolls: 0 } };
  }

  const signature = progress
    ? `${progress.state}:${progress.pagesRead}:${progress.pageCount ?? "?"}:${progress.regionsFound}`
    : null;
  const stationaryPolls = previous?.signature === signature ? previous.stationaryPolls + 1 : 1;
  return {
    continuePolling: stationaryPolls < MAX_STATIONARY_PROGRESS_POLLS,
    state: { signature, stationaryPolls },
  };
}

