import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, type WorldDirectoryEntry, type WorldObject } from "./world-read-model";
import WorldDirectoryTree, { buildDirectoryTree, directoryTreePage, directoryObjectBinding } from "../components/world-directory-tree";
import type { ReactElement, ReactNode } from "react";

// Deterministic hook scheduler for this component's actual event handlers. No DOM/provider.
// State belongs to component+key, render-phase updates settle, and memo dependencies are kept.
const directoryHooks = vi.hoisted(() => ({
  instances: new Map<string, Array<{ value: unknown; deps?: readonly unknown[] }>>(),
  instance: "", cursor: 0, dirty: false,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const slot = () => {
    const rows = directoryHooks.instances.get(directoryHooks.instance) ?? [];
    directoryHooks.instances.set(directoryHooks.instance, rows);
    return { rows, index: directoryHooks.cursor++ };
  };
  return { ...react,
    useState<T>(initial: T | (() => T)) {
      const { rows, index } = slot();
      if (!rows[index]) rows[index] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
      return [rows[index].value as T, (action: T | ((previous: T) => T)) => {
        const value = typeof action === "function" ? (action as (previous: T) => T)(rows[index].value as T) : action;
        if (!Object.is(value, rows[index].value)) { rows[index].value = value; directoryHooks.dirty = true; }
      }];
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const { rows, index } = slot();
      if (!rows[index] || deps.length !== rows[index].deps?.length || deps.some((value, i) => !Object.is(value, rows[index].deps![i]))) {
        rows[index] = { value: factory(), deps };
      }
      return rows[index].value as T;
    },
    useId() { const { index } = slot(); return `directory-${index}`; },
  };
});

/*
  The two lenses that were showing something adjacent to the truth.

  The directory lens grouped compiled objects by `object.type` and drew folders. It looked
  like a directory and was a different object: it could not show a path, could not show a root
  the compile left empty, and could not say which documents a folder came from. The compiler
  emits all three in `directoryPlan`, and the read model now carries them.

  The ontology lens listed distinct type strings and distinct predicate strings. What an
  ontology view has to answer is what classes exist, what properties relate them, what those
  properties actually connect, and how much of it is evidence-backed. The first two were
  there; the last two were not.
*/

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId,
    versionKey: digest,
    sanitizedKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws/ws/documents/${documentId}/${digest}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    regions: [{
      regionId: `${documentId}-p1-b1`,
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text,
      bbox1000: [80, 120, 920, 320],
      confidence: 0.99,
      authority: "contractual",
    }],
  };
}

