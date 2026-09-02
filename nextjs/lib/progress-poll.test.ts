import { describe, expect, it } from "vitest";
import { advanceProgressPoll, MAX_STATIONARY_PROGRESS_POLLS, type ProgressPollState } from "./progress-poll";
import type { OcrProgress } from "./ocr-progress";

const reading = (pagesRead = 1): OcrProgress => ({
  state: "reading",
  pagesRead,
  pageCount: 3,
  regionsFound: pagesRead * 2,
  pages: [],
});

describe("OCR progress polling", () => {
  it.each(["read", "refused"] as const)("stops on %s", (state) => {
    expect(advanceProgressPoll(undefined, { ...reading(), state }).continuePolling).toBe(false);
  });

  it("keeps polling while observed progress advances", () => {
    const first = advanceProgressPoll(undefined, reading(1));
    const second = advanceProgressPoll(first.state, reading(2));
    expect(first.continuePolling).toBe(true);
    expect(second.continuePolling).toBe(true);
    expect(second.state.stationaryPolls).toBe(1);
  });

  it("stops an unchanged or missing view after the bounded grace window", () => {
    let state: ProgressPollState | undefined;
    let decision = advanceProgressPoll(state, null);
    for (let index = 1; index < MAX_STATIONARY_PROGRESS_POLLS; index += 1) {
      state = decision.state;
      decision = advanceProgressPoll(state, null);
    }
    expect(decision.continuePolling).toBe(false);
  });
});

