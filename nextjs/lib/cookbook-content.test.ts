import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { BILLING_OFFERS } from "./billing-catalog";
import {
  COOKBOOKS,
  COOKBOOK_SLUGS,
  READING_LIMIT_SENTENCE,
  RECIPE_VERSION,
  SECTION_ORDER,
  docsSectionTitle,
  findCookbook,
  orderedSections,
  referencedDocsSlugs,
} from "./cookbook-content";
import { COOKBOOK_WORKFLOW_IDS } from "./keyword-map";
import { PACKAGE_CONTRACT } from "../scripts/journey/acceptance-checker.mjs";
import { CAPABILITY_MANIFEST, TEXT_INPUTS_LIVE } from "../../shared/capabilityManifest";

/*
  WG-045/058-063/074/076/077/086/088/089.

  What this file is for is narrower than "the cookbooks are correct". It cannot know whether a
  sentence is good copy. What it can know, and what nothing else in the repository would catch,
  is the class of failure the blueprint names: a draft that starts to look like a finished case.
  Every assertion below is one of those -- a locked section growing a body, a record acquiring a
  verified date nobody earned, a price or a percentage appearing in prose, a draft becoming
  indexable, a limit being dropped from the prerequisites that sit above the calls to action.

  The run-dependent half of these pages is meant to fail this suite the day it is filled in
  without a receipt, and to be *changed* -- deliberately, with the run named -- the day there is
  one. A green suite here means the drafts still say only what a build with no run can say.
*/

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const PAGE = read("app/cookbooks/[slug]/page.tsx");

/** The six sections whose content is a property of a run, and therefore locked until there is one. */
const RUN_DEPENDENT = ["input", "ui", "output", "provenance", "external", "effect"] as const;

describe("cookbook records", () => {
  it("holds the six priority packages, each its own recipe", () => {
    expect(COOKBOOKS.map((record) => record.slug)).toEqual([...COOKBOOK_SLUGS]);
    for (const record of COOKBOOKS) {
      expect(record.recipeId, `${record.slug}: the recipe is the cookbook`).toBe(record.slug);
      expect(record.recipeVersion).toBe(RECIPE_VERSION);
      expect(record.title.length).toBeGreaterThan(20);
      expect(record.title.length, `${record.slug}: the title is also the <title>`).toBeLessThanOrEqual(72);
    }
  });

  it("resolves a known slug and refuses an unknown one", () => {
    expect(findCookbook("documents-to-grounded-work")?.title).toBeTruthy();
    expect(findCookbook("documents-to-grounded-work-2")).toBeNull();
  });

  it("carries all twelve sections once each, in the template's order", () => {
    for (const record of COOKBOOKS) {
      expect(record.sections).toHaveLength(SECTION_ORDER.length);
      expect(orderedSections(record).map((section) => section.key)).toEqual([...SECTION_ORDER]);
      expect(new Set(record.sections.map((section) => section.key)).size).toBe(SECTION_ORDER.length);
    }
  });

  it("throws rather than rendering eleven sections when one is missing", () => {
    const broken = {
      ...COOKBOOKS[0]!,
      sections: COOKBOOKS[0]!.sections.filter((section) => section.key !== "limits"),
    };
    expect(() => orderedSections(broken)).toThrow(/missing the limits section/);
  });
});

