import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SampleWorldFrame, { SAMPLE_FRAME_LABEL } from "../components/sample-world-frame";
import TrustProvisions from "../components/trust-provisions";
import {
  TRUST_PROVISIONS,
  TRUST_PROVISION_STATES,
  TRUST_PROVISION_STATE_LABEL,
  TRUST_PROVISION_STATE_TOKEN,
  trustProvisionCounts,
  trustProvisionsByState,
} from "../content/trust/provisions";
import { signedProductDemo } from "./signed-product-demo";

/*
  Gaps #6 and #15 of the 2026-09-22 competitor visual audit.

  Three surfaces, one content module, and the two claims the table is forbidden to make. The
  audit's instruction is exact about the second: no badge and no logo for a certification that is
  not held. That is not a copy rule -- a reviewer skimming a trust page reads the shapes before
  the words, and a row of assurance-looking marks is a claim whether or not any sentence makes
  it. So the check is structural: the rendered table may contain no image of any kind.

  The first claim is subtler. A table of provisions is useful only if the absences are in it, and
  the way a page loses them is not by deleting a row -- it is by moving one to "Roadmap" because
  "Not provided" reads badly next to a price. `roadmap` is therefore allowed exactly where the
  site already publishes a named intention, and the assurance row in particular is pinned.
*/

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const provisionsModule = read("content/trust/provisions.ts");

/** The rendered text, with class names and data attributes out of the way. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ");

const html = renderToStaticMarkup(createElement(TrustProvisions, {}));

describe("the Provided / Roadmap / Not provided table", () => {
  it("renders every row from the one content module, in its three states", () => {
    expect(TRUST_PROVISIONS.length).toBeGreaterThan(0);
    for (const row of TRUST_PROVISIONS) {
      expect(html, `${row.id} is not rendered`).toContain(`data-provision-id="${row.id}"`);
      expect(text(html)).toContain(row.subject);
    }
    const counts = trustProvisionCounts();
    for (const state of TRUST_PROVISION_STATES) {
      expect(counts[state], `no row is in the "${state}" state`).toBeGreaterThan(0);
    }
    expect(counts.provided + counts.roadmap + counts.not_provided).toBe(TRUST_PROVISIONS.length);
  });

  it("prints each state as a word, not only as a colour", () => {
    // A chip carrying only a hue is unreadable in monochrome, on a screenshot, and to anyone
    // who does not already know the legend -- which on a procurement page is everyone.
    for (const state of TRUST_PROVISION_STATES) {
      expect(text(html)).toContain(TRUST_PROVISION_STATE_LABEL[state]);
      expect(html).toContain(`data-token="${TRUST_PROVISION_STATE_TOKEN[state]}"`);
    }
    expect(new Set(Object.values(TRUST_PROVISION_STATE_LABEL)).size).toBe(TRUST_PROVISION_STATES.length);
  });

  /*
    The rule the audit states in one line: no badge, no logo for anything not held.

    Checked as "no image at all" rather than as a list of certification names, because the list
    is the part that goes stale. A trust table that needs a picture to make its point is a trust
    table making a point it cannot support in words.
  */
  it("carries no badge, logo or image of any kind", () => {
    for (const marker of ["<img", "<svg", "background-image", "<picture", "url("]) {
      expect(html, `the provisions table renders ${marker}`).not.toContain(marker);
    }
  });

  it("states the assurance report as absent, in the draft agreement's words", () => {
    const assurance = TRUST_PROVISIONS.find((row) => row.id === "third_party_assurance");
    expect(assurance?.state).toBe("not_provided");
    // The one sentence a buyer asks for first, and the one a page is most tempted to soften.
    expect(assurance?.line).toContain("no SOC 2 report");
    expect(assurance?.line).toContain("no ISO 27001 certificate");
    expect(assurance?.line).toContain("no independent penetration-test report");
  });

  it("keeps the recovery objectives and the residency guarantee out of the provided column", () => {
    for (const id of ["recovery_objectives", "data_residency", "uptime_sla", "retention_period", "customer_managed_keys", "roles_sso_seats", "self_hosting"]) {
      const row = TRUST_PROVISIONS.find((candidate) => candidate.id === id);
      expect(row, `${id} is no longer in the table`).toBeDefined();
      expect(row!.state, `${id} moved out of "not provided"`).toBe("not_provided");
    }
    // The signed agreement is the one thing genuinely in progress, and the only roadmap row.
    expect(TRUST_PROVISIONS.filter((row) => row.state === "roadmap").map((row) => row.id)).toEqual(["dpa"]);
  });

  it("points every row at the page that maintains its wording", () => {
    for (const row of TRUST_PROVISIONS) {
      expect(row.source.href, `${row.id} has no source link`).toMatch(/^\/[\w./#-]*$/);
      expect(html).toContain(`>${row.source.label}</a>`);
    }
    // Ids are the test's handle on a row and the page's `data-provision-id`; a duplicate would
    // silently make one of the two rows unaddressable.
    expect(new Set(TRUST_PROVISIONS.map((row) => row.id)).size).toBe(TRUST_PROVISIONS.length);
  });

  it("groups the absences after what is in place", () => {
    const order = trustProvisionsByState().map(([state]) => state);
    expect(order).toEqual(["provided", "roadmap", "not_provided"]);
    const rendered = [...html.matchAll(/data-state-group="(\w+)"/g)].map((match) => match[1]);
    expect(rendered).toEqual(["provided", "roadmap", "not_provided"]);
  });

  /*
    The same rule `lib/public-copy-purge.test.ts` holds over the shared disclosure module, for
    the same reason: this is customer copy that lives outside `components/`, so the walk that
    checks /trust, /security and /enterprise cannot see it.
  */
  it("keeps defensive phrasing out of the content module", () => {
    const source = provisionsModule
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ")
      .toLowerCase();
    for (const phrase of ["no certification", "not a certification", "coming soon", "when qualified", "not supported"]) {
      expect(source, `the provisions carry "${phrase}"`).not.toContain(phrase);
    }
  });
});

