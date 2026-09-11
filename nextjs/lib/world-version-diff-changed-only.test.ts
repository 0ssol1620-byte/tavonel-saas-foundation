import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffSection } from "@/components/world-version-diff";

/*
  Audit U03, "변경만 보기" (changed only).

  The rollback comparison was already change-only in substance and still printed a heading plus
  "No objects differ." for every section with nothing in it. The toggle hides exactly those and
  nothing else: a section with a difference is rendered whether the filter is on or off, so the
  filter can never hide a change from someone about to roll one back.
*/

const empty = { added: [], removed: [], changed: [] };
const withChange = {
  added: [],
  removed: [],
  changed: [{ id: "obj-1", changes: [{ field: "label", before: "Acme Ltd", after: "Acme Limited" }] }],
};

describe("changed-only display filter", () => {
  it("hides a section with no difference", () => {
    expect(renderToStaticMarkup(createElement(DiffSection, {
      title: "Objects", group: empty, render: () => "x", changedOnly: true,
    }))).toBe("");
  });

  it("shows the same empty section when the filter is off", () => {
    const markup = renderToStaticMarkup(createElement(DiffSection, {
      title: "Objects", group: empty, render: () => "x", changedOnly: false,
    }));
    expect(markup).toContain("No objects differ.");
  });

  it("never hides a section that has a change, filter on or off", () => {
    for (const changedOnly of [true, false]) {
      const markup = renderToStaticMarkup(createElement(DiffSection, {
        title: "Objects", group: withChange, render: (item: { id: string }) => item.id, changedOnly,
      }));
      expect(markup).toContain("obj-1");
      expect(markup).toContain("Acme Limited");
      expect(markup).toContain("Acme Ltd");
    }
  });

  it("defaults to showing an empty section when no filter is passed", () => {
    expect(renderToStaticMarkup(createElement(DiffSection, {
      title: "Relations", group: empty, render: () => "x",
    }))).toContain("No relations differ.");
  });
});