describe("locked sections carry nothing to print", () => {
  it("gives every locked section a reason and an empty body", () => {
    for (const record of COOKBOOKS) {
      for (const section of record.sections) {
        if (section.status !== "locked") continue;
        expect(section.body, `${record.slug}/${section.key}: a locked section with a body is a placeholder`).toBe("");
        expect(section.lockedReason.length, `${record.slug}/${section.key}: no reason given`).toBeGreaterThan(40);
      }
    }
  });

  it("gives every ready section a body and no reason", () => {
    for (const record of COOKBOOKS) {
      for (const section of record.sections) {
        if (section.status !== "ready") continue;
        expect(section.body.length, `${record.slug}/${section.key}`).toBeGreaterThan(60);
        expect(section).not.toHaveProperty("lockedReason");
      }
    }
  });

  it("keeps every run-dependent section locked while no run exists", () => {
    for (const record of COOKBOOKS) {
      for (const key of RUN_DEPENDENT) {
        const section = record.sections.find((candidate) => candidate.key === key)!;
        expect(
          section.status,
          `${record.slug}/${key} is ready: either a run was recorded, in which case say which one here, or this is a fabricated result`,
        ).toBe("locked");
      }
    }
  });

  it("records no verified run, no claim and no cleared source", () => {
    for (const record of COOKBOOKS) {
      expect(record.lastVerifiedAt, `${record.slug}: a verified date needs a run`).toBeNull();
      expect(record.verifiedBuild).toBeNull();
      // Claim ids bind a sentence to a receipt. A draft with no run has nothing to bind, and the
      // claims registry has no id namespace yet (keyword-claims-data lane).
      expect(record.claims, `${record.slug}: a claim id without a verified run`).toEqual([]);
      expect(record.sourceRights, `${record.slug}: no corpus has cleared rights`).toBe("unverified");
    }
  });

  it("prints no price and no percentage in any body", () => {
    for (const record of COOKBOOKS) {
      for (const section of record.sections) {
        expect(section.body, `${record.slug}/${section.key}: prices live on /pricing`).not.toMatch(/\$\s?\d/);
        expect(section.body, `${record.slug}/${section.key}: a percentage needs a measurement`).not.toMatch(/\d\s?%/);
      }
    }
  });

  it("keeps every outcome short enough to be the page description", () => {
    for (const record of COOKBOOKS) {
      const outcome = record.sections.find((section) => section.key === "outcome")!;
      expect(outcome.body.length, `${record.slug}: the outcome is the meta description`).toBeLessThanOrEqual(200);
    }
  });
});

describe("the limits are read from the product, and sit above the calls to action", () => {
  it("derives the reading limit from the capability manifest", () => {
    const pdf = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === "application/pdf")!;
    expect(pdf.knownLimitations as readonly string[]).toContain("no_table_or_formula_extraction");
    expect(pdf.knownLimitations as readonly string[]).toContain("no_native_structure_reader_yet");
    // The sentence the pages carry, in the form those two limitations produce. A manifest change
    // that makes it false fails here instead of leaving a promise on six pages.
    expect(READING_LIMIT_SENTENCE).toContain("not extracted as tables");
    expect(READING_LIMIT_SENTENCE).toContain("not recovered as typed structure");
    expect(READING_LIMIT_SENTENCE).toContain("80 pages");
    /*
      The whole list, not only the two the sentence derives from.

      A limitation added to the manifest would not appear in this copy on its own -- the sentence
      names the two it knows about -- and a limit the product has and the cookbook does not
      mention is the failure these pages exist to avoid. Pinning the set makes that a failing
      test and a copy decision rather than six pages quietly going stale.
    */
    expect(pdf.knownLimitations, "a new reading limit needs a sentence in cookbook-content.ts").toEqual([
      "read_through_cdr_sanitized_pdf_and_ocr",
      "no_native_structure_reader_yet",
      "no_table_or_formula_extraction",
      "no_visual_native_reconciliation",
      "at_most_5_mib_per_source",
      "at_most_80_pages_per_source",
    ]);
  });

  it("puts that limit in the prerequisites and the limits of every record", () => {
    for (const record of COOKBOOKS) {
      for (const key of ["prerequisites", "limits"] as const) {
        const section = record.sections.find((candidate) => candidate.key === key)!;
        expect(section.body, `${record.slug}/${key} does not carry the reading limit`).toContain(READING_LIMIT_SENTENCE);
      }
    }
  });

  it("names the plan that activation needs, and how it is sold", () => {
    const team = BILLING_OFFERS.studio_access;
    expect(team.saleChannel, "if Team becomes self-serve the activation sentence must be re-read").toBe("contact");
    for (const record of COOKBOOKS) {
      const prerequisites = record.sections.find((section) => section.key === "prerequisites")!;
      expect(prerequisites.body, `${record.slug}: the activation plan is not named`).toContain(team.label);
      expect(prerequisites.body).toContain("rather than self-serve checkout");
    }
  });

  it("summarises the World Build scope as DRAFT, prices none of it, and invents no deal term", () => {
    const next = findCookbook("documents-to-grounded-work")!.sections.find((section) => section.key === "next")!;
    // The offer's own step names, flattened into a sentence rather than softened into a promise.
    expect(next.body).toContain("customer provides representative corpus, TAVONEL compiles");
    expect(next.body).toContain("one update/change test");
    expect(next.body, "the commercial terms are a founder decision and must read as DRAFT").toContain("DRAFT");
    /*
      The repair. `WORLD_BUILD_OFFER.md` marks exactly three commercial terms FOUNDER DECISION --
      the fee, whether the fee credits against a plan, and the minimum corpus and engagement. A
      page naming a fourth attributes a deal term to a file that does not contain it, which is the
      same act as writing a price, so the ones that were invented once are pinned here.
    */
    for (const invented of ["support hours", "revision count", "refund"]) {
      expect(next.body.toLowerCase(), `${invented}: not a term the offer file carries`).not.toContain(invented);
    }
  });

  it("orders the template so prerequisites and limits precede the next action", () => {
    const index = (key: string) => SECTION_ORDER.indexOf(key as (typeof SECTION_ORDER)[number]);
    expect(index("prerequisites")).toBeLessThan(index("next"));
    expect(index("limits")).toBeLessThan(index("next"));
    // And on the page itself: the action row is rendered after the section body.
    expect(PAGE.indexOf("docs-body")).toBeLessThan(PAGE.indexOf('className="actions"'));
  });

  it("points every code section at a documentation section that exists", () => {
    const referenced = referencedDocsSlugs();
    expect(referenced.length).toBeGreaterThan(2);
    for (const slug of referenced) expect(docsSectionTitle(slug), `/docs/${slug} does not exist`).toBeTruthy();
    expect(docsSectionTitle("quickstart-v2"), "the check would pass anything").toBeNull();
  });
});

