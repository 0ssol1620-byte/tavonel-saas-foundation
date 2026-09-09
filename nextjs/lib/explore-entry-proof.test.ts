import { describe, expect, it } from "vitest";
import { chooseExploreEntryProof, excerptPreview } from "./explore-entry-proof";
import type { VisualEvidence } from "./visual-world-model";
import type { ExploreAnswerView } from "./explore-story";

const excerpt = "The filing describes the source material and its context. ".repeat(4);
const region = (id: string, overrides: Partial<VisualEvidence> = {}): VisualEvidence => ({
  id, sourceId: "filing-1", filename: "filing.pdf", href: "/filing.pdf", page: 8, pageCount: 80,
  bbox1000: [100,100,900,300], excerpt, sourceVersionId: "v1", digest: "sha256:"+"a".repeat(64),
  authority: "official", ...overrides,
});

describe("source-backed Explore entry", () => {
  it("returns the original evidence object, never an authored replacement", () => {
    const item = region("source-a");
    expect(chooseExploreEntryProof([item], [])).toBe(item);
  });
  it("prefers an already-resolved answer citation over unrelated source text", () => {
    const a=region("source-a"), b=region("source-b");
    const answers: ExploreAnswerView[] = [{ question: "Which source?", answer: b.excerpt,
      regions: [{ evidenceId:b.id,sourceId:b.sourceId,filename:b.filename,page:b.page,excerpt:b.excerpt,relevance:1 }] }];
    expect(chooseExploreEntryProof([a,b],answers)).toBe(b);
  });
  it("does not show a cover or table of contents as the first proof", () => {
    const a=region("cover",{page:1}), b=region("contents",{excerpt:"Table of contents "+excerpt}), c=region("content");
    expect(chooseExploreEntryProof([a,b,c],[])).toBe(c);
  });
  it("renders no fabricated fallback if the bounded World has no suitable excerpt", () => {
    expect(chooseExploreEntryProof([],[])).toBeNull();
    expect(chooseExploreEntryProof([region("short",{excerpt:"unmeasured"})],[])).toBeNull();
  });
  it("curates the actual Company Background rather than bullet-column fragments", () => {
    const fragments=region("table",{excerpt:"● first column ● second column "+excerpt});
    const background=region("background",{form:"10-K",excerpt:"Company Background "+excerpt});
    expect(chooseExploreEntryProof([fragments,region("other"),background],[])).toBe(background);
    expect(chooseExploreEntryProof([fragments],[])).toBeNull();
  });
  it("shows an exact substring and records when an excerpt continues", () => {
    const text="Revenue was -12.5 million USD. ".repeat(30);
    const result=excerptPreview(text);
    expect(text.startsWith(result.text)).toBe(true);
    expect(result.text).toContain("-12.5 million USD");
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(360);
  });
  it("does not alter shorter original wording", () => {
    expect(excerptPreview("Actual text — 한국어")).toEqual({text:"Actual text — 한국어",truncated:false});
  });
});
