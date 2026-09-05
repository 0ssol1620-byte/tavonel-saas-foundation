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
    expect(workspace).toContain("Add more knowledge without losing access to the World you already have.");
    expect(workspace).toContain("Upload & compile");
    expect(workspace).toContain("Compile one or more ready sources");
    expect(workspace).not.toContain("Compile at least two ready sources");
    expect(workspace).toContain('navigateSurface("connections")');
  });

  it("shows the real four-stage lifecycle as soon as a durable compile exists", () => {
    const workspace = read("app/workspace/page.tsx");
    const stage = read("components/compile-stage.tsx");
    expect(workspace).toContain("compileJob || pipelineRows.length > 0");
    expect(stage).toContain('["sources", "read", "structure", "world"]');
    expect(stage).toContain("state?: CompileState | null");
    expect(stage).toContain('return "WAITING"');
  });

  it("makes completion actions explicit instead of burying the export", () => {
    const workspace = read("app/workspace/page.tsx");
    for (const label of ["Open World", "Ask", "Download signed package", "View evidence", "Verify export", "Add sources"]) {
      expect(workspace, label).toContain(label);
    }
  });

  it("prevents empty grid cells and document-wide mobile code overflow", () => {
    const css = read("app/tavonel.css");
    expect(css).toContain(".input-formats > :last-child:nth-child(odd)");
    expect(css).toContain(".tiles > :last-child:nth-child(odd)");
    expect(css).toContain(".docs-code { width: 100%; max-width: 100%; min-width: 0;");
    expect(css).toContain(".docs-endpoint { width: 100%; max-width: 100%; min-width: 0;");
  });

  it("keeps a reachable mobile primary navigation instead of removing the information architecture", () => {
    const css = read("app/tavonel.css");
    const nav = read("components/mobile-primary-nav.tsx");
    expect(css).toContain(".mobile-primary-nav { display: block; }");
    expect(nav).toContain("PRIMARY_NAV.map");
    expect(nav).toContain('aria-label="Mobile sections"');
  });

  it("removes the full-viewport floor from short landing scenes but keeps the film immersive", () => {
    const css = read("app/ux-120-final.css");
    expect(css).toContain(".landing-page .scene:not(.film)");
    expect(css).toContain("min-height: auto");
    expect(css).toContain(".landing-page .scene.film { min-height: 100svh");
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

  it("does not tell language models that the live service is a private pilot", () => {
    const llms = read("public/llms.txt");
    expect(llms).not.toContain("TAVONEL is a private pilot");
    expect(llms).not.toContain("/product/continuous-knowledge");
    expect(llms).not.toContain("https://tavonel.com/film");
    expect(llms).toContain("self-service evaluation");
  });
});
