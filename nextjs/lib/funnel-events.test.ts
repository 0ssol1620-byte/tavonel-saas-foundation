import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FUNNEL_DETAIL_KEYS, allowedDetail, recordServerFunnel } from "./funnel-events";

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
  There are two unions now, and the extraction above reads both: `FunnelEvent`, fired from a
  control in a browser, and `ServerFunnelEvent`, fired from a server state that already
  happened. Every rule in this file applies to both -- a name with no caller is a funnel column
  that is always zero whichever sink it belongs to -- so the members are separated only for the
  assertions where the two unions actually differ.

  Sliced rather than counted by line shape, and `+ 1` on the end index for the final member,
  whose closing quote is immediately before the `;` that ends the declaration.
*/
function unionMembers(name: string): string[] {
  const start = moduleSource.indexOf(`export type ${name} =`);
  if (start < 0) throw new Error(`${name} is not declared in funnel-events.ts`);
  const body = moduleSource.slice(start, moduleSource.indexOf('";', start) + 1);
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}
const clientEvents = unionMembers("FunnelEvent");
const serverEvents = unionMembers("ServerFunnelEvent");

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
    testing less than it says, so the count is checked against the union counted a second way.

    Counting rather than naming the boundary members, because a first draft of *this* assertion
    pinned the first member by name and a merge that added an event above it turned a correct
    extraction red. The invariant is "every declared name was extracted", not "the union begins
    with a particular event".
  */
  it("extracts every member of both unions, including the one that ends each", () => {
    // Counted a second way, from the union text rather than from the line shape the extraction
    // anchors on, so a mistake in one is not repeated in the other. Summed across both unions:
    // a `ServerFunnelEvent` member the line extraction dropped would otherwise look like a
    // client event nobody had added yet.
    expect(declaredEvents.length, "a member was dropped by the extraction -- the last one in each union ends with `;`").toBe(clientEvents.length + serverEvents.length);
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

/*
  §15.2's rule, made checkable: a product event is a server state or a real consumer receipt, and
  an export click is not a package verified.

  The check above would pass a `ServerFunnelEvent` fired from a button, which is the exact
  mistake the second union exists to prevent, so this one is narrower: each server event's call
  site has to be inside a route handler. That is not a style preference. A name that means "the
  server accepted the work" and fires from an onClick reports intent as outcome, and the funnel
  it feeds cannot tell the difference afterwards.
*/
const routeHandlers = sourceFiles(resolve(import.meta.dirname, "../app/api"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/*
  The browser union as it stood before the server half was added.

  Pinned as names and asserted as a subset, not as a count: a later surface may add a browser
  event -- that is what the call-site rule is for -- but none of these may be renamed, redefined
  or dropped, because each one is a column somebody is already reading. A count would have made
  an addition fail and a rename pass, which is precisely backwards.
*/
const BROWSER_EVENTS_BEFORE_THE_SERVER_HALF = [
  "generate_lead", "login_reached_with_intent", "signed_in", "checkout_opened", "checkout_completed",
  "scene_reached", "cta_clicked", "source_filter_changed", "hero_explore_clicked", "hero_start_clicked",
  "pricing_plan_viewed", "pricing_start_clicked", "source_category_viewed", "developer_mcp_started",
  "developer_api_started", "explore_entered", "explore_object_selected", "explore_evidence_opened",
  "explore_change_opened", "explore_ask_used", "explore_to_signup", "workspace_first_source_added",
  "workspace_compile_started", "workspace_compile_failed", "workspace_candidate_ready",
  "workspace_review_required", "workspace_world_activated", "workspace_first_ask",
  "workspace_ai_connect_opened",
];

describe("server funnel events", () => {
  it("renames, redefines and drops none of the browser events", () => {
    expect(BROWSER_EVENTS_BEFORE_THE_SERVER_HALF).toHaveLength(29);
    for (const event of BROWSER_EVENTS_BEFORE_THE_SERVER_HALF) {
      expect(clientEvents, `${event} left the browser union -- a column somebody reads went to zero`).toContain(event);
    }
  });

  it("has a union of its own that redefines none of the browser names", () => {
    expect(serverEvents.length).toBeGreaterThan(0);
    for (const event of serverEvents) {
      expect(clientEvents, `${event} is in both unions -- one name cannot mean a click and a server state`).not.toContain(event);
    }
    // The renamed one, and why. `package_verified` would need a consumer telling us it checked a
    // signature; nothing in this deployment calls `verifyExportSignature` on a consumer's
    // behalf, so what is measured is what the name says.
    expect(serverEvents).toContain("export_package_signed");
    expect(serverEvents).not.toContain("package_verified");
  });

  /*
    At-least-once delivery, made checkable at the three call sites where a redelivered request
    would inflate a funnel step. Every one of them has a record that already distinguishes a
    fresh application from a replay, and the whole point of an idempotent write is that the
    retry succeeds -- so a handler that fires on its own 200 counts one start twice.

    `compile_started` is the one that matters most: it is the numerator of
    `starts_without_candidate_or_approval` in `activation-cohorts.ts`, so an inflated count reads
    as compiles that never reached a candidate, which is a product failure that did not happen.

    Source text rather than a route invocation: the fact worth pinning is that the guard is in
    the shipped handler, and exercising these three routes needs an auth, a Supabase and a
    Paddle-signature harness that would pin the mocks instead.
  */
  it("fires no server event for a redelivered request that changed nothing", () => {
    const route = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
    const compileJobs = route("app/api/compile-jobs/route.ts");
    // `enqueueCompileJob` returns `created: false` when the idempotency key matched a job that
    // is already enqueued; `enqueueCorpusCompile` passes the same flag up per part.
    expect(compileJobs).toContain("corpus.value.parts.some((part) => part.created)");
    expect(compileJobs).toContain("if (enqueued.value.created) {");
    expect(route("app/api/collections/[id]/ask/route.ts")).toContain("!lease.replay");
    // The billing projection answers an event it has already stored with this status.
    expect(route("app/api/paddle/webhook/route.ts")).toContain('applied.result.status !== "duplicate"');
  });

  it.each(serverEvents)("%s fires from a route handler, not from a control", (event) => {
    expect(routeHandlers.includes(`"${event}"`), `${event} has no call site under app/api -- a server event fired from a component reports a click as an outcome`).toBe(true);
  });

  it("emits one structured line and drops a key that is not on the allowlist", () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    try {
      recordServerFunnel("world_activated", { status: "compiled", sources: "3" });
      // The keys a route would find most convenient to attach are the forbidden ones. The type
      // rejects them at the call site; this is the runtime half, on the server sink too.
      recordServerFunnel("candidate_ready", { mode: "durable", collectionId: "col-1", question: "what is the revenue" } as never);
    } finally {
      info.mockRestore();
    }
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ event: "world_activated", status: "compiled", sources: "3" });
    expect(JSON.parse(lines[1])).toEqual({ event: "candidate_ready", mode: "durable" });
    expect(lines[1]).not.toContain("col-1");
    expect(lines[1]).not.toContain("revenue");
  });

  /*
    Consent is a browser fact, and a route handler cannot ask. So the server sink is the process
    log -- the same shape `app/api/csp-report/route.ts` already writes -- and not the external
    collector `trackFunnel` posts to. A server event that reached `track()` would be a signed-in
    customer's activity posted to a third party on nobody's consent.
  */
  it("does not post a server event to the external analytics collector", () => {
    const body = moduleSource.slice(moduleSource.indexOf("export function recordServerFunnel"));
    expect(body).toContain("console.info");
    expect(body.slice(0, body.indexOf("\n}"))).not.toContain("track(");
  });
});

/*
  B5. What the recipe hop is actually measured by, on the merged tree.

  Three lanes met here and each left the same three §15.2 names unbuilt -- `recipe_start_clicked`,
  `recipe_resumed`, `preflight_confirmed` -- for the same reason: this file's rule is that a name
  needs its control in the same commit, and the control belonged to a different lane each time.
  Both lanes solved their half with an existing event and an allow-listed detail key instead, which
  is the right answer and is also the answer nothing asserted. So it is asserted here: the two real
  call sites, the keys the values travel under, and the fact that the three names are still absent.

  The last of those matters most. A declared-but-unfired name is caught by the per-name test above;
  a name nobody declared is caught by nothing, and the failure it causes is a reader of the funnel
  looking for a recipe-start column, finding none, and concluding the hop is not measured when what
  it has is a different label.

  And the cookbook route: it stays a server component with no client JavaScript. A `content_view`
  or a click event there would mean a client component on a page whose whole body is server-rendered
  text, and it would be the first client JS on that route. That is a trade worth making
  deliberately, not one worth arriving at by adding an event.
*/
describe("the recipe hop is measured by the events that exist", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
  const loginPage = read("../app/login/page.tsx");
  const callbackPage = read("../app/auth/callback/page.tsx");
  const cookbookPage = read("../app/cookbooks/[slug]/page.tsx");

  it("records reaching the sign-in with a recipe, and resuming into one", () => {
    expect(loginPage).toContain('trackFunnel("login_reached_with_intent", { kind: "recipe" })');
    expect(callbackPage).toContain('trackFunnel("signed_in"');
    expect(callbackPage).toContain('"resume-recipe"');
    // Both values travel under keys that were already on the allowlist. No key was added for this.
    expect(FUNNEL_DETAIL_KEYS as readonly string[]).toContain("kind");
    expect(FUNNEL_DETAIL_KEYS as readonly string[]).toContain("mode");
  });

  it("declares none of the three §15.2 names no lane had a control for", () => {
    for (const absent of ["recipe_start_clicked", "recipe_resumed", "preflight_confirmed"]) {
      expect(declaredEvents, `${absent} is declared: it needs its call site in this commit`).not.toContain(absent);
      expect(callSites.includes(`"${absent}"`), `${absent} is fired but not declared`).toBe(false);
    }
  });

  it("keeps the cookbook route free of client JavaScript", () => {
    for (const pattern of ['"use client"', "trackFunnel", "onClick", "useEffect", "useState", "next/dynamic"]) {
      expect(cookbookPage, `${pattern}: the cookbook route is server-rendered text and stays that way`)
        .not.toContain(pattern);
    }
  });
});