describe("the route publishes a draft as a draft", () => {
  it("keeps every record in draft while the site has no approved-cookbook mechanism", () => {
    for (const record of COOKBOOKS) {
      expect(
        record.publication,
        `${record.slug}: approving a cookbook also means a sitemap ROUTES entry and a seo-surface.test.ts case (seo-i18n lane), not only this field`,
      ).toBe("draft");
    }
  });

  it("declares noindex on the route and stays out of the sitemap and llms.txt", () => {
    expect(PAGE).toMatch(/robots:.*index: false/s);
    expect(sitemap().map((entry) => new URL(entry.url).pathname).filter((path) => path.startsWith("/cookbooks"))).toEqual([]);
    expect(read("public/llms.txt")).not.toContain("/cookbooks");
  });

  it("renders every body through the sanitiser and opens no raw-HTML sink", () => {
    expect(PAGE).toContain("sanitizeDocumentText(paragraph)");
    expect(PAGE).toContain("sanitizeDocumentText(section.lockedReason)");
    // `lib/output-escaping.test.ts` holds this app to two raw-HTML sinks. The breadcrumb component
    // is one of them; this page adds none, and adding one is that file's decision, not this one's.
    expect(PAGE).not.toContain("dangerouslySetInnerHTML");
    expect(PAGE, "structured data beyond the breadcrumb needs a real verified date").not.toContain("@type");
  });

  it("shows no image, no video and no email gate", () => {
    for (const pattern of ["<img", "<Image", "<video", "next/image", "<form", 'type="email"']) {
      expect(PAGE, `${pattern}: a capture must be real, and the substance of a cookbook is never gated`)
        .not.toContain(pattern);
    }
  });
});

describe("the copy guards cover the new surfaces", () => {
  it("registers both files where public copy is checked", () => {
    const brand = read("lib/brand-copy.test.ts");
    expect(brand).toContain('"lib/cookbook-content.ts"');
    expect(brand).toContain('"app/cookbooks/[slug]/page.tsx"');
  });

  it("registers the route as a sales surface", () => {
    expect(read("lib/public-copy-purge.test.ts")).toContain('"cookbooks/[slug]"');
  });

  it("registers the content as a claim surface", () => {
    expect(read("lib/product-claims-sync.test.ts")).toContain('"lib/cookbook-content.ts"');
  });
});

