import { describe, expect, it } from "vitest";
import { readWorldLensParams, writeWorldLensParams } from "./world-lens-url";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("world lens url", () => {
  it("round-trips every key", () => {
    const state = { lens: "graph", object: "ko_1", evidence: "ev:2", asOf: DIGEST, revision: "v1.2" } as const;
    const url = writeWorldLensParams(new URL("https://x.test/workspace/world"), state);
    expect(readWorldLensParams(url.searchParams)).toEqual(state);
  });

  it("drops invalid values instead of coercing them", () => {
    const q = new URLSearchParams({ lens: "nope", object: "a b", evidence: "<x>", asof: "sha256:zz", rev: "x/y" });
    expect(readWorldLensParams(q)).toEqual({});
  });

  it("drops a 10 KB object value", () => {
    expect(readWorldLensParams(new URLSearchParams({ object: "a".repeat(10_000) }))).toEqual({});
  });

  it("leaves unrelated params and removes cleared keys", () => {
    const url = new URL(`https://x.test/w?collection=c1&manifest=m&job=j&corpus=k&lens=graph&object=o`);
    writeWorldLensParams(url, { lens: "files" });
    expect(url.searchParams.get("collection")).toBe("c1");
    expect(url.searchParams.get("manifest")).toBe("m");
    expect(url.searchParams.get("job")).toBe("j");
    expect(url.searchParams.get("corpus")).toBe("k");
    expect(url.searchParams.get("lens")).toBe("files");
    expect(url.searchParams.has("object")).toBe(false);
  });
});
