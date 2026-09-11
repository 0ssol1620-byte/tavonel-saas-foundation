import { describe, expect, it } from "vitest";
import { sanitizeDocumentText } from "./sanitize-html";

/*
  WG-063. The failure path first: a source excerpt that carries a script element must not reach a
  page with the element still in it, and the ordinary prose beside it must come through unharmed.
*/
describe("sanitizeDocumentText", () => {
  it("takes a script element and its contents out of document text", () => {
    expect(sanitizeDocumentText('Total <script>fetch("/steal")</script> 12 pages'))
      .toBe("Total 12 pages");
  });

  it("takes an unterminated script tag and everything after it", () => {
    expect(sanitizeDocumentText("Revenue <script>alert(1)")).toBe("Revenue");
  });

  it("keeps the text of an event-handler tag and drops the tag", () => {
    expect(sanitizeDocumentText('<img src=x onerror="alert(1)">See page 4')).toBe("See page 4");
  });

  it("drops HTML comments", () => {
    expect(sanitizeDocumentText("Section 2 <!-- internal note --> continues")).toBe("Section 2 continues");
  });

  it("leaves authored prose alone, including a bare less-than", () => {
    const prose = "Pages 1 < 2 are read first, and the figure stays with the paragraph it was printed in.";
    expect(sanitizeDocumentText(prose)).toBe(prose);
  });
});