describe("the three surfaces render the same rows", () => {
  it.each([
    ["trust", "app/trust/page.tsx"],
    ["security", "app/security/page.tsx"],
    ["enterprise", "app/enterprise/page.tsx"],
  ])("/%s renders the shared table rather than its own copy of it", (_route, file) => {
    const page = read(file);
    expect(page).toContain(`from "@/components/trust-provisions"`);
    expect(page).toContain("<TrustProvisions");
  });

  it("keeps the wording in one module, so a row cannot say two things", () => {
    // If a page ever types a provision's sentence out, the two go out of step the first time
    // one of them is edited. The module is the only file that contains them.
    const assurance = TRUST_PROVISIONS.find((row) => row.id === "third_party_assurance")!;
    for (const file of ["app/trust/page.tsx", "app/security/page.tsx", "app/enterprise/page.tsx"]) {
      expect(read(file)).not.toContain(assurance.line);
    }
  });
});

/*
  Gap #15's other half: the sample is shown, and its label cannot be cropped off it.

  /enterprise carried the words "PUBLIC SAMPLE · SYNTHETIC DATA" above four cards describing a
  demonstration that was not on the page. What replaces it is the real compiled answer from
  `lib/signed-product-demo.ts` -- so the assertions here are that the rendered numbers are that
  module's, not a copy, and that the label sits inside the frame rather than above it.
*/
describe("the public sample frame on /enterprise", () => {
  const frame = renderToStaticMarkup(createElement(SampleWorldFrame, { demo: signedProductDemo }));

  it("renders the real answer, citation and activated revision", () => {
    const citation = signedProductDemo.answer.citation;
    expect(text(frame)).toContain(citation.excerpt);
    expect(frame).toContain(citation.evidenceId);
    expect(text(frame)).toContain(`page ${citation.pageNumber1}`);
    expect(text(frame)).toContain(signedProductDemo.answer.question);
  });

  it("keeps the synthetic-data label inside the frame", () => {
    expect(frame).toContain(SAMPLE_FRAME_LABEL);
    expect(SAMPLE_FRAME_LABEL).toContain("SYNTHETIC DATA");
    /*
      The label is inside `.sample-frame-art`, which is the bordered element. A caption above the
      border is what a crop, a screenshot or a slide paste loses first, and a synthetic sample
      travelling without its label is the failure this whole frame exists to prevent.
    */
    const art = frame.slice(frame.indexOf(`class="sample-frame-art"`));
    const label = art.indexOf(SAMPLE_FRAME_LABEL);
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(art.indexOf("sample-frame-grid"));
  });

  it("draws one evidence region and never a table grid", () => {
    // The capability manifest says `no_table_or_formula_extraction`, so nothing here may render
    // a cell structure -- §7.2 of the audit, and M01's failure in visual form.
    expect(frame).not.toContain("<table");
    expect(frame).not.toContain("<td");
    expect([...frame.matchAll(/sample-frame-region/g)]).toHaveLength(1);
  });

  it("draws the region at the coordinates the citation carries", () => {
    const bbox = signedProductDemo.answer.citation.bbox1000;
    expect(bbox, "the sample citation lost its region").not.toBeNull();
    // Never invent a bbox to satisfy a layout: the rectangle is the compile request's own
    // thousandths, converted to percent, or it is not drawn at all.
    expect(frame).toContain(`left:${bbox![0] / 10}%`);
    expect(frame).toContain(`top:${bbox![1] / 10}%`);
  });

  it("shows a repository fixture, never customer material", () => {
    const cited = signedProductDemo.fixture.sources.find(
      (source) => source.documentId === signedProductDemo.answer.citation.sourceId,
    );
    expect(cited?.href).toMatch(/^\/explore-sample\/fp-200-/);
    expect(read("app/enterprise/page.tsx")).toContain("<SampleWorldFrame");
  });
});