const source = (() => {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporation shall pay every valid invoice within 30 calendar days."),
    input("contract-b", "b".repeat(64), "ACME Corporation requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "lens-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
})();

const model = buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" })!;

describe("the compiled directory", () => {
  it("is the compiler's plan, path for path", () => {
    expect(model.directory.length).toBe(source.directoryPlan.length);
    const planned = new Set(source.directoryPlan.map((entry) => entry.path));
    for (const entry of model.directory) expect(planned.has(entry.path)).toBe(true);
  });

  it("carries the paths and kinds that a type grouping could not produce", () => {
    // A leaf under a root, with the compiler's own kind. Grouping objects by `type` produces
    // neither: there is no path to group by and no kind other than the object's own.
    const leaf = model.directory.find((entry) => entry.path.startsWith("Sources/") && entry.kind === "document");
    expect(leaf).toBeDefined();
    expect(leaf!.sourceIds.length).toBeGreaterThan(0);
  });

  it("keeps a root the compile left empty", () => {
    // `Assets` is planned and this corpus produces nothing under it. That is a fact about the
    // World; dropping it would present the compile as having produced something it did not.
    const roots = model.directory.filter((entry) => entry.kind === "root").map((entry) => entry.path);
    expect(roots).toContain("Assets");
    expect(model.directory.some((entry) => entry.path.startsWith("Assets/"))).toBe(false);
  });

  it("accumulates sources for a path two documents both wrote", () => {
    // Both documents mention the same entity, so the entity's planned path is derived from
    // both. A last-write-wins merge would drop one and misattribute the folder.
    const shared = model.directory.filter((entry) => entry.sourceIds.length > 1);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("is ordered, so two renders of the same World agree", () => {
    const paths = model.directory.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });
});

describe("the compiled ontology", () => {
  it("counts instances and evidence coverage per class", () => {
    for (const entry of model.ontology.classes) {
      expect(entry.instances).toBe(model.objects.filter((object) => object.type === entry.name).length);
      expect(entry.withEvidence).toBeLessThanOrEqual(entry.instances);
    }
    expect(model.ontology.classes.length).toBeGreaterThan(1);
  });

  it("reports the domain and range each property was actually used between", () => {
    const property = model.ontology.properties.find((entry) => entry.name === "discusses_topic");
    expect(property).toBeDefined();
    // Observed, not declared: this is what the compile produced, and the viewer labels it so.
    expect(property!.domain).toEqual(["Document"]);
    expect(property!.range).toEqual(["Topic"]);
    expect(property!.usages).toBe(model.relations.filter((relation) => relation.predicate === "discusses_topic").length);
  });

  it("refuses to invent a class hierarchy the artifact does not contain", () => {
    // The compiler emits no subclass axioms. A plausible tree here would be structure the
    // customer would then reason about, which is exactly the fabrication that is forbidden.
    expect(model.ontology.hierarchy.state).toBe("not_yet");
  });

  it("names where the ontology leaves the product", () => {
    const paths = model.ontology.exports.map((file) => file.path);
    expect(paths).toContain("ontology/knowledge.ttl");
    expect(paths).toContain("ontology/knowledge.jsonld");
    expect(paths).toContain("graph/nodes.csv");
    for (const file of model.ontology.exports) expect(file.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("the lenses that render them", () => {
  const studio = readFileSync(new URL("../components/world-studio-ultimate.tsx", import.meta.url), "utf8");

  it("no longer draws the graph as a grid of cards", () => {
    expect(studio).toContain("<WorldGraphCanvas");
    expect(studio).not.toContain("aria-label=\"Compiled relations\"");
  });

  it("no longer groups objects by type and calls it a directory", () => {
    expect(studio).toContain("<WorldDirectoryTree");
    expect(studio).not.toContain("model.objects.map((object) => object.type)");
  });

  it("renders the ontology from the read model rather than from distinct strings", () => {
    expect(studio).toContain("<WorldOntologyViewer");
    expect(studio).not.toContain("model.relations.map((relation) => relation.predicate)");
  });
});


describe("World Studio directory pagination", () => {
  type Element = ReactElement<Record<string, unknown>>;
  type TreeProps = Parameters<typeof WorldDirectoryTree>[0];
  function object(id: string): WorldObject {
    return { id, stableKey: id, label: `Synthetic ${id}`, type: "Topic", status: "candidate",
      aliases: { state: "read", value: [] }, claims: [], relations: [], evidenceRefs: [], sourceVersions: [],
      firstSeen: { state: "not_yet", reason: "Synthetic test" }, lastChanged: { state: "not_yet", reason: "Synthetic test" }, readState: "read" };
  }
  // Explicit synthetic directory/read-model rows; no runtime, ACL or load claim.
  const entries: WorldDirectoryEntry[] = [
    { path: "Topics", kind: "root", sourceIds: [] },
    ...Array.from({ length: 65 }, (_, i) => ({ path: `Topics/topic-${String(i + 1).padStart(2, "0")}.md`, kind: "topic", sourceIds: [`source-${i + 1}`] })),
    { path: "Assets", kind: "root", sourceIds: [] },
  ];
  const objects = Array.from({ length: 65 }, (_, i) => object(`topic-${String(i + 1).padStart(2, "0")}`));
  function mount(overrides: Partial<TreeProps> = {}) {
    directoryHooks.instances.clear();
    const onObjectSelect = vi.fn();
    let props: TreeProps = { entries, objects, selectedObjectId: "topic-65", onObjectSelect, ...overrides };
    let hosts: Element[] = [];
    function render() {
      let attempts = 0;
      do {
        directoryHooks.dirty = false; hosts = [];
        const descend = (node: ReactNode, key: string): void => {
          if (Array.isArray(node)) { node.forEach((child, i) => descend(child, `${key}/${i}`)); return; }
          if (!node || typeof node !== "object" || !("props" in node)) return;
          const element = node as Element;
          const identity = `${key}:${String(element.key ?? "")}`;
          if (typeof element.type === "function") {
            directoryHooks.instance = identity; directoryHooks.cursor = 0;
            descend((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), identity);
          } else { hosts.push(element); descend(element.props.children as ReactNode, identity); }
        };
        directoryHooks.instance = "directory"; directoryHooks.cursor = 0;
        descend(WorldDirectoryTree(props), "directory-output");
        if (++attempts > 10) throw new Error("Hook scheduler failed to settle");
      } while (directoryHooks.dirty);
    }
    const textOf = (node: ReactNode): string => Array.isArray(node) ? node.map(textOf).join("")
      : node && typeof node === "object" && "props" in node ? textOf((node as Element).props.children as ReactNode)
      : typeof node === "string" || typeof node === "number" ? String(node) : "";
    const button = (text: string) => hosts.find((host) => host.type === "button" && textOf(host) === text)!;
    const click = (host: Element) => {
      if (!host || host.props.disabled) throw new Error("Cannot click absent/disabled control");
      (host.props.onClick as () => void)(); render();
    };
    render();
    return { onObjectSelect, button, click,
      filter(query: string) { (hosts.find((host) => host.type === "input")!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: query } }); render(); },
      replace(replacement: Partial<TreeProps>) { props = { ...props, ...replacement }; render(); },
      rows: () => hosts.filter((host) => host.type === "li" && host.props["data-context"] === false).map((host) => host.props["data-path"] as string),
      hosts: () => hosts,
      text: () => hosts.filter((host) => host.type === "p" || host.type === "nav" || host.type === "section").map(textOf).join(" "),
    };
  }

  it("reaches all 67 synthetic distinct paths beyond forty through actual page controls", () => {
    const ui = mount();
    const reached = [...ui.rows()];
    expect(ui.button("Previous").props.disabled).toBe(true);
    for (let i = 0; i < 3; i++) { ui.click(ui.button("Next")); reached.push(...ui.rows()); }
    expect(reached).toEqual(entries.map((entry) => entry.path));
    expect(new Set(reached).size).toBe(67);
    expect(ui.text()).toContain("67 matching paths · Showing 61–67");
    expect(ui.button("Next").props.disabled).toBe(true);
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });

  it("filters paths and kinds across the whole plan and separates ancestor context from counts", () => {
    const ui = mount();
    ui.filter(" TOPIC ");
    expect(ui.text()).toContain("66 matching paths"); // Topics root matches by path too.
    ui.filter("topic-65.MD");
    expect(ui.rows()).toEqual(["Topics/topic-65.md"]);
    expect(ui.text()).toContain("1 matching path · Showing 1–1");
    const context = ui.hosts().filter((host) => host.type === "li" && host.props["data-context"] === true);
    expect(context.map((host) => host.props["data-path"])).toEqual(["Topics"]);
    expect(ui.hosts().some((host) => host.type === "span" && host.props.children === "folder context")).toBe(true);
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });

  it("resets a late page on filtering while retaining the original offpage selection", () => {
    const ui = mount();
    for (let i = 0; i < 3; i++) ui.click(ui.button("Next"));
    ui.filter("topic-01");
    expect(ui.rows()).toEqual(["Topics/topic-01.md"]);
    expect(ui.text()).toContain("Page 1 of 1");
    expect(ui.text()).toContain("Selected object: Synthetic topic-65 (topic-65)");
    expect(ui.button("topic-01.md").props["aria-pressed"]).toBe(false);
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });

  it("persists model-shrink clamping and never retargets removed or replaced objects", () => {
    const ui = mount();
    for (let i = 0; i < 3; i++) ui.click(ui.button("Next"));
    ui.replace({ entries: entries.slice(0, 3) });
    expect(ui.text()).toContain("Page 1 of 1");
    expect(ui.text()).toContain("Selected object: Synthetic topic-65 (topic-65)");
    ui.replace({ entries, objects: objects.filter((value) => value.id !== "topic-65").concat(object("replacement-65")) });
    expect(ui.text()).toContain("Page 1 of 4");
    expect(ui.text()).toContain("Selected object topic-65 is no longer in this World");
    expect(ui.hosts().filter((host) => host.type === "button" && host.props["aria-pressed"] === true)).toEqual([]);
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });

  it("preserves empty and implied folders and accumulates duplicate path sources", () => {
    const directory = [
      { path: "Assets", kind: "root", sourceIds: [] },
      { path: "Topics/nested/topic-65.md", kind: "topic", sourceIds: ["source-a"] },
      { path: "Topics/nested/topic-65.md", kind: "topic", sourceIds: ["source-b", "source-a"] },
    ];
    const tree = buildDirectoryTree(directory);
    const page = directoryTreePage(tree, "", 1);
    expect(page.nodes.map((node) => node.path)).toEqual(["Assets", "Topics", "Topics/nested", "Topics/nested/topic-65.md"]);
    expect(page.nodes.at(-1)!.sourceIds).toEqual(["source-a", "source-b"]);
    const ui = mount({ entries: directory });
    expect(ui.rows()).toEqual(page.nodes.map((node) => node.path));
    expect(ui.hosts().some((host) => host.type === "span" && host.props.title === "source-a, source-b")).toBe(true);
  });

  it("uses full-tree leaf binding and emits only the clicked compiled stable object ID", () => {
    const folder = buildDirectoryTree([{ path: "Topics/topic-65.md/child", kind: "package", sourceIds: [] }]);
    const page = directoryTreePage(folder, "topic-65.md", 1);
    expect(directoryObjectBinding(page.nodes.find((node) => node.path === "Topics/topic-65.md")!, objects)).toBeNull();
    const ui = mount();
    ui.filter("topic-65.md");
    expect(ui.button("topic-65.md").props["aria-pressed"]).toBe(true);
    ui.click(ui.button("topic-65.md"));
    expect(ui.onObjectSelect.mock.calls).toEqual([["topic-65"]]);
    ui.replace({ objects: objects.filter((value) => value.id !== "topic-65") });
    expect(ui.hosts().some((host) => host.type === "button" && host.props.title === "Topics/topic-65.md")).toBe(false);
    expect(ui.onObjectSelect.mock.calls).toEqual([["topic-65"]]);
  });

  it("keeps page matches reachable through accessible disclosure controls without changing selection", () => {
    const ui = mount();
    ui.filter("topic-65.md");
    const disclosure = () => ui.hosts().find((host) => host.type === "button" && String(host.props["aria-label"]).endsWith("Topics"))!;
    expect(disclosure().props["aria-label"]).toBe("Collapse Topics");
    ui.click(disclosure());
    expect(ui.rows()).toEqual([]);
    expect(disclosure().props["aria-expanded"]).toBe(false);
    ui.click(disclosure());
    expect(ui.rows()).toEqual(["Topics/topic-65.md"]);
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });

  it("renders empty results, missing plans and long paths without creating a selection", () => {
    const longName = "x".repeat(180) + ".md";
    const ui = mount({ entries: [{ path: `Topics/${longName}`, kind: "topic", sourceIds: [] }] });
    expect(ui.hosts().some((host) => host.props.children === longName && host.props.title === `Topics/${longName}`)).toBe(true);
    const input = ui.hosts().find((host) => host.type === "input")!;
    expect(ui.hosts().some((host) => host.type === "label" && host.props.htmlFor === input.props.id)).toBe(true);
    ui.filter("does-not-exist");
    expect(ui.text()).toContain("0 matching paths · Showing 0–0");
    expect(ui.text()).toContain("No directory paths match this filter");
    expect(ui.button("Previous").props.disabled).toBe(true);
    expect(ui.button("Next").props.disabled).toBe(true);
    ui.replace({ entries: [] });
    expect(ui.text()).toContain("No compiled directory plan to read");
    expect(ui.onObjectSelect).not.toHaveBeenCalled();
  });
});
