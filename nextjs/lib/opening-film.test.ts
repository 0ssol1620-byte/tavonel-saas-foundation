import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_CAPTIONS, FILM_DURATION } from "./film-script";

const FILM_COMPONENTS = [
  "components/opening-film.tsx",
  "components/opening-film-2.tsx",
  "components/opening-film-3.tsx",
  "components/opening-film-4.tsx",
] as const;

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("opening film cut", () => {
  it("is a sendable cut with no spoken caption band", () => {
    expect(FILM_DURATION).toBeGreaterThan(5);
    expect(FILM_CAPTIONS).toHaveLength(0);
  });

  it("keeps every live canvas supersampled without changing scene coordinates", () => {
    for (const file of FILM_COMPONENTS) {
      const source = read(file);
      expect(source, `${file} must render at least 2x and cap at 3x`).toContain(
        "Math.min(3, Math.max(2, window.devicePixelRatio || 1))",
      );
    }
  });

  it("shows only shipped read-only MCP tool names in cut four", () => {
    const film = read("components/opening-film-4.tsx");
    const distribution = read("public/developer/tavonel-mcp.mjs");
    const names = [...distribution.matchAll(/name: "([a-z_]+)"/g)].map((match) => match[1]);
    const shown = film.match(/const MCP_TOOLS = \[([\s\S]*?)\];/)?.[1] ?? "";
    const shownNames = [...shown.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(shownNames.length).toBeGreaterThan(0);
    for (const name of shownNames) expect(names).toContain(name);
    for (const name of [...film.matchAll(/`→ ([a-z_]+)`/g)].map((match) => match[1])) {
      expect(names).toContain(name);
    }
  });

  it("uses commands published by the downloadable CLI in cut four", () => {
    const film = read("components/opening-film-4.tsx");
    const cli = read("public/developer/tavonel-cli.mjs");
    for (const command of ["worlds", "documents", "ask", "download"]) {
      expect(film).toContain(`tavonel ${command}`);
      expect(cli).toContain(`tavonel-cli.mjs ${command}`);
    }
  });
});