/*
  B4. What a `claims` entry has to be able to resolve to.

  The assertion above says a draft with no run carries no claim id. This says what a claim id will
  have to satisfy the day one is added, because the registry moved into this repository during this
  campaign (`docs/gtm/CLAIMS_REGISTRY.yaml`, keyword-claims-data lane) and until now nothing in CI
  read it. An id that resolves to no row, or to a row whose `artifact` is `none`, is a citation that
  looks like a receipt and is not one -- which is the failure mode a registry exists to prevent.

  Three conditions, all of them on the record's side except the first:

    the id exists in the registry,
    the row names an artifact an auditor can open rather than `none`,
    and the record itself records the run -- `lastVerifiedAt` and `verifiedBuild` both set.

  The third is the one that is easy to skip. A registry row can be true of the build while the
  cookbook citing it has never been run, and a cookbook's claims are claims about its own workflow.

  The registry is read as text rather than parsed: this repository has no YAML parser in `lib/`,
  the two facts needed are one field each, and adding a dependency to read two lines is the trade
  this file would lose.
*/
describe("a claim id on a record resolves to a receipt", () => {
  const registry = read("../docs/gtm/CLAIMS_REGISTRY.yaml");
  const rows = new Map(
    [...registry.matchAll(/^ {2}- claimId: (CLM-\d{3})\r?$([\s\S]*?)(?=^ {2}- claimId:|\Z)/gm)].map(
      ([, id, body]) => [id!, body!],
    ),
  );
  const resolvesToAnArtifact = (id: string) => {
    const body = rows.get(id);
    if (body === undefined) return false;
    const artifact = /^ {4}artifact: "?([^"\r\n]+)"?\r?$/m.exec(body)?.[1]?.trim();
    return artifact !== undefined && !artifact.startsWith("none");
  };

  it("reads the registry it is asserting against", () => {
    // If the shape of the file changes, this test must fail loudly rather than pass over an empty
    // map -- a lookup that resolves nothing would accept every id, which is the inverse of its job.
    expect(rows.size).toBeGreaterThanOrEqual(44);
    expect(resolvesToAnArtifact("CLM-001"), "CLM-001 names an artifact and must resolve").toBe(true);
    expect(resolvesToAnArtifact("CLM-999"), "an id that is in no row must not resolve").toBe(false);
  });

  it("holds every record's claim ids to it", () => {
    for (const record of COOKBOOKS) {
      for (const id of record.claims) {
        expect(resolvesToAnArtifact(id), `${record.slug} cites ${id}, which resolves to no artifact`).toBe(true);
        expect(record.lastVerifiedAt, `${record.slug} cites ${id} with no run of its own recorded`).not.toBeNull();
        expect(record.verifiedBuild, `${record.slug} cites ${id} with no build recorded`).not.toBeNull();
      }
    }
  });

  /*
    And the two things spelled "workflow" that must not merge. A keyword row's `workflow_id` is the
    work package -- one of the six slugs -- and that is the join from `lib/keyword-map.ts` to a
    cookbook. A record's own `workflowId` is which of the blueprint's three journeys it
    demonstrates. Same word, different vocabulary, and a reader who joins on the wrong one gets an
    empty result rather than an error.
  */
  it("keeps the keyword join key and the journey id apart", () => {
    for (const record of COOKBOOKS) {
      expect(COOKBOOK_WORKFLOW_IDS, `${record.slug} is the keyword join key`).toContain(record.slug);
      expect(
        [...COOKBOOK_WORKFLOW_IDS] as string[],
        `${record.slug}: the journey id is not a keyword workflow id`,
      ).not.toContain(record.workflowId);
      expect(record.workflowId).toMatch(/^j[123]-/);
    }
  });
});

