import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CUSTOMER_NAV, customerNavOwns } from "./site-navigation";
import films from "./locked-film-assets.json";

const text = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

describe("approved one-path experience", () => {
  it("has exactly three shared customer destinations", () => {
    expect(CUSTOMER_NAV).toEqual([
      { href: "/product", label: "How it works" },
      { href: "/integrations", label: "Connect" },
      { href: "/pricing", label: "Pricing" },
    ]);
    expect(text("components/site-nav/desktop-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
    expect(text("components/mobile-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
  });
  it("does not confuse a prefix with an unrelated route", () => {
    expect(customerNavOwns("/product", "/product/document-intelligence/")).toBe(true);
    expect(customerNavOwns("/product", "/productivity")).toBe(false);
    expect(customerNavOwns("/integrations", "/sources/")).toBe(true);
    expect(customerNavOwns("/pricing", "/privacy")).toBe(false);
  });
  it.each(films.files)("preserves the approved $file bytes", ({ file, bytes, sha256 }) => {
    const data = readFileSync(fileURLToPath(new URL(`../public/film/${file}`, import.meta.url)));
    expect(data.length).toBe(bytes);
    expect(createHash("sha256").update(data).digest("hex")).toBe(sha256);
  });
  it("orders the customer story as Hero → Works → Connect → Proof → Current → AI", () => {
    const page = text("components/home-page-client.tsx");
    expect(page.match(/<CompileStagePlayer/g)).toHaveLength(2);
    expect(page).toContain("playbackRate={1.5} compact");
    expect(page).toContain("You bring the source.");
    const works = page.indexOf('id="how-it-works"');
    const connect = page.indexOf('id="connect"');
    const proof = page.indexOf('id="proof"');
    const current = page.indexOf('id="stays-current"');
    const ready = page.indexOf('id="ready-for-ai"');
    expect(works).toBeGreaterThan(0);
    expect(works).toBeLessThan(connect);
    expect(connect).toBeLessThan(proof);
    expect(proof).toBeLessThan(current);
    expect(current).toBeLessThan(ready);
    expect(page.indexOf("<CompileStagePlayer")).toBeLessThan(proof);
    expect(page).toContain("approved source film is preserved");
    expect(page).toContain("/explore?act=source");
  });
  it("preserves state-controlled entry and actual public proof", () => {
    expect(text("components/home-page-client.tsx")).toContain("liveCommerce ? SELF_SERVE_CTA : ACCESS_CTA");
    expect(text("app/page.tsx")).toContain("isLiveCommerce()");
    expect(text("app/page.tsx")).toContain("<SolutionProofSample");
    expect(text("app/ko/page.tsx")).toContain("playbackRate={1.5} compact");
    expect(text("app/ko/page.tsx")).toContain("01 / TAVONEL WORKS");
    expect(text("app/ko/page.tsx")).toContain('canonical: "/ko"');
  });
  it("keeps low-motion, Save-Data and hidden-tab playback protections", () => {
    const player = text("components/compile-stage-player.tsx");
    expect(player).toContain("prefers-reduced-motion");
    expect(player).toContain("saveData");
    expect(player).toContain("documentVisible");
    expect(player).toContain("videoError");
    expect(player).toContain("filmMotionControl");
  });
  it("preserves advanced surfaces and only presents a real pending review", () => {
    const shell = text("components/workspace-ultimate-shell.tsx");
    const primary = shell.slice(shell.indexOf("const NAV_ITEMS"), shell.indexOf("const MORE_ITEMS"));
    expect(primary.match(/surface:/g)).toHaveLength(3);
    expect(primary).toContain('label: "Use with AI"');
    for (const surface of ["review", "changes", "world", "connections", "developer", "activity", "settings"]) {
      expect(shell).toContain(`surface: "${surface}"`);
    }
    expect(shell).toContain('aria-label="More workspace tools"');
    expect(text("app/workspace/page.tsx")).toContain("candidateReady={candidateNeedsDecision}");
  });
  it("never records guide opening or package download as external connection success", () => {
    const page = text("app/workspace/page.tsx");
    expect(page).toContain("const aiConnectionTaken = false;");
    expect(page).not.toContain("setAiConnectionTaken(true)");
    expect(text("components/workspace-use-with-ai.tsx")).toContain("An external AI connection has not been verified");
  });
  it("retains cost approval, automatic durable compile and human activation boundaries", () => {
    const page = text("app/workspace/page.tsx");
    expect(page).toContain("stagedSelection");
    expect(page).toContain("if (judgeCorpusSet(ids.length).ok) await startDurableCompile(ids)");
    expect(page).toContain("activationPolicy.customerIntake.enabled");
    expect(page).toContain("promoteCandidate");
    expect(page).toContain("rollbackWorld");
  });
});
