import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FUNNEL_DETAIL_KEYS, allowedDetail } from "./funnel-events";

/*
  The privacy sentence at the top of `funnel-events.ts`, made checkable.

  Instrumenting Explore was harmless -- a public sample world and three prepared questions. §26
  also asks for seven workspace events, and that is a signed-in, tenant-scoped surface where the
  most convenient value to attach to every one of them is a forbidden one: the collection id, the
  filename, the question the customer typed, the reason a reviewer wrote. The type stops a call
  site that compiles against this file. This stops the key list itself from drifting, and pins the
  runtime drop so a caller that reaches `trackFunnel` some other way still cannot post one.
*/
describe("funnel event property allowlist", () => {
  /*
    Named individually rather than matched by a pattern. A regex would happily admit a key called
    `sourceName`, and the point of the list is that a new key costs somebody a decision.
  */
  it("holds no key that could carry an identifier or a user string", () => {
    expect([...FUNNEL_DETAIL_KEYS]).toEqual(["act", "cta", "family", "filter", "from", "kind", "lifecycle", "mode", "offer", "plan", "plans", "scene", "sources", "status"]);
    for (const forbidden of ["id", "documentId", "collectionId", "filename", "file", "name", "path", "question", "prompt", "text", "query", "reason", "email", "user", "digest", "title"]) {
      expect(FUNNEL_DETAIL_KEYS as readonly string[], `${forbidden} is not an enumerated UI state`).not.toContain(forbidden);
    }
  });

  it("drops a property that is not on the list instead of forwarding it", () => {
    expect(allowedDetail({ kind: "Claim" })).toEqual({ kind: "Claim" });
    expect(allowedDetail({ kind: "Claim", documentId: "doc-1" } as never)).toEqual({ kind: "Claim" });
    expect(allowedDetail({ documentId: "doc-1" } as never)).toBeUndefined();
    expect(allowedDetail()).toBeUndefined();
    // A non-string is not a "count stringified by the caller"; it is a value that arrived by
    // accident, and an object serialized into an event property is how source text escapes.
    expect(allowedDetail({ scene: 3 } as never)).toBeUndefined();
  });
});

/*
  `funnel-events.ts` has said since it was written that a name with no call site is a funnel
  column that is always zero, and reads as a broken step rather than an unbuilt one. Four names
  were in that state -- `offer_selected`, `film_stage_selected`, `world_lens_selected`,
  `workspace_command_used` -- for as long as the rule had only a comment enforcing it. Whoever
  reads that dashboard cannot tell a step nobody reached from a step nothing fires.

  Source text, not module inspection: the union is a type and vanishes at runtime, and the thing
  worth checking is whether a caller exists in the shipped tree, which is a fact about files.
*/
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    // A test naming every event would satisfy every assertion below, this file included.
    else if ([".ts", ".tsx"].includes(extname(entry)) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const modulePath = resolve(import.meta.dirname, "./funnel-events.ts");
const moduleSource = readFileSync(modulePath, "utf8");
const declaredEvents = [...moduleSource.matchAll(/^\s*\|\s*"([a-z_]+)";?$/gm)].map((match) => match[1]);

/*
  The union's own lines are struck out of the corpus and the rest of the module is kept. The
  declaration is not a call site; `trackSceneDepth`, three functions further down, is -- it is the
  only wrapper that names an event itself, and dropping the whole file would make `scene_reached`
  look dead when what it actually has is one indirection.
*/
const callSites = ["../app", "../components", "../lib"]
  .flatMap((path) => sourceFiles(resolve(import.meta.dirname, path)))
  .map((path) => (path === modulePath ? moduleSource.replace(/^\s*\|\s*"[a-z_]+";?$/gm, "") : readFileSync(path, "utf8")))
  .join("\n");

describe("every declared funnel event has a control that fires it", () => {
  /*
    The last member of the union ends with `;` and the first draft of this regex did not allow for
    it, so the extraction silently dropped one name and the class below quietly stopped covering
    it. An under-extraction is the failure mode that makes a per-name test look thorough while
    testing less than it says, so the boundary is named: first member, last member, and the count.
  */
  it("extracts every member of the union, including the one that ends it", () => {
    expect(declaredEvents.at(0)).toBe("login_reached_with_intent");
    expect(declaredEvents.at(-1), "the trailing `;` member was dropped by the extraction").toBe("workspace_ai_connect_opened");
    expect(declaredEvents.length).toBe(new Set(declaredEvents).size);
    expect(declaredEvents.length).toBeGreaterThan(20);
    expect(declaredEvents).toContain("workspace_compile_failed");
    expect(declaredEvents).toContain("checkout_completed");
    expect(declaredEvents).toContain("signed_in");
  });

  it.each(declaredEvents)("%s is fired from somewhere", (event) => {
    expect(callSites.includes(`"${event}"`), `${event} is declared and never fired -- wire it to its control or delete the name`).toBe(true);
  });

  /*
    Both halves of the corpus, named. Without the strike-out every event passes by matching its
    own declaration; without the module body `scene_reached` fails for having a wrapper.
  */
  it("reads the module body but not the union that declares the names", () => {
    expect(callSites.includes("trackFunnel(\"scene_reached\""), "the module body is not in the corpus, so a wrapper's event reads as dead").toBe(true);
    expect(callSites.includes("| \"cta_clicked\""), "the union is in the corpus, so every name matches its own declaration").toBe(false);
    expect(callSites.includes("\"film_stage_selected\""), "a name deleted for having no caller is back in the tree").toBe(false);
  });
});
