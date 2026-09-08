import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv-cell";
import { serializeAuditExport } from "@/lib/enterprise-http";

/*
  §42. Everything TAVONEL renders is untrusted: extracted document text, model output, source
  names, connector data. React escapes what it interpolates, so the interesting surfaces are the
  three places that leave React's escaping: raw HTML injection, a link whose protocol comes from
  data, and a file we hand to a program that is not a browser.

  These are file-level guards rather than DOM tests on purpose. The failure they exist to catch
  is a *new* call site appearing, and a rendering test of today's components cannot see one.
*/

const root = resolve(import.meta.dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

const SOURCES = [...sourceFiles("app"), ...sourceFiles("components")].map((path) => ({
  path,
  text: readFileSync(join(root, path), "utf8"),
}));

describe("raw HTML injection", () => {
  it("has exactly one dangerouslySetInnerHTML, and it renders a constant", () => {
    const users = SOURCES.filter((file) => file.text.includes("dangerouslySetInnerHTML"));
    expect(
      users.map((file) => file.path),
      "a second raw-HTML sink is a design decision, not a refactor: justify it here or do not add it",
    ).toEqual(["app/layout.tsx"]);
    // The one that exists serialises an object literal declared inline, so no value reaches it
    // from a request, a document or a model.
    expect(users[0]!.text).toMatch(/__html: JSON\.stringify\(\{\s*\n\s*"@context": "https:\/\/schema\.org"/);
  });
});

describe("link protocol", () => {
  it("renders no javascript: or data: URL anywhere a browser would follow it", () => {
    const offenders = SOURCES.filter((file) =>
      /(href|src|action|formAction)\s*=\s*[{"'`]*\s*["'`]?\s*(javascript|data|vbscript):/i.test(file.text),
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it("routes every external link through an explicit https or mailto literal", () => {
    /*
      Every `href` in this tree is a literal or a `Route`-typed constant today. This catches the
      change that would break that: an href interpolating a value whose scheme is not fixed by the
      surrounding template, which is the one shape `javascript:` can arrive in.
    */
    const dynamic = SOURCES.flatMap((file) =>
      [...file.text.matchAll(/href=\{`([^`]*)`/g)]
        .filter((match) => !/^(\/|#|mailto:|tel:|https:)/.test(match[1]!))
        .map((match) => `${relative(".", file.path)}: ${match[1]}`),
    );
    expect(dynamic).toEqual([]);
  });
});

describe("spreadsheet exports", () => {
  it("neutralises a formula in every leading character a spreadsheet acts on", () => {
    expect(csvCell("=HYPERLINK(\"https://evil.example\",\"Open\")")).toBe(
      "\"'=HYPERLINK(\"\"https://evil.example\"\",\"\"Open\"\")\"",
    );
    expect(csvCell("+1+1")).toBe("\"'+1+1\"");
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
    expect(csvCell("@SUM(A1:A9)")).toBe("\"'@SUM(A1:A9)\"");
    expect(csvCell("\t=1+1")).toBe("\"'\t=1+1\"");
    expect(csvCell("\r=1+1")).toBe("\"'\r=1+1\"");
  });

  it("leaves an ordinary cell exactly as it was", () => {
    expect(csvCell("Q3 revenue")).toBe('"Q3 revenue"');
    // A hyphen inside a value is not a leading one. Dates and negative numbers are the reason
    // this has to be an anchored test and not a search.
    expect(csvCell("2026-09-08")).toBe('"2026-09-08"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps markup inside one cell instead of breaking the row", () => {
    // Markup in a CSV is inert; the risk is a value that ends the cell early and forges a column.
    expect(csvCell('<script>alert(1)</script>')).toBe('"<script>alert(1)</script>"');
    expect(csvCell('<img src=x onerror="alert(1)">')).toBe('"<img src=x onerror=""alert(1)"">"');
    expect(csvCell('a","b')).toBe('"a"",""b"');
  });

  it("escapes a hostile audit row on the export path itself", () => {
    const csv = serializeAuditExport([{
      event_id: "evt_1",
      occurred_at: "2026-09-08T00:00:00.000Z",
      action: "=cmd|'/c calc'!A1",
      target_id: '<img src=x onerror="alert(1)">',
      details: { note: "@SUM(1+1)" },
    }], "csv");
    const [, row] = csv.trimEnd().split("\n");
    expect(row).toContain("\"'=cmd|'/c calc'!A1\"");
    expect(row).toContain('"<img src=x onerror=""alert(1)"">"');
    // A non-string cell is JSON first, so its leading character is `{` and it needs no prefix.
    expect(row).toContain('"{""note"":""@SUM(1+1)""}"');
    expect(csv.trimEnd().split("\n")).toHaveLength(2);
  });
});