/*
  The 360px frame rule.

  A wide table on a phone has two failure modes and only one of them is visible in a screenshot:
  it pushes the whole page sideways, or it is clipped and the reader never learns there were
  three columns. `.table-scroll` is the wrapper that fixes both, and `display: block` on the
  table itself is the fix that breaks it -- a table laid out as a block stops being announced as
  rows and columns at all. So the geometry is asserted as three separate facts about the CSS and
  the markup rather than by measuring a rendered width, which needs a browser and a build.
*/
describe("the new tables sit in a horizontal-scroll frame at 360px", () => {
  const css = read("app/tavonel.css");

  it("wraps the provisions table in the scroll frame, not the table itself", () => {
    const wrapper = html.indexOf(`class="table-scroll"`);
    expect(wrapper).toBeGreaterThan(-1);
    expect(wrapper).toBeLessThan(html.indexOf("<table"));
    expect(html).toContain("docs-table trust-provisions");
  });

  it("labels every cell, which is what makes a row stack instead of scroll", () => {
    // `.docs-table:has(td[data-label])` stacks below 620px. A cell without `data-label` becomes
    // an unlabelled value in a list, which is the same as not publishing the column.
    const cells = [...html.matchAll(/<(?:td|th)\b([^>]*)>/g)].map((match) => match[1]);
    const body = cells.filter((attributes) => !attributes.includes('scope="col"'));
    expect(body.length).toBeGreaterThan(0);
    for (const attributes of body) {
      expect(attributes, `a provisions cell has no data-label: ${attributes}`).toContain("data-label=");
    }
  });

  it("keeps the scroll on the wrapper and the table semantics on the table", () => {
    expect(css).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.docs-table\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/@media \(max-width: 620px\)[\s\S]{0,400}\.docs-table:has\(td\[data-label\]\) \{ display: block; \}/);
  });

  it("stacks the sample frame's two columns rather than scrolling them", () => {
    // 148px of page proxy beside a column of prose is two unreadable columns at 360px.
    expect(css).toMatch(/@media \(max-width: 620px\)[\s\S]{0,300}\.sample-frame-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
});
