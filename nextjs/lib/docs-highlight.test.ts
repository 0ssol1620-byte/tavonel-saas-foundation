import { describe, expect, it } from "vitest";
import { codeTokens } from "@/components/docs/code-tokens";

/*
  BQ-103. The tokenizer's one real obligation: the characters are unchanged.

  A highlighter that drops a backslash out of a curl command, or eats the last brace of a JSON
  example, is worse than no highlighter -- a reader copies the block and it does not run. Colour
  being wrong on a line is a blemish; text being wrong is a broken instruction. So the round-trip
  is the guard, and the classification cases below it are the cheaper half.
*/
const SAMPLES = [
  `curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\\n  https://tavonel.com/api/v1/documents`,
  `# Read the active World\nimport httpx\nr = httpx.get(url, headers={"Authorization": f"Bearer {key}"})`,
  `// the fingerprint is fetched separately\nconst res = await fetch("https://tavonel.com/api/v1/worlds");`,
  `{\n  "object_id": "obj_01J",\n  "evidence": { "page": 4, "region": [120, 240, 880, 300] }\n}`,
  "",
  "no tokens at all",
];

describe("codeTokens", () => {
  it("renders every character of the block it was given", () => {
    for (const sample of SAMPLES) {
      expect(codeTokens(sample).map((token) => token.text).join("")).toBe(sample);
    }
  });

  it("marks a comment and leaves the URL scheme alone", () => {
    const tokens = codeTokens(`const a = "x"; // note\nfetch("https://tavonel.com/api")`);
    expect(tokens.filter((token) => token.kind === "comment").map((token) => token.text)).toEqual(["// note"]);
    // The `//` in `https://` is not a comment opener, or the host would dim mid-word.
    expect(tokens.some((token) => token.kind === "string" && token.text.includes("https://tavonel.com/api"))).toBe(true);
  });

  it("does not open a comment inside a string, or a string inside a comment", () => {
    expect(codeTokens(`curl "https://tavonel.com/#frag"`).filter((t) => t.kind === "comment")).toEqual([]);
    const commented = codeTokens(`# don't split this\nrun()`);
    expect(commented[0]).toEqual({ text: "# don't split this", kind: "comment" });
  });
});
