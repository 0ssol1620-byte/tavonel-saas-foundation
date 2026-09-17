import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countNoun } from "./plural";

const board = readFileSync(new URL("../components/pipeline-board.tsx", import.meta.url), "utf8");
const queue = readFileSync(new URL("../components/review-queue.tsx", import.meta.url), "utf8");

describe("countNoun", () => {
  it("agrees with the count", () => {
    expect(countNoun(0, "source")).toBe("0 sources");
    expect(countNoun(1, "source")).toBe("1 source");
    expect(countNoun(2, "source")).toBe("2 sources");
  });

  it("takes an irregular plural", () => {
    expect(countNoun(1, "entry", "entries")).toBe("1 entry");
    expect(countNoun(3, "entry", "entries")).toBe("3 entries");
  });

  /* workspace-02: the two rendered strings that said "1 sources" go through the helper. */
  it("is what the board heading and the review filter print", () => {
    expect(board).toContain("<h2>{countNoun(rows.length, \"source\")}</h2>");
    expect(board).not.toMatch(/\{rows\.length\} sources/);
    expect(queue).toContain("All {countNoun(queue.total, \"source\")}");
    expect(queue).not.toMatch(/All \{queue\.total\} sources/);
  });
});
