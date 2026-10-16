import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorldOntologyViewer from "../components/world-ontology-viewer";
import { ClassRenamePreviewResult } from "../components/world-ontology-rename-preview";
import {
  PROPOSED_CLASS_NAME_MAX,
  ontologyPreviewSnapshotKey,
  previewClassRename,
  type ClassRenameOutcome,
  type ClassRenamePreview,
} from "./ontology-class-rename-preview";
import type { WorldOntology } from "./world-read-model";

/*
  A local class-name proposal, previewed over the ontology already on screen.

  The fixture below is written by hand in the actual WorldOntology shape. Its counts are local
  test values, not the output of a compile or a model run; the zero-instance `Evidence` class
  is an edge case the current compiler does not emit and is here only so the preview's wording
  for it is pinned. `Obligation` is a proposed label, deliberately not a WorldObjectType.
*/

function fixture(): WorldOntology {
  return {
    classes: [
      { name: "Claim", instances: 3, withEvidence: 2 },
      { name: "Document", instances: 2, withEvidence: 2 },
      { name: "Entity", instances: 1, withEvidence: 1 },
      { name: "Evidence", instances: 0, withEvidence: 0 },
      { name: "Topic", instances: 4, withEvidence: 1 },
    ],
    properties: [
      { name: "discusses_topic", usages: 5, domain: ["Document"], range: ["Topic"], withEvidence: 4 },
      { name: "mentions", usages: 7, domain: ["Claim", "Document"], range: ["Entity", "Topic"], withEvidence: 6 },
      { name: "related_to", usages: 2, domain: ["Topic"], range: ["Topic"], withEvidence: 0 },
      { name: "supports", usages: 3, domain: ["Claim"], range: ["Document"], withEvidence: 3 },
    ],
    hierarchy: { state: "not_yet", reason: "The compiled ontology declares no subclass axioms, so there is no hierarchy to read." },
    exports: [
      { path: "ontology/knowledge.ttl", mediaType: "text/turtle", sha256: `sha256:${"a".repeat(64)}` },
      { path: "graph/nodes.csv", mediaType: "text/csv", sha256: `sha256:${"b".repeat(64)}` },
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function expectPreview(outcome: ClassRenameOutcome): ClassRenamePreview {
  expect(outcome.state).toBe("preview");
  return outcome as ClassRenamePreview;
}

function expectRefusal(outcome: ClassRenameOutcome, reason: string) {
  expect(outcome.state).toBe("refused");
  if (outcome.state !== "refused") return;
  expect(outcome.reason).toBe(reason);
  expect(outcome.message.trim().length).toBeGreaterThan(0);
}

/** The opening tag of the element carrying `id`, so a label's target can be checked by tag. */
function tagWithId(html: string, id: string): string | null {
  const at = html.indexOf(` id="${id}"`);
  if (at < 0) return null;
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

const viewerSource = readFileSync(new URL("../components/world-ontology-viewer.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("../components/world-ontology-rename-preview.tsx", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("./ontology-class-rename-preview.ts", import.meta.url), "utf8");

describe("ontology class rename preview: a valid proposal reads the class's own counts and observed properties", () => {
  it("shows Document's instance and evidence counts and the properties that use it, with their roles", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Document", "Source file"));
    expect(preview.sourceClass).toBe("Document");
    expect(preview.proposedName).toBe("Source file");
    expect(preview.instances).toBe(2);
    expect(preview.withEvidence).toBe(2);
    expect(preview.properties).toEqual([
      { name: "discusses_topic", roles: ["domain"] },
      { name: "mentions", roles: ["domain"] },
      { name: "supports", roles: ["range"] },
    ]);
  });

  it("takes a label that is not a compiled class type, as a proposal only", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Claim", "Obligation"));
    expect(preview.proposedName).toBe("Obligation");
    expect(preview.instances).toBe(3);
    expect(preview.withEvidence).toBe(2);
    expect(preview.properties).toEqual([
      { name: "mentions", roles: ["domain"] },
      { name: "supports", roles: ["domain"] },
    ]);
  });

  it("lists a property by range alone when the class is only ever its object", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Entity", "Party"));
    expect(preview.properties).toEqual([{ name: "mentions", roles: ["range"] }]);
  });
});

describe("ontology class rename preview: refusals say plainly why no preview is shown", () => {
  it("refuses without an ontology or without classes", () => {
    expectRefusal(previewClassRename(null, "Document", "Source"), "no_ontology");
    expectRefusal(previewClassRename(undefined, "Document", "Source"), "no_ontology");
    expectRefusal(previewClassRename({ ...fixture(), classes: [] }, "Document", "Source"), "no_classes");
  });

  it("refuses a class that is not in this ontology, compared exactly", () => {
    expectRefusal(previewClassRename(fixture(), "Obligation", "Source"), "unknown_class");
    expectRefusal(previewClassRename(fixture(), "document", "Source"), "unknown_class");
    expectRefusal(previewClassRename(fixture(), " Document", "Source"), "unknown_class");
  });

  it("refuses an empty name, after trimming", () => {
    expectRefusal(previewClassRename(fixture(), "Document", ""), "empty_name");
    expectRefusal(previewClassRename(fixture(), "Document", "   "), "empty_name");
    expectRefusal(previewClassRename(fixture(), "Document", "　\n\t"), "empty_name");
  });

  it("refuses the class's own name, and another class's exact name", () => {
    expectRefusal(previewClassRename(fixture(), "Document", "Document"), "unchanged");
    expectRefusal(previewClassRename(fixture(), "Document", "  Document  "), "unchanged");
    expectRefusal(previewClassRename(fixture(), "Document", "Topic"), "collides_with_existing_class");
    // Case-sensitive: these are not the existing names, so they are proposals like any other.
    expect(expectPreview(previewClassRename(fixture(), "Document", "topic")).proposedName).toBe("topic");
    expect(expectPreview(previewClassRename(fixture(), "Document", "document")).proposedName).toBe("document");
  });

  it("bounds the name at 1..80 characters counted in code points, after trimming", () => {
    expect(PROPOSED_CLASS_NAME_MAX).toBe(80);
    expectPreview(previewClassRename(fixture(), "Document", "a".repeat(80)));
    expectPreview(previewClassRename(fixture(), "Document", `  ${"a".repeat(80)}  `));
    expectRefusal(previewClassRename(fixture(), "Document", "a".repeat(81)), "too_long");
    // 80 astral characters are 160 UTF-16 units and still within the bound.
    expectPreview(previewClassRename(fixture(), "Document", "\u{1D4AA}".repeat(80)));
    expectRefusal(previewClassRename(fixture(), "Document", "\u{1D4AA}".repeat(81)), "too_long");
  });

  it("refuses line breaks, tabs and control characters inside the name, but trims them at the ends", () => {
    for (const name of ["Obli\ngation", "Obli\tgation", "Obli\u0000gation", "Obli\u007Fgation", "Obli gation", "‮noitagilbo", "Obli⁦gation⁩"]) {
      expectRefusal(previewClassRename(fixture(), "Document", name), "control_character");
    }
    expect(expectPreview(previewClassRename(fixture(), "Document", "\n\tObligation \n")).proposedName).toBe("Obligation");
  });

  it("accepts Unicode, spaces and joiners as a proposal, with no schema qualification", () => {
    for (const name of ["의무 조항", "Obligation ✓", "Obligación contractual", "\u{1F469}‍\u{1F4BB} Owner", "a/b", "__proto__"]) {
      expect(expectPreview(previewClassRename(fixture(), "Document", name)).proposedName).toBe(name);
    }
  });
});

describe("ontology class rename preview: properties are counted once, by exact name, in a stable order", () => {
  it("counts a property that uses the class as both domain and range once, with both roles", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Topic", "Subject"));
    expect(preview.properties).toEqual([
      { name: "discusses_topic", roles: ["range"] },
      { name: "mentions", roles: ["range"] },
      { name: "related_to", roles: ["domain", "range"] },
    ]);
    expect(preview.properties.length).toBe(3);
    // Not a sum of uses: 5 + 7 + 2 uses across these properties are not 14 relations of Topic.
    const usages = fixture().properties.filter((entry) => preview.properties.some((use) => use.name === entry.name)).reduce((sum, entry) => sum + entry.usages, 0);
    expect(usages).toBe(14);
    expect(Object.values(preview)).not.toContain(14);
  });

  it("merges repeated entries for one name and keeps names that differ only by case apart", () => {
    const base = fixture();
    const properties: WorldOntology["properties"] = [
      { name: "related_to", usages: 1, domain: ["Topic"], range: ["Claim"], withEvidence: 1 },
      { name: "discusses_topic", usages: 5, domain: ["Document"], range: ["Topic"], withEvidence: 4 },
      { name: "Related_to", usages: 1, domain: ["Topic"], range: ["Topic"], withEvidence: 0 },
      { name: "related_to", usages: 1, domain: ["Entity"], range: ["Topic"], withEvidence: 1 },
    ];
    const expected = [
      { name: "Related_to", roles: ["domain", "range"] },
      { name: "discusses_topic", roles: ["range"] },
      { name: "related_to", roles: ["domain", "range"] },
    ];
    expect(expectPreview(previewClassRename({ ...base, properties }, "Topic", "Subject")).properties).toEqual(expected);
    expect(expectPreview(previewClassRename({ ...base, properties: [...properties].reverse() }, "Topic", "Subject")).properties).toEqual(expected);
  });

  it("gives the same answer for the same input every time", () => {
    const first = previewClassRename(fixture(), "Claim", "Obligation");
    const second = previewClassRename(fixture(), "Claim", "Obligation");
    expect(second).toEqual(first);
  });
});

describe("ontology class rename preview: nothing is mutated, and a draft is bound to its ontology's content", () => {
  it("leaves classes, properties, hierarchy and exports exactly as they were", () => {
    const ontology = deepFreeze(fixture());
    const before = JSON.stringify(ontology);
    for (const entry of ontology.classes) {
      for (const name of ["Obligation", "Topic", "", "x".repeat(81), entry.name]) previewClassRename(ontology, entry.name, name);
    }
    const preview = expectPreview(previewClassRename(ontology, "Topic", "Subject"));
    // The result is the caller's to keep; changing it reaches nothing in the ontology.
    preview.properties.push({ name: "invented", roles: ["domain"] });
    preview.properties[0].roles.push("domain");
    preview.notes.length = 0;
    expect(JSON.stringify(ontology)).toBe(before);
    expect(renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology }))).toContain("Preview a class name");
    expect(JSON.stringify(ontology)).toBe(before);
  });

  it("keys equal content equally and any change of content differently", () => {
    const key = ontologyPreviewSnapshotKey(fixture());
    expect(ontologyPreviewSnapshotKey(structuredClone(fixture()))).toBe(key);
    expect(ontologyPreviewSnapshotKey(null)).toBe(ontologyPreviewSnapshotKey(undefined));
    expect(ontologyPreviewSnapshotKey(null)).not.toBe(ontologyPreviewSnapshotKey({ ...fixture(), classes: [], properties: [] }));

    const changes: Array<(ontology: WorldOntology) => void> = [
      (ontology) => { ontology.classes[1].instances += 1; },
      (ontology) => { ontology.classes[1].withEvidence -= 1; },
      (ontology) => { ontology.classes.pop(); },
      (ontology) => { ontology.properties[0].domain = ["Claim"]; },
      (ontology) => { ontology.properties[0].usages += 1; },
      (ontology) => { ontology.exports[0].sha256 = `sha256:${"c".repeat(64)}`; },
      (ontology) => { ontology.exports = []; },
      (ontology) => { ontology.hierarchy = { state: "not_yet", reason: "Another reason." }; },
    ];
    for (const change of changes) {
      const changed = fixture();
      change(changed);
      expect(ontologyPreviewSnapshotKey(changed)).not.toBe(key);
    }
  });

  it("is not changed by drafting, and a draft computed against new data reads the new data", () => {
    const ontology = fixture();
    const key = ontologyPreviewSnapshotKey(ontology);
    previewClassRename(ontology, "Document", "Source file");
    expect(ontologyPreviewSnapshotKey(ontology)).toBe(key);

    const next = fixture();
    next.classes[1] = { name: "Document", instances: 5, withEvidence: 4 };
    expect(expectPreview(previewClassRename(next, "Document", "Source file")).instances).toBe(5);
  });

  it("is what the viewer keys the draft by, so a changed ontology starts a fresh draft", () => {
    expect(viewerSource).toContain("<WorldOntologyRenamePreview key={ontologyPreviewSnapshotKey(ontology)} ontology={ontology} />");
    // Content-derived only: not a version, and not read from or written to anywhere.
    expect(helperSource).not.toMatch(/\bversion\s*:/);
  });
});

