import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DemoVersionDiff from "../components/demo-version-diff";
import { demoWorldDiff } from "./demo-world-diff";
import { signedProductDemo, SIGNED_PRODUCT_DEMO_DISCLOSURE } from "./signed-product-demo";

/*
  THE VALIDATOR FOR GAP #12.

  The block's claim is narrow and has to stay narrow: two complete compiles of the same corpus
  were compared afterwards, and neither was rebuilt in place. The risk on a page like this is the
  opposite reading -- "3 rebuilt" beside "8 added" invites a reader to infer a selective update
  that this repository's compiler cannot perform -- so the wording is held here, in both
  directions: the page must say complete compiles, and must not say the other thing.

  The figures are recomputed from the two artifacts rather than asserted, the same discipline as
  `hero-stats.test.ts`, and the disclosure is checked to be inside the frame rather than only at
  the top of the route the frame happens to live on.
*/

const html = renderToStaticMarkup(createElement(DemoVersionDiff, {}));
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const source = readFileSync(
  fileURLToPath(new URL("../lib/demo-world-diff.ts", import.meta.url)),
  "utf8",
);

describe("the two-version diff on /demo", () => {
  it("compares two different complete compiles of the same corpus", () => {
    expect(demoWorldDiff.before.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(demoWorldDiff.after.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(demoWorldDiff.before.manifestDigest).not.toBe(demoWorldDiff.after.manifestDigest);
    /* One source apart, and the one is the change notice the step above is about. */
    expect(demoWorldDiff.arrival.documentId).toBe("fp200-change-notice-cn-2026-03");
    expect(demoWorldDiff.arrival.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(demoWorldDiff.after.objects).toBeGreaterThan(demoWorldDiff.before.objects);
  });

  it("prints both digests and every diff row it computed", () => {
    for (const digest of [demoWorldDiff.before.manifestDigest, demoWorldDiff.after.manifestDigest]) {
      expect(html).toContain(digest.replace(/^sha256:/, "sha256 ").slice(0, 20));
    }
    for (const row of demoWorldDiff.rows) {
      expect(text, `the row ${row.label} is missing`).toContain(row.label);
      expect(text, `the value for ${row.label} is missing`).toContain(row.value);
    }
    /* A row that reports nothing three times reports nothing: an empty side says one word. */
    for (const row of demoWorldDiff.rows) {
      expect(row.value).not.toMatch(/(^|·\s)[+−]?0\b/);
    }
  });

  it("quotes the claims the second compile added, in the compiler's words", () => {
    expect(demoWorldDiff.claims.length).toBeGreaterThan(0);
    for (const claim of demoWorldDiff.claims) {
      expect(text, `the claim ${claim.id} is not printed`).toContain(claim.label);
    }
    /* The story the page tells has to be one of them, or the page and the World disagree. */
    const joined = demoWorldDiff.claims.map((claim) => claim.label).join(" ");
    expect(joined).toContain(signedProductDemo.change.from);
    expect(joined).toContain(signedProductDemo.change.to);
  });

  it("says two complete compiles, and never says a selective rebuild", () => {
    expect(text).toContain("Two complete compiles of the same corpus");
    expect(text).toContain("complete compiles of their corpus");
    /*
      Phrases, not words: "rebuilt" is the diff's own vocabulary and "nothing here was rebuilt in
      place" is the denial this block exists to make, so a rule that bans the word bans the
      sentence that does the work. What is barred is the claim itself.
    */
    for (const barred of ["selective rebuild", "incremental rebuild", "partial rebuild", "recompiled only", "only the changed"]) {
      expect(text.toLowerCase(), `the page says ${barred}`).not.toContain(barred);
    }
    /* And the module that produces the numbers says why it cannot be one. */
    expect(source.toLowerCase()).toContain("no incremental path");
  });

  it("keeps the synthetic-data label inside the frame, not only on the page", () => {
    expect(html).toContain("PUBLIC SAMPLE · SYNTHETIC DATA");
    expect(text).toContain(SIGNED_PRODUCT_DEMO_DISCLOSURE);
    expect(demoWorldDiff.disclosure).toBe(SIGNED_PRODUCT_DEMO_DISCLOSURE);
  });

  it("is on the demo page, and draws nothing", () => {
    const component = readFileSync(
      fileURLToPath(new URL("../components/signed-product-demo.tsx", import.meta.url)),
      "utf8",
    );
    expect(component).toContain("<DemoVersionDiff />");
    const prose = html.replace(/<!--[\s\S]*?-->/g, " ");
    for (const banned of ["<svg", "<canvas", "illustration", "placeholder"]) {
      expect(prose, `the block draws ${banned}`).not.toContain(banned);
    }
  });

  it("claims no accuracy, no throughput and no table structure", () => {
    const lower = text.toLowerCase();
    for (const barred of ["accuracy", "accurate", "per minute", "per second", "throughput", "at scale", "table extraction", "cell"]) {
      expect(lower, `the block says ${barred}`).not.toContain(barred);
    }
  });
});
