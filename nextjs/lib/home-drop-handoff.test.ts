import { describe, expect, it } from "vitest";
import { freshHomeDrop, HOME_DROP_TTL_MS } from "./home-drop-handoff";

describe("Home drop hand-off", () => {
  const files = [new File(["%PDF-1.7"], "a.pdf", { type: "application/pdf" })];

  it("hands over a record inside its TTL and nothing after it", () => {
    expect(freshHomeDrop({ files, at: 1_000 }, 1_000 + HOME_DROP_TTL_MS)).toEqual(files);
    expect(freshHomeDrop({ files, at: 1_000 }, 1_001 + HOME_DROP_TTL_MS)).toEqual([]);
    expect(freshHomeDrop(undefined, 1_000)).toEqual([]);
  });
});