describe("ontology class rename preview: the actual viewer renders local controls beside its existing reading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes labelled class and name controls, Preview and Clear draft, a live status and the caveat", () => {
    const html = renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology: fixture() }));
    expect(html).toContain("Preview a class name");

    const labels = [...html.matchAll(/<label for="([^"]+)">([^<]+)<\/label>/g)].map((match) => ({ id: match[1], text: match[2] }));
    expect(labels.map((label) => label.text)).toEqual(["Class", "Proposed name"]);
    expect(new Set(labels.map((label) => label.id)).size).toBe(2);
    expect(tagWithId(html, labels[0].id)).toMatch(/^<select\b/);
    expect(tagWithId(html, labels[1].id)).toMatch(/^<input\b[^>]*type="text"/);
    // Attribute names are case-insensitive in HTML (React emits autoComplete); the value stays exactly "off".
    expect(tagWithId(html, labels[1].id)?.match(/\sautocomplete="([^"]*)"/i)?.[1]).toBe("off");
    expect(tagWithId(html, labels[1].id)).not.toMatch(/\sname="/);

    for (const entry of fixture().classes) expect(html).toContain(`<option value="${entry.name}"`);
    expect(html).toMatch(/<button type="submit"[^>]*>Preview<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Clear draft<\/button>/);
    // Mounted empty, so the first message after a submit is announced; no preview before one.
    expect(html).toMatch(/<p[^>]*role="status" aria-live="polite"><\/p>/);
    expect(html).not.toContain("Draft preview");
    expect(html).toContain("nothing is renamed or saved, and the compiled World stays as it is");
  });

  it("keeps the classes, hierarchy, properties and export reading as it was", () => {
    const html = renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology: fixture() }));
    expect(html).toContain("5 classes · 4 properties · 6 of 10 instances carry evidence");
    expect(html).toContain('<h3 id="ontology-classes">Classes</h3>');
    for (const entry of fixture().classes) expect(html).toContain(`<th scope="row">${entry.name}</th>`);
    expect(html).toContain('<h3 id="ontology-hierarchy">Hierarchy</h3>');
    expect(html).toContain("READ_NOT_YET");
    expect(html).toContain("The compiled ontology declares no subclass axioms, so there is no hierarchy to read.");
    expect(html).toContain("<th scope=\"col\">Domain (observed)</th>");
    expect(html).toContain("<td>Claim, Document</td><td>Entity, Topic</td><td>7</td><td>6</td>");
    for (const file of fixture().exports) {
      expect(html).toContain(`<strong>${file.path}</strong>`);
      expect(html).toContain(`<code>${file.sha256}</code>`);
    }
    // The draft sits under the classes and before the hierarchy.
    const classes = html.indexOf('id="ontology-classes"');
    const draft = html.indexOf("Preview a class name");
    const hierarchy = html.indexOf('id="ontology-hierarchy"');
    expect(classes).toBeLessThan(draft);
    expect(draft).toBeLessThan(hierarchy);
  });

  it("keeps the existing empty reading, and offers no controls when there are no classes", () => {
    for (const ontology of [null, { ...fixture(), classes: [], properties: [] }]) {
      const html = renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology }));
      expect(html).toContain("No compiled ontology to read");
      expect(html).not.toContain("Preview a class name");
    }
    const html = renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology: { ...fixture(), classes: [] } }));
    expect(html).toContain("Preview a class name");
    expect(html).toContain("This World has no compiled classes");
    expect(html).not.toMatch(/<(form|select|input|button)\b/);
  });

  it("makes no request and touches no storage while rendering", () => {
    const fetchSpy = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    renderToStaticMarkup(createElement(WorldOntologyViewer, { ontology: fixture() }));
    renderToStaticMarkup(createElement(ClassRenamePreviewResult, { preview: expectPreview(previewClassRename(fixture(), "Topic", "Subject")) }));
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const method of [storage.getItem, storage.setItem, storage.removeItem, storage.clear, storage.key]) expect(method).not.toHaveBeenCalled();
    for (const source of [previewSource, helperSource]) {
      expect(source).not.toMatch(/\bfetch\(|localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|@vercel\/analytics|document\.cookie/);
    }
  });
});