/*
  B6. WG-055's cookbook half, which was blocked on this file existing.

  The journey lane closed the harness half: step 13 downloads the signed archive and checks it
  against `PACKAGE_CONTRACT`, the eleven paths a customer download must carry. The other half of
  WG-055's wording -- "matches the actual cookbook output" -- had nothing to compare against,
  because no cookbook record existed on that branch. It does now.

  What is wired is exactly that and no more. The records' `output` sections are locked, so no
  record promises a file list yet and there is no list to diff; what a record *does* already do is
  name package files in prose (the J2-file record names README and AGENTS), and a prose filename is
  a promise about a download just as much as a list would be. So every package filename any body
  names is held to the contract. It binds before the copy ships, which is the point of writing it
  now rather than the day the output sections open.

  The requested patch was `record.outputFiles ?? []`; there is no such field on `CookbookRecord`
  and inventing one to hold a list nothing can fill would be a field with no run behind it. When
  the output sections do open, the list belongs in the section body this test already reads.
*/
describe("a cookbook promises no file the download route does not write", () => {
  /*
    Package files as a body can name them: a bare `README`/`AGENTS` (how the prose refers to them)
    or a `<dir>/<name>.<ext>` path in one of the package's own formats. Not a bare `.json` --
    `manifest.json` on its own is as likely to be a caller's file as a package member, and a guess
    either way would make this test about the regex rather than about the contract.
  */
  const PACKAGE_FILE = /\b(README|AGENTS)\b(?:\.md)?|\b[a-z]+\/[a-z-]+\.(?:jsonld|ttl|csv|jsonl|json)\b/g;
  const normalise = (match: string) => (match === "README" || match === "AGENTS" ? `${match}.md` : match);

  it("reads the contract it is asserting against", () => {
    expect(PACKAGE_CONTRACT).toContain("README.md");
    expect(PACKAGE_CONTRACT).toContain("manifest/ai-entrypoint.json");
    expect(PACKAGE_CONTRACT).toHaveLength(11);
  });

  it("names only contract paths, in every body of every record", () => {
    let named = 0;
    for (const record of COOKBOOKS) {
      for (const section of orderedSections(record)) {
        for (const [match] of section.body.matchAll(PACKAGE_FILE)) {
          named += 1;
          expect(
            PACKAGE_CONTRACT,
            `${record.slug}/${section.key} names ${match}, which no download carries`,
          ).toContain(normalise(match));
        }
      }
    }
    // The J2-file record names two of them today. A zero here means the extraction stopped working
    // and the test became an assertion about nothing.
    expect(named, "no package filename found in any body -- the extraction has gone blind").toBeGreaterThan(0);
  });

  it("keeps the output sections locked, so there is no file list to diff yet", () => {
    for (const record of COOKBOOKS) {
      const output = orderedSections(record).find((section) => section.key === "output")!;
      expect(output.status, `${record.slug}: an output list is a claim about a run`).toBe("locked");
    }
  });
});

/*
  B10 / keyword-claims-data CROSS-LANE 2, the CLM-045 half.

  `TEXT_INPUTS_LIVE` is `false`, so TXT, CSV and HTML are declared in the manifest and withheld
  from `CAPABILITY_MANIFEST.entries`. The claims registry records that as CLM-045 (INTERNAL) with
  four limitations no public sentence covers -- correct while the gate is closed, and a copy defect
  on the day it opens. A cookbook naming one of those formats as an input would be advertising a
  capability this deployment does not ship.

  The accepted-format sentence is already derived (`describeAcceptedFormats`), so it cannot drift.
  This is about the other kind of mention: a prose line in a body saying "export it as CSV first",
  which no derivation covers and which would be the same claim in a softer voice. It is a format
  name as an input, so the pattern is anchored on the word, not on a file extension -- `.csv`
  inside `graph/relationships.csv` is a package member and is B6's business, not this one.
*/
describe("no cookbook offers an input the manifest withholds", () => {
  it("holds while the text gate is closed", () => {
    expect(TEXT_INPUTS_LIVE, "the gate opened: these sentences are now a copy task, not a guard").toBe(false);
    // The formats the gate withholds, read from the manifest rather than listed here.
    const shipped = CAPABILITY_MANIFEST.entries.flatMap((entry) => entry.extensions);
    for (const withheld of ["txt", "csv", "html", "htm"]) expect(shipped).not.toContain(withheld);
  });

  it.each(["TXT", "CSV", "HTML"])("names %s in no body", (format) => {
    for (const record of COOKBOOKS) {
      for (const section of orderedSections(record)) {
        expect(
          section.body,
          `${record.slug}/${section.key} names ${format} while TEXT_INPUTS_LIVE is false (CLM-045)`,
        ).not.toMatch(new RegExp(`\\b${format}\\b`));
      }
    }
  });
});
