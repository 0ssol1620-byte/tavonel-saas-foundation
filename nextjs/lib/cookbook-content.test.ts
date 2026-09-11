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
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";

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

  it("quotes the World Build scope as DRAFT and prices none of it", () => {
    const next = findCookbook("documents-to-grounded-work")!.sections.find((section) => section.key === "next")!;
    // The offer's own structure line, quoted rather than paraphrased into a promise.
    expect(next.body).toContain("customer provides representative corpus, TAVONEL compiles");
    expect(next.body).toContain("one update/change test");
    expect(next.body, "the commercial terms are a founder decision and must read as DRAFT").toContain("DRAFT");
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
