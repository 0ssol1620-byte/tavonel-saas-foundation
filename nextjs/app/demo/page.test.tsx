import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DemoPage, { metadata } from "./page";

describe("/demo public route contract", () => {
  it("publishes a self-canonical, indexable product demo", () => {
    expect(metadata.alternates?.canonical).toBe("/demo");
    expect(metadata.robots).not.toMatchObject({ index: false });
  });

  it("renders the complete synthetic source-to-signed-export path without JavaScript", () => {
    const html = renderToStaticMarkup(<DemoPage />);
    expect(html).toContain("PUBLIC SAMPLE · SYNTHETIC DATA");
    for (const label of ["Source", "Change", "Compile and review", "Activation", "Answer and evidence", "Signed export"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("candidatePromotion=false");
    expect(html).toContain("Ed25519 signature verified");
    expect(html).toContain("Open the source page");
    expect(html).toContain("Download the offline verifier");
  });
});
