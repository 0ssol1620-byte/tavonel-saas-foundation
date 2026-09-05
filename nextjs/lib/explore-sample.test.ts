import { createHash } from "node:crypto";
import { readFileSync as read } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCUMENTS, extractRegions, renderPdf } from "../scripts/build-explore-sample.mjs";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleAnswers,
  exploreSampleArtifact,
  exploreSampleDocuments,
  exploreSampleInputs,
  exploreSampleWorld,
} from "./explore-sample";
import { validateCollectionOcrInput } from "./collection-compiler";

/*
  The Explore page's provenance, checked against the files it claims to come from.

  This is the test the previous sample could not have had. Its `SOURCE.digest` was
  `sha256:3e118d4e...bf1c` and its bbox was `[118, 214, 886, 374]`, for a PDF that was not in
  the repository -- there was nothing to compare them to, which is exactly what made them
  possible to write. Now there is: three committed PDFs, and every number on the page traceable
  back into them.

  The chain each test covers one link of:

     script  ->  committed PDF bytes  ->  extracted regions  ->  compiler  ->  read model  ->  page

  A break anywhere fails here rather than shipping a page that looks authoritative and is not.
*/

const sampleDirectory = fileURLToPath(new URL("../public/explore-sample/", import.meta.url));

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the committed PDFs are what the generator makes", () => {
  it.each(DOCUMENTS.map((document: { filename: string }) => document.filename))(
    "reproduces %s byte for byte",
    (filename) => {
      const document = DOCUMENTS.find((item: { filename: string }) => item.filename === filename)!;
      const committed = read(`${sampleDirectory}${filename}`);
      // Byte equality, not "looks similar". A PDF with a creation date in it could not pass
      // this, which is why the generator writes none.
      expect(renderPdf(document).equals(committed)).toBe(true);
    },
  );

  it("binds each input to the sha256 of the file on disk", () => {
    for (const input of exploreSampleInputs) {
      const filename = input.sanitizedKey.slice(input.sanitizedKey.lastIndexOf("/") + 1);
      expect(input.inputSha256).toBe(`sha256:${sha256(read(`${sampleDirectory}${filename}`))}`);
      expect(input.versionKey).toBe(input.inputSha256.replace("sha256:", ""));
    }
  });
});

describe("the geometry was read out of the documents, not written down", () => {
  it.each(exploreSampleInputs.map((input) => input.documentId))("re-extracts %s to the same regions", async (documentId) => {
    const input = exploreSampleInputs.find((item) => item.documentId === documentId)!;
    const filename = input.sanitizedKey.slice(input.sanitizedKey.lastIndexOf("/") + 1);
    const extracted = await extractRegions(read(`${sampleDirectory}${filename}`), documentId);
    const authority = input.regions![0].authority;
    expect(extracted.map((region: object) => ({ ...region, authority }))).toEqual(input.regions);
  }, 15_000);

  it("still satisfies the same input contract the compile API enforces", () => {
    for (const input of exploreSampleInputs) {
      expect(validateCollectionOcrInput(input), input.documentId).not.toBeNull();
    }
  });
});

