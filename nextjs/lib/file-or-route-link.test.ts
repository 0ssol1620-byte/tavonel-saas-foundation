import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/link renders an <a> too, so the mock marks it: a marked anchor is a Link, an unmarked one is plain.
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) =>
    createElement("a", { href, className, "data-next-link": "" }, children),
}));

const { default: FileOrRouteLink, isFileHref } = await import("../components/file-or-route-link");
const html = (href: string) => renderToStaticMarkup(createElement(FileOrRouteLink, { href }, "x"));

describe("a published file gets a plain anchor, a route keeps next/link (PR #203 review B1)", () => {
  it("renders a route as Link", () => {
    for (const href of ["/security", "/trust", "/enterprise", "/docs/exports", "/explore?act=world"]) {
      expect(isFileHref(href), href).toBe(false);
      expect(html(href), href).toContain("data-next-link");
    }
  });

  it("renders a .md or .txt file as a plain <a>", () => {
    for (const href of ["/.well-known/security.txt", "/policies/security.md", "/legal/terms.md#section"]) {
      expect(isFileHref(href), href).toBe(true);
      expect(html(href), href).not.toContain("data-next-link");
      expect(html(href), href).toContain(`href="${href}"`);
    }
  });

  it("is the one helper both trust components use", () => {
    for (const file of ["components/trust-provisions.tsx", "components/trust-disclosures.tsx"]) {
      const source = readFileSync(resolve(__dirname, "..", file), "utf8");
      expect(source, file).toContain('from "@/components/file-or-route-link"');
      expect(source, file).not.toMatch(/const isFile\b/);
    }
  });
});
