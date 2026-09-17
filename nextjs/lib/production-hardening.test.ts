import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("2026-09-05 production hardening", () => {
  it("renders Pricing from the request-time commercial state before hydration", () => {
    const server = read("app/pricing/page.tsx");
    const client = read("components/pricing-page-client.tsx");
    expect(server).toContain('export const dynamic = "force-dynamic"');
    expect(server).toContain("readCommercialState()");
    expect(server).toContain('readAccessMode() === "self_service"');
    expect(client).toContain("useState(initialLiveCheckout)");
    expect(client).toContain("useState(initialSelfService)");
    expect(client.indexOf('className="plans"')).toBeLessThan(client.indexOf('className="usage-estimator"'));
    expect(client).not.toContain('className="plans rv"');
    expect(client).not.toContain('className="usage-estimator rv"');
    expect(client).not.toContain('className="status-fold rv"');
  });

  it("keeps the live legal surfaces dynamic and removes the stale pilot statement from privacy", () => {
    expect(read("app/terms/page.tsx")).toContain('export const dynamic = "force-dynamic"');
    expect(read("app/refunds/page.tsx")).toContain('export const dynamic = "force-dynamic"');
    const privacy = read("app/privacy/page.tsx");
    expect(privacy).not.toContain("controlled private pilot");
    expect(privacy).toContain("production data path for the TAVONEL service");
  });

  it("keeps source intake available after the first World and tells the truth about one-file compiles", () => {
    const workspace = read("app/workspace/page.tsx");
    expect(workspace).not.toContain("!activeWorld && !candidateNeedsDecision ? (");
    expect(workspace).toContain("Add more files while your published knowledge stays available.");
    expect(workspace).toContain("Add more files while the prepared version waits for your review.");
    expect(workspace).toContain("Upload & compile");
    expect(workspace).toContain("Compile one or more ready sources");
    expect(workspace).not.toContain("Compile at least two ready sources");
    expect(workspace).toContain('navigateSurface("connections")');
  });

  /*
    Moved 2026-09-17 with BQ-021/BQ-022/BQ-083, same intent: the workspace shows the real
    lifecycle, from the durable record, the moment a compile exists.

    The four-literal array and the bare WAITING return were
    the shape the stage had when it drew four panes and computed each pane's label from the
    state the job was in this second. Both are gone by design -- one chapter plays at a time,
    its names come from PIPELINE_STAGES, and the label comes from how far the run has got.
  */
  it("shows the real four-stage lifecycle as soon as a durable compile exists", () => {
    const workspace = read("app/workspace/page.tsx");
    const stage = read("components/compile-stage.tsx");
    expect(workspace).toContain("compileJob || pipelineRows.length > 0");
    expect(stage).toContain("state?: CompileState | null");
    // Four chapters, and a position in them taken from the job record.
    expect(stage).toContain("const STAGE_OF_STATE: Record<CompileState, number>");
    expect(stage).toContain("PIPELINE_STAGES.forEach((stage, i)");
    expect(stage).toContain('stopped ? "STOPPED" : "WAITING"');
  });

  /*
    Moved 2026-09-17 with BQ-025: "Add sources" is no longer in this list because it was one of
    four controls performing one act. The drop box directly below the completion panel is that
    control, and the panel's job -- making the export and the evidence reachable rather than
    buried -- is what is still asserted here.
  */
  it("makes completion actions explicit instead of burying the export", () => {
    const workspace = read("app/workspace/page.tsx");
    for (const label of ["Open World", "Ask", "Download signed package", "View evidence", "Verify export"]) {
      expect(workspace, label).toContain(label);
    }
    // And the act the panel no longer duplicates still has its one control on the same screen.
    expect(workspace).toContain('id="workspace-intake-title"');
  });

  it("prevents empty grid cells and document-wide mobile code overflow", () => {
    const css = read("app/tavonel.css");
    expect(css).toContain(".input-formats > :last-child:nth-child(odd)");
    expect(css).toContain(".tiles > :last-child:nth-child(odd)");
    expect(css).toContain(".source-routes {");
    expect(css).toContain(".source-route {");
    expect(css).toContain(".docs-code { width: 100%; max-width: 100%; min-width: 0;");
    expect(css).toContain(".docs-endpoint { width: 100%; max-width: 100%; min-width: 0;");
  });

  it("removes the desktop provenance tether from the narrow Explore composition", () => {
    const css = read("components/world-visual/world-visual.module.css").replace(/\r\n/g, "\n");
    const narrow = css.slice(css.indexOf("@media (max-width: 820px)"));
    expect(narrow).toContain(".tether { display: none; }");
    expect(narrow).toContain(".edges { display: none; }");
  });

  /*
    The substrings moved with the 2026-09-11 IA redesign, and what they guard did not.

    The check was `PRIMARY_NAV.map` in the phone component, from when the panel was that flat
    list. The panel is now the four `NAV_GROUPS` as nested disclosures, so the old substring
    would pass on a component that had stopped rendering any navigation at all -- it is the
    group source that has to be named. `display: block` at the breakpoint stays: that one rule
    is the difference between a phone having a menu and a phone having none.
  */
  it("keeps a reachable mobile primary navigation instead of removing the information architecture", () => {
    const css = read("app/tavonel.css");
    const nav = read("components/mobile-primary-nav.tsx");
    expect(css).toContain(".mobile-primary-nav { display: block; }");
    expect(nav).toContain("CUSTOMER_NAV.map");
    expect(nav).toContain('aria-label="Mobile sections"');
    // The accordion is a disclosure, not a dialog: Tab must leave it. A focus trap imported here
    // would pass every geometry assertion in the suite. The import, not the word: both
    // components explain in prose why they do not reach for that hook.
    expect(nav).not.toContain("from \"@/components/world-visual/use-dialog-focus\"");
  });

  it("keeps the simplified desktop section row as direct links, not false menu controls", () => {
    const nav = read("components/site-nav/desktop-primary-nav.tsx");
    expect(nav).toContain("CUSTOMER_NAV.map");
    expect(nav).toContain('aria-label="Sections"');
    // `aria-expanded`/`aria-controls` on a `<button>`, and no `role="menu"` promising arrow keys
    // this navigation does not implement.
    expect(nav).toContain("href={item.href as Route}");
    expect(nav).toContain("aria-current=");
    expect(nav).not.toContain("role=\"menu\"");
    expect(nav).not.toContain("from \"@/components/world-visual/use-dialog-focus\"");
  });

  /*
    The compact intake keeps a drop affordance. Founder report, 2026-09-06.

    The hierarchy pass shrank `.workspace-intake` to a one-row bar as soon as a source exists,
    and the toolbar rule in `ux-polish.css` gave it the plain hairline and a transparent ground.
    The section still accepts drops, so what it lost was only the ability to say so: the founder
    saw the full drop zone while documents were still null and could not find where files went
    once the first one loaded. The `[data-active="true"]` highlight went with it, outranked by
    the more specific toolbar selector, so dragging over the bar gave no feedback either.

    Both halves are asserted, because either one alone leaves the bar unreadable as a target.
  */
  /*
    Moved 2026-09-17 with BQ-023/D6, and the intent is now stronger than the rule it replaces.

    This used to assert that a returning workspace's intake kept a dashed edge, because a
    dashed edge was the cheapest thing left that still said "target" after two passes had
    compacted the box into an action bar. The box is not compacted any more: it is a real box
    with a solid border on its own ground at every width, which is what the dashed edge was
    standing in for. The assertions move to the sheet that now owns the geometry.
  */
  it("keeps the workspace intake readable as a drop target", () => {
    // Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
    const css = read("app/workspace-no1.css").replace(/\r\n/g, "\n");
    const polish = read("app/workspace-final-polish.css").replace(/\r\n/g, "\n");
    // A visible border and a ground of its own, never a bare hairline rule.
    expect(css).toContain("border: 1px solid var(--hairline-hi); border-radius: var(--ws-radius); background: var(--g1);");
    // The drag highlight still wins over the returning-workspace variant.
    expect(css).toContain('.one-path-workspace .workspace-intake[data-active="true"] { border-color: var(--verified); background: var(--verified-deep); }');
    // A returning workspace gets a shorter box, not a toolbar.
    expect(css).toContain('.one-path-workspace .workspace-intake[data-existing-documents="1"] .workspace-intake-copy { min-height: 200px; }');
    expect(css).not.toContain("var(--text-xlo)");
    // And nothing compacts it back by reading an English button title.
    expect(polish).not.toContain(':has(.document-meta li) .workspace-intake');
    expect(polish.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("button[title^=");
  });

  it("removes the full-viewport floor from short landing scenes but keeps the film immersive", () => {
    const css = read("app/ux-120-final.css");
    expect(css).toContain(".landing-page .scene:not(.film)");
    expect(css).toContain("min-height: auto");
    expect(css).toContain(".landing-page .scene.film { min-height: 100svh");
  });

  it("centres the wide compile film instead of pushing it beyond the viewport", () => {
    const css = read("app/ux-120-final.css");
    expect(css).toContain("--compile-film-width: min(94vw, 1580px)");
    expect(css).toContain("calc((100% - var(--compile-film-width)) / 2)");
    expect(css).not.toContain("min(94vw, 1580px)) / 2 * -1");
    expect(css).toContain("--compile-film-width: min(94vw, 1700px)");
  });

  it("does not sell collaboration that has not shipped", () => {
    const catalog = read("lib/billing-catalog.ts");
    expect(catalog).not.toContain("Shared workspace onboarding");
    expect(catalog).toContain("Guided corpus onboarding");
    expect(catalog).toContain('saleChannel: "contact"');
  });

  it("has one definitive Knowledge Compiler URL and production-gates capture routes", () => {
    const redirect = read("app/product/knowledge-compiler/page.tsx");
    expect(redirect).toContain('permanentRedirect("/knowledge-compiler")');
    expect(read("app/sitemap.ts")).not.toContain('"/product/knowledge-compiler"');
    expect(read("app/dev/layout.tsx")).toContain('process.env.VERCEL_ENV === "production"');
    expect(read("app/film/layout.tsx")).toContain('process.env.VERCEL_ENV === "production"');
  });

  /*
    Two of the four lines below moved with the facts they pinned, in the 2026-09-16 site review.

    `/product/continuous-knowledge` was barred here because `app/robots.ts` disallowed it while it
    was a `notFound()` stub. It is a published page in the sitemap now, robots.txt no longer
    withholds it, and `lib/seo-surface.test.ts` reads the three files against each other -- so
    keeping the ban would have been this file enforcing the old state against the new one.

    "self-service evaluation" went for the opposite reason. G1-001: `activationPolicy.customerData`
    is closed, so a line telling a model that TAVONEL offers self-service evaluation described a
    compile this deployment refuses. What replaces it is the deployment-state sentence the header,
    /pricing, /security and /status all render, so the file a model reads and the page a person
    reads say the same thing.
  */
  it("does not tell language models that the live service is a private pilot", () => {
    const llms = read("public/llms.txt");
    expect(llms).not.toContain("TAVONEL is a private pilot");
    expect(llms).not.toContain("https://tavonel.com/film");
    expect(llms, "the gate is stated to models in the same words it is stated to readers")
      .toContain("arranged with us rather than opened by a checkout");
    expect(llms, "and no self-service compile is offered while it is closed")
      .not.toContain("self-service evaluation");
  });
});
