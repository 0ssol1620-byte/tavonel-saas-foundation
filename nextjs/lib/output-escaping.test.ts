import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv-cell";
import { serializeAuditExport } from "@/lib/enterprise-http";
import { breadcrumbList, jsonLdHtml } from "@/lib/structured-data";

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
  it("has exactly two dangerouslySetInnerHTML sinks, and both render JSON-LD from literals", () => {
    const users = SOURCES.filter((file) => file.text.includes("dangerouslySetInnerHTML"));
    expect(
      users.map((file) => file.path).sort(),
      "a further raw-HTML sink is a design decision, not a refactor: justify it here or do not add it",
    ).toEqual(["app/layout.tsx", "components/breadcrumb-json-ld.tsx"]);
    // Both serialise JSON-LD only. layout.tsx inlines an object literal; the breadcrumb component
    // (2026-09-08 exposure lane) serialises `breadcrumbList(trail)`, whose trail is a page-declared
    // literal and whose origin/root come from lib/structured-data.ts. No value reaches either sink
    // from a request, a document or a model.
    const byPath = new Map(users.map((file) => [file.path, file.text]));
    expect(byPath.get("app/layout.tsx")).toMatch(/__html: jsonLdHtml\(\{\s*\n\s*"@context": "https:\/\/schema\.org"/);
    expect(byPath.get("components/breadcrumb-json-ld.tsx")).toMatch(/__html: jsonLdHtml\(breadcrumbList\(trail\)\)/);
    // And neither may go back to the bare serializer, which is what they both did until B7.
    for (const [path, text] of byPath) {
      expect(text, `${path}: __html must go through jsonLdHtml`).not.toMatch(/__html:\s*JSON\.stringify/);
    }
  });

  /*
    The one character `JSON.stringify` does not escape, in the one place it cannot be survived.

    Both blocks above serialised with a bare `JSON.stringify`. Inside a `<script>` element the HTML
    parser is looking for `</script` and nothing else, so a single string value carrying it ends
    the element early and everything after it is markup on the page. Nothing exploitable existed --
    every value in either block is an authored literal, breadcrumb trails included -- but that is a
    fact about today's callers and not about the sink, and the sink is what the next caller reaches
    for with a title out of a customer document.

    So both go through `jsonLdHtml` in `lib/structured-data.ts`, and the assertion is on its output
    rather than on a spelling: no `<` leaves the serializer, whatever a value holds.
  */
  it("emits no raw < from the JSON-LD serializer, whatever a value holds", () => {
    const hostile = "</script><img src=x onerror=alert(1)>";
    const html = jsonLdHtml({ name: hostile, nested: [{ item: hostile }] });
    expect(html).not.toContain("<");
    // `>` needs no escaping -- the parser's end-tag search starts at `<`, so that is the one
    // character the serializer has to take away.
    expect(html).toContain("\\u003c/script>");
    // Still JSON, and still the same string after parsing. An escape that changed the value would
    // be a different defect: a breadcrumb whose name is not the name the page passed.
    expect((JSON.parse(html) as { name: string }).name).toBe(hostile);
  });

  it("escapes a trail of the shape a page actually passes", () => {
    const html = jsonLdHtml(breadcrumbList([{ name: "</script>Q3 revenue", path: "/cookbooks/source-revision-reuse" }]));
    expect(html).not.toContain("<");
    expect(html).toContain("BreadcrumbList");
    expect((JSON.parse(html) as { itemListElement: { name: string }[] }).itemListElement[1]!.name).toBe("</script>Q3 revenue");
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