describe("ontology class rename preview: each preview states its own limits and claims no effect", () => {
  it("says so when the class has no instances and no observed property", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Evidence", "Exhibit"));
    expect(preview.instances).toBe(0);
    expect(preview.withEvidence).toBe(0);
    expect(preview.properties).toEqual([]);
    expect(preview.notes).toContain("No instances of this class are compiled in this World.");
    expect(preview.notes).toContain("No observed property has this class as its domain or range.");

    const html = renderToStaticMarkup(createElement(ClassRenamePreviewResult, { preview }));
    expect(html).toContain("0 of 0");
    expect(html).toContain("No instances of this class are compiled in this World.");
    expect(html).toContain("No observed property has this class as its domain or range.");
    expect(html).not.toContain("<table");
  });

  it("adds those notes only to the previews they are true of", () => {
    const document = expectPreview(previewClassRename(fixture(), "Document", "Source file"));
    expect(document.notes).not.toContain("No instances of this class are compiled in this World.");
    expect(document.notes).not.toContain("No observed property has this class as its domain or range.");
    expect(document.notes.length).toBe(3);
  });

  it("states preview-only, no schema or persistence, and observed-not-declared on every preview", () => {
    for (const entry of fixture().classes) {
      const notes = expectPreview(previewClassRename(fixture(), entry.name, "Obligation")).notes.join(" ");
      expect(notes).toContain("nothing has been renamed or saved");
      expect(notes).toContain("claims, caches, relations and export files are unchanged");
      expect(notes).toContain("not checked as a class type and implies no schema change or migration");
      expect(notes).toContain("not declared constraints");
      expect(notes).toContain("no relation count is shown");
    }
  });

  it("carries only read counts and names -- no ids, relation totals or guaranteed effects", () => {
    const preview = expectPreview(previewClassRename(fixture(), "Topic", "Subject"));
    expect(Object.keys(preview).sort()).toEqual(["instances", "notes", "properties", "proposedName", "sourceClass", "state", "withEvidence"]);
    for (const use of preview.properties) expect(Object.keys(use).sort()).toEqual(["name", "roles"]);
    expect(fixture().classes.map((entry) => entry.name)).not.toContain("Obligation");

    const html = renderToStaticMarkup(createElement(ClassRenamePreviewResult, { preview }));
    expect(html).toContain("<th scope=\"row\">related_to</th><td>Domain and range</td>");
    expect(html).toContain("<th scope=\"row\">discusses_topic</th><td>Range</td>");
    expect(html).not.toMatch(/(saved|renamed|applied) successfully|rename (complete|succeeded)|will be updated/i);
  });

  it("renders names as text, never as markup", () => {
    const ontology = fixture();
    ontology.properties.push({ name: "<img src=x onerror=alert(1)>", usages: 1, domain: ["Document"], range: ["Topic"], withEvidence: 0 });
    const preview = expectPreview(previewClassRename(ontology, "Document", "<b>Obligation</b>"));
    const html = renderToStaticMarkup(createElement(ClassRenamePreviewResult, { preview }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Obligation&lt;/b&gt;");
  });
});
