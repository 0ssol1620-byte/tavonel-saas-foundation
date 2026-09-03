import { describe, expect, it } from "vitest";
import {
  COMPILE_LIMITS_NOTICE,
  COMPILE_MAX_DOCUMENTS,
  COMPILE_MIN_DOCUMENTS,
  judgeCompileSet,
} from "./compile-limits";

describe("judgeCompileSet", () => {
  it("accepts a single document", () => {
    expect(COMPILE_MIN_DOCUMENTS).toBe(1);
    expect(judgeCompileSet(1)).toEqual({ ok: true, count: 1 });
  });

  it("accepts every count up to the ceiling", () => {
    for (let count = COMPILE_MIN_DOCUMENTS; count <= COMPILE_MAX_DOCUMENTS; count += 1) {
      expect(judgeCompileSet(count).ok).toBe(true);
    }
  });

  it("rejects an empty selection", () => {
    const verdict = judgeCompileSet(0);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("DOCUMENT_SET_EMPTY");
  });

  it("rejects a selection past the ceiling and says what to do instead", () => {
    const verdict = judgeCompileSet(COMPILE_MAX_DOCUMENTS + 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("DOCUMENT_SET_TOO_LARGE");
    expect(verdict.ok === false && verdict.message).toContain("connect a source");
  });

  it("rejects non-integers rather than coercing them", () => {
    expect(judgeCompileSet(Number.NaN).ok).toBe(false);
    expect(judgeCompileSet(2.5).ok).toBe(false);
  });

  it("states the ceiling in the notice customers read before choosing files", () => {
    expect(COMPILE_LIMITS_NOTICE).toContain(String(COMPILE_MAX_DOCUMENTS));
  });
});