describe("the World is compiled output", () => {
  it("matches the frozen digest", () => {
    expect(exploreSampleArtifact.manifestDigest).toBe(EXPLORE_SAMPLE_DIGEST);
  });

  it("names the runtime that actually ran", () => {
    /*
      Production compiles come back from the Core service with the Core's receipt. This one is
      the TypeScript compiler in this repository, and says so. Labelling it
      `tavonel-foundation-core-deterministic-v1` would be a Core execution claim with no Core
      execution behind it.
    */
    expect(exploreSampleArtifact.coreExecution.runtime).toBe("tavonel-collection-compiler-ts-v1/explore-sample");
    expect(exploreSampleArtifact.coreExecution.runtime).not.toContain("foundation-core-deterministic");
    expect(exploreSampleArtifact.coreExecution.receipt.candidatePromotion).toBe(false);
  });

  it("declares itself a sample in the read model, not only in the chrome", () => {
    expect(exploreSampleWorld.contract.origin).toBe("deterministic_sample");
    expect(exploreSampleWorld.contract.deterministicSample).toBe(true);
    expect(exploreSampleWorld.world.status).toBe("candidate");
  });

  it("grounds every evidence row in a region of a real page", () => {
    expect(exploreSampleWorld.evidence.length).toBeGreaterThan(0);
    for (const evidence of exploreSampleWorld.evidence) {
      const document = exploreSampleDocuments.find((item) => item.documentId === evidence.sourceId);
      expect(document, evidence.id).toBeTruthy();
      expect(evidence.page).toBeGreaterThanOrEqual(1);
      expect(evidence.page).toBeLessThanOrEqual(document!.pageCount);
      const [left, top, right, bottom] = evidence.bbox;
      expect(left).toBeLessThan(right);
      expect(top).toBeLessThan(bottom);
      expect(bottom).toBeLessThanOrEqual(1000);
      // The excerpt is a slice of the document the compiler was given, not a paraphrase.
      const input = exploreSampleInputs.find((item) => item.documentId === evidence.sourceId)!;
      expect(input.text).toContain(evidence.excerpt);
      expect(evidence.digest).toBe(input.inputSha256);
    }
  });

  it("puts every object it shows on the page behind evidence", () => {
    const shown = exploreSampleWorld.objects.filter((object) => object.type === "Claim" || object.type === "Document");
    expect(shown.length).toBeGreaterThan(5);
    for (const object of shown) {
      expect(object.evidenceRefs.length, object.label).toBeGreaterThan(0);
    }
  });
});

describe("the Ask panel is answered by the retriever", () => {
  it("gets a grounded answer to every question the page offers", () => {
    expect(exploreSampleAnswers.length).toBeGreaterThan(0);
    for (const answer of exploreSampleAnswers) {
      expect(answer.status, answer.question).toBe("grounded");
      expect(answer.citations.length, answer.question).toBeGreaterThan(0);
    }
  });

  it("cites regions that exist in the World, at the same coordinates", () => {
    for (const answer of exploreSampleAnswers) {
      for (const citation of answer.citations) {
        const match = exploreSampleWorld.evidence.find(
          (item) => item.sourceId === citation.sourceId && item.bbox.join(",") === citation.bbox1000.join(","),
        );
        expect(match, `${answer.question} -> ${citation.sourceId}`).toBeTruthy();
        expect(match!.page).toBe(citation.pageNumber1);
      }
    }
  });
});

/** Comments explain the values that were removed and must not count as the values. */
function strip(source: string) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ 	]*\/\/.*$/gm, " ");
}

describe("the page renders the artifact rather than a copy of it", () => {
  const component = strip(read(fileURLToPath(new URL("../components/explore-compiled-world.tsx", import.meta.url)), "utf8"));
  const page = read(fileURLToPath(new URL("../app/explore/page.tsx", import.meta.url)), "utf8");

  it("takes the World as a prop", () => {
    expect(page).toContain("exploreSampleWorld");
    expect(page).toContain("exploreSampleAnswers");
    expect(component).toContain("world.evidence");
  });

  it("hard-codes no digest, no bbox and no page number", () => {
    /*
      The specific regression. Any of these three appearing as a literal in the component means
      a value is being displayed that nothing verified -- which is how `3e118d4e...bf1c` and
      `p.12` came to be on a public page for a file that did not exist.
    */
    expect(component).not.toMatch(/sha256:[0-9a-f]{8}/);
    expect(component).not.toMatch(/bbox:\s*"\[/i);
    expect(component).not.toMatch(/\bp\.\d+\b/);
    expect(component).not.toMatch(/\[\s*\d{2,},\s*\d{2,},\s*\d{2,},\s*\d{2,}\s*\]/);
  });
});
