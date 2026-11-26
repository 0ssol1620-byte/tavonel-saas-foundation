import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assertScreenStatus, Screen, type ScreenStatus } from "@/components/v34/ui/screen";
import WorkspaceUltimateShell from "@/components/workspace-ultimate-shell";
import { ActiveWorldPicker, askWorldPanel, discoveryFailureCopy, type AskWorldState } from "@/components/workspace/in-page-choices";
import type { WorkspaceMode } from "@/lib/workspace-onboarding";
import {
  activationScreenStatus, AI_SETUP_SCREEN_STATUS, askScreenStatus, attentionScreenStatus, evidenceScreenStatus, homeWorldFact, homeWorldScreenStatus, readyScreenStatus, reviewScreenStatus, worldScreenStatus, type WorkspaceWorlds,
} from "@/app/workspace/screen-status";

/*
  WO-WS-4: the signed-in workspace draws its work surfaces in the blueprint's product "screen" frame
  (TARGET-DESIGN-SYSTEM §5: .screen > .screen-top (title + tag with status dot) + .screen-body + .screen-foot).
  What can go wrong without a browser noticing:
    1. a tag shows a state the page does not have -- a default for a missing revision, a count that is not
       a count, an attention item the frame does not know -- so the status derivations refuse instead;
    2. the frame drops what the e2e specs and the screen reader rely on (the section's id, its
       aria-labelledby, role="alert", the activation block's <output>) -- so the real component is rendered;
    3. the frame's colours read a token the V34 sheet does not declare, or miss contrast on the top bar.
*/

const walk = (dir: string): string[] =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const render = (props: Parameters<typeof Screen>[0]) => renderToStaticMarkup(createElement(Screen, props));

describe("the Screen frame, rendered", () => {
  it("draws top (title + tag with a dot), body and foot, and passes the section's own attributes through", () => {
    const html = render({
      id: "workspace-review", className: "world-studio", title: "Activate", status: { tone: "ok", label: "ACTIVE · REVISION 3" },
      statusAs: "output", foot: "Two sources", bodyClassName: "review-comparison", role: "alert", "aria-labelledby": "world-studio-title",
      children: createElement("h2", { id: "world-studio-title" }, "Make this the version your AI reads."),
    });
    expect(html).toMatch(/^<section [^>]*id="workspace-review"/);
    expect(html).toMatch(/<section [^>]*role="alert"/);
    expect(html).toMatch(/<section [^>]*aria-labelledby="world-studio-title"/);
    expect(html).toMatch(/<section [^>]*class="[^"]*world-studio"/);
    expect(html).toMatch(/<section [^>]*data-v34-screen=""/);
    // the order inside the frame: top, then body, then foot
    const top = html.indexOf(">Activate<");
    const body = html.indexOf("review-comparison");
    const foot = html.indexOf("Two sources");
    expect(top).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(top);
    expect(foot).toBeGreaterThan(body);
    expect(html).toMatch(/<output [^>]*data-tone="ok"[^>]*><i [^>]*data-tone="ok" aria-hidden="true"><\/i>ACTIVE · REVISION 3<\/output>/);
    expect(html).toContain('<h2 id="world-studio-title">Make this the version your AI reads.</h2>');
  });

  it("puts a heading title in the top bar with its id, and draws no foot when there is none", () => {
    const html = render({
      title: "Needs attention", titleAs: "h2", titleId: "workspace-attention-title", status: { tone: "stopped", label: "2 items" },
      children: createElement("ul", null),
    });
    expect(html).toMatch(/<h2 id="workspace-attention-title" class="[^"]*">Needs attention<\/h2>/);
    expect(html).toMatch(/<span [^>]*data-tone="stopped"/);
    // two children (top, body) and no third
    expect(html.match(/<div /g)?.length).toBe(2);
  });

  it("refuses a state it cannot draw: an unknown tone, a missing label, a blank title", () => {
    const base = { title: "Ask", children: "x" };
    expect(() => render({ ...base, status: { tone: "green" as never, label: "World v1 active" } })).toThrow("screen_status_tone_unknown");
    expect(() => render({ ...base, status: { tone: "ok", label: "  " } })).toThrow("screen_status_label_missing");
    expect(() => render({ ...base, status: undefined as unknown as ScreenStatus })).toThrow("screen_status_tone_unknown");
    expect(() => render({ ...base, title: " ", status: { tone: "ok", label: "x" } })).toThrow("screen_title_missing");
    expect(assertScreenStatus({ tone: "waiting", label: "No active World" })).toEqual({ tone: "waiting", label: "No active World" });
  });
});

describe("the state each workspace screen carries", () => {
  it("which World is active, in the words the Home facts line uses", () => {
    expect(worldScreenStatus(null)).toEqual({ tone: "waiting", label: "No active World" });
    expect(worldScreenStatus(3)).toEqual({ tone: "ok", label: "World v3 active" });
    expect(activationScreenStatus(null)).toEqual({ tone: "waiting", label: "NO ACTIVE WORLD" });
    expect(activationScreenStatus(2)).toEqual({ tone: "ok", label: "ACTIVE · REVISION 2" });
  });

  it("refuses a revision that is not a positive integer rather than drawing any World state", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3" as unknown as number, undefined as unknown as number]) {
      expect(() => worldScreenStatus(bad), String(bad)).toThrow("screen_status_revision_invalid");
      expect(() => activationScreenStatus(bad), String(bad)).toThrow("screen_status_revision_invalid");
    }
  });

  it("counts: what waits for review, what evidence can be opened, what is ready", () => {
    expect(reviewScreenStatus(0, true)).toEqual({ tone: "ok", label: "0 reasons to review" });
    expect(reviewScreenStatus(1, true)).toEqual({ tone: "waiting", label: "1 reason to review" });
    expect(reviewScreenStatus(4, true)).toEqual({ tone: "waiting", label: "4 reasons to review" });
    // No candidate: nothing has been cleared, so zero is not drawn as all clear.
    expect(reviewScreenStatus(0, false)).toEqual({ tone: "waiting", label: "0 reasons to review" });
    expect(() => reviewScreenStatus(0, undefined as unknown as boolean)).toThrow("screen_status_candidate_invalid");
    expect(evidenceScreenStatus(0)).toEqual({ tone: "waiting", label: "0 evidence records" });
    expect(evidenceScreenStatus(1)).toEqual({ tone: "ok", label: "1 evidence record" });
    expect(readyScreenStatus(0)).toEqual({ tone: "waiting", label: "0 ready" });
    expect(readyScreenStatus(33)).toEqual({ tone: "ok", label: "33 ready" });
  });

  it("refuses a count that is not a count (negative, fractional, NaN, infinite, not a number)", () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, null as unknown as number]) {
      expect(() => reviewScreenStatus(bad, true), String(bad)).toThrow(/screen_status_count_invalid/);
      expect(() => evidenceScreenStatus(bad), String(bad)).toThrow(/screen_status_count_invalid/);
      expect(() => readyScreenStatus(bad), String(bad)).toThrow(/screen_status_count_invalid/);
    }
  });

  it("needs attention: stopped for a refusal or a failed compile, waiting otherwise, never empty or unknown", () => {
    expect(attentionScreenStatus([{ id: "candidate-review" }])).toEqual({ tone: "waiting", label: "1 item" });
    expect(attentionScreenStatus([{ id: "operator-review" }, { id: "compile-failed" }])).toEqual({ tone: "stopped", label: "2 items" });
    expect(attentionScreenStatus([{ id: "refused" }])).toEqual({ tone: "stopped", label: "1 item" });
    expect(() => attentionScreenStatus([])).toThrow("screen_status_attention_empty");
    expect(() => attentionScreenStatus([{ id: "candidate-review" }, { id: "surprise" as never }])).toThrow("screen_status_attention_unknown:surprise");
  });

  it("the AI setup says what its own foot line says: nothing is verified", () => {
    expect(AI_SETUP_SCREEN_STATUS).toEqual({ tone: "waiting", label: "Connection not verified" });
    expect(read("components/workspace-use-with-ai.tsx")).toContain("An external AI connection has not been verified by this panel.");
  });
});

describe("the shell draws Home's state as a screen (the real component)", () => {
  const shell = (activeRevision: number | null, stateFacts?: string) => {
    const props: Parameters<typeof WorkspaceUltimateShell>[0] = {
      surface: "home", headerAction: null, activeRevision, stateMode: "returning", candidateReady: false, reviewCount: null, activityCount: 0,
      stateTitle: "2 sources are ready to compile.", stateDescription: "Choose which ready sources to compile.", stateFacts,
      stateHero: true, nextAction: { label: "Choose sources to compile", surface: "sources" },
      onNavigate: () => undefined, onUpload: () => undefined, onRefresh: () => undefined, onSignOut: () => undefined,
      children: null,
    };
    return renderToStaticMarkup(createElement(WorkspaceUltimateShell, props));
  };

  it("tags the screen with the active World and puts the counted facts in its foot", () => {
    const html = shell(null, "2 ready · 0 being read · 0 need review · No active World");
    const hero = /<section [^>]*aria-labelledby="workspace-state-title"[^>]*data-v34-screen=""[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(hero, "the state hero is a section labelled by its h1, in the frame").not.toBe("");
    expect(hero).toContain(">Overview<");
    expect(hero).toMatch(/data-tone="waiting"[^>]*><\/i>No active World</);
    expect(hero).toContain('<h1 id="workspace-state-title">2 sources are ready to compile.</h1>');
    expect(hero).toContain("2 ready · 0 being read · 0 need review · No active World");
    expect(shell(4)).toMatch(/data-tone="ok"[^>]*><\/i>World v4 active</);
  });

  it("keeps exactly the two h1 the shell has always printed", () => {
    expect(read("components/workspace-ultimate-shell.tsx").match(/<h1[ >]/g) ?? []).toHaveLength(2);
  });
});

/*
  Round 2: a tag may not say more than the page knows. The Ask body switches on `askWorldPanel(activeWorld, state)`; the tag is
  derived from that same value, so for every state the listing can be in the two are checked against each other here.
*/
describe("the Ask tag and the Ask body come from one observation and never disagree", () => {
  const world = (n: number) => ({ collectionId: `collection-${String(n).padStart(32, "0")}`, manifestDigest: `sha256:${"a".repeat(64)}`, revision: n, updatedAt: "2026-11-20T00:00:00Z" });
  const body = (state: AskWorldState) => {
    const panel = askWorldPanel(null, state);
    if (panel === "checking") return "Checking this workspace for an active World…";
    if (panel === "opening") return "Opening the active World…";
    if (panel === "none") return "No active World yet.";
    if (panel !== null && panel.kind === "several") return renderToStaticMarkup(createElement(ActiveWorldPicker, { worlds: panel.worlds, onChoose: () => undefined }));
    if (panel !== null && panel.kind === "failed") return discoveryFailureCopy(panel).title;
    return "The active World could not be opened.";
  };
  const tag = (state: AskWorldState) => askScreenStatus(null, askWorldPanel(null, state));

  it("the body strings used above are the ones the page prints", () => {
    const page = read("app/workspace/page.tsx");
    for (const text of ["Checking this workspace for an active World…", "Opening the active World…", "<strong>No active World yet.</strong>", "The active World could not be opened."]) {
      expect(page, text).toContain(text);
    }
  });

  it("loading: the listing has not answered, so the tag asserts no World state", () => {
    for (const state of ["idle", "checking"] as const) {
      expect(tag(state)).toEqual({ tone: "waiting", label: "Checking Worlds…" });
      expect(body(state)).toContain("Checking this workspace");
    }
    expect(tag("opening")).toEqual({ tone: "waiting", label: "Opening World…" });
    expect(body("opening")).toContain("Opening the active World");
  });

  it("error: a failed or refused listing, or an open that loaded nothing, is not 'no World'", () => {
    for (const state of [{ kind: "failed", code: null, status: null }, { kind: "failed", code: "X", status: 503 }, { kind: "failed", code: "X", status: 403 }] as const) {
      expect(tag(state)).toEqual({ tone: "waiting", label: "Worlds not checked" });
      expect(body(state)).toMatch(/could not be checked|may not list/);
    }
    expect(tag({ kind: "open-failed" })).toEqual({ tone: "waiting", label: "World not opened" });
    expect(body({ kind: "open-failed" })).toContain("could not be opened");
  });

  it("answered with none: the one state that says 'No active World', and the body says it too", () => {
    expect(tag({ kind: "none" })).toEqual({ tone: "waiting", label: "No active World" });
    expect(body({ kind: "none" })).toContain("No active World yet.");
  });

  it("answered with N: the tag carries the count the body prints", () => {
    const one: AskWorldState = { kind: "several", worlds: [world(1)] };
    const two: AskWorldState = { kind: "several", worlds: [world(1), world(2)] };
    expect(tag(one).label).toBe("1 active World");
    expect(body(one)).toContain("This workspace has 1 active World.");
    expect(tag(two).label).toBe("2 active Worlds");
    expect(body(two)).toContain("This workspace has 2 active Worlds.");
  });

  it("a loaded World is the only state that names a revision; 'No active World' is never drawn for any other state", () => {
    expect(askScreenStatus(4, askWorldPanel({ revision: 4 }, "idle"))).toEqual({ tone: "ok", label: "World v4 active" });
    expect(() => askScreenStatus(null, null)).toThrow("screen_status_ask_inconsistent");
    const states: AskWorldState[] = ["idle", "checking", "opening", { kind: "failed", code: null, status: null }, { kind: "open-failed" }, { kind: "several", worlds: [world(1), world(2)] }];
    for (const state of states) expect(tag(state).label, JSON.stringify(state)).not.toBe("No active World");
  });

  it("the page passes the tag the same panel it renders the body from", () => {
    const page = read("app/workspace/page.tsx");
    expect(page).toContain("const askPanel = askWorldPanel(activeWorld, askWorlds);");
    expect(page).toContain("askScreenStatus(activeWorld?.revision ?? null, askPanel)");
    expect(page).not.toContain('<Screen title="Ask" status={worldScreenStatus(');
  });
});

describe("the Home tag follows the state sentence it sits beside", () => {
  const shellHero = (stateMode: WorkspaceMode, stateTitle: string) => {
    const props: Parameters<typeof WorkspaceUltimateShell>[0] = {
      surface: "home", headerAction: null, activeRevision: null, stateMode, candidateReady: false, reviewCount: null, activityCount: 0,
      stateTitle, stateDescription: "x", stateHero: true, nextAction: { label: "Loading" },
      onNavigate: () => undefined, onUpload: () => undefined, onRefresh: () => undefined, onSignOut: () => undefined,
      children: null,
    };
    return renderToStaticMarkup(createElement(WorkspaceUltimateShell, props));
  };

  it("loading and unavailable make no claim about a World; the other modes name the active revision or none", () => {
    expect(homeWorldScreenStatus(null, "loading")).toEqual({ tone: "waiting", label: "Checking World…" });
    expect(homeWorldScreenStatus(null, "unavailable")).toEqual({ tone: "waiting", label: "World not checked" });
    expect(homeWorldScreenStatus(null, "returning")).toEqual({ tone: "waiting", label: "No active World" });
    expect(homeWorldScreenStatus(3, "returning")).toEqual({ tone: "ok", label: "World v3 active" });
  });

  it("the real shell draws it: 'Loading your knowledge.' never carries 'No active World'", () => {
    const loading = shellHero("loading", "Loading your knowledge.");
    expect(loading).toContain("Loading your knowledge.");
    expect(loading).toContain("Checking World…");
    expect(loading).not.toContain("No active World");
    const unavailable = shellHero("unavailable", "Your knowledge could not be loaded.");
    expect(unavailable).toContain("World not checked");
    expect(unavailable).not.toContain("No active World");
    expect(shellHero("returning", "2 sources are ready to compile.")).toContain("No active World");
  });

  it("the page hands the shell the mode the state sentence was derived from", () => {
    expect(read("app/workspace/page.tsx")).toContain("stateMode={workspaceState.mode}");
  });
});

describe("workspace confirmations are in-page (WO-WS-1)", () => {
  it("no native confirm in the workspace page or the panels it mounts", () => {
    for (const file of ["app/workspace/page.tsx", "components/connections-panel.tsx", "components/developer-panel.tsx"]) {
      expect(read(file), file).not.toMatch(/window\.confirm|(?<!await )(?<![.\w])confirm\(/);
    }
    expect(read("components/connections-panel.tsx").match(/await confirm\(/g)).toHaveLength(2);
    expect(read("components/developer-panel.tsx").match(/await confirm\(/g)).toHaveLength(1);
    const page = read("app/workspace/page.tsx");
    expect(page).toContain("<ConnectionsPanel confirm={confirmInPage} />");
    expect(page).toContain("<DeveloperPanel confirm={confirmInPage} />");
  });
});

describe("the page puts its work blocks in the frame, keeping the hooks the e2e specs read", () => {
  const page = read("app/workspace/page.tsx");
  const screenOpening = (marker: string) => {
    const at = page.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    const open = page.lastIndexOf("<Screen", at);
    expect(open, `${marker} sits on a <Screen>`).toBeGreaterThan(-1);
    const tag = page.slice(open, page.indexOf(">\n", open) + 1);
    expect(tag.includes(marker), `${marker} is an attribute of the nearest <Screen>`).toBe(true);
    return tag;
  };

  it("Review: the queue, the evidence reader and the activation block", () => {
    expect(screenOpening('aria-labelledby="review-queue-title"')).toContain("reviewScreenStatus(reviewCount, Boolean(collectionResult))");
    expect(screenOpening('aria-labelledby="review-comparison-title"')).toContain("evidenceScreenStatus(");
    const activation = screenOpening('aria-labelledby="world-studio-title"');
    expect(activation).toContain('id="workspace-review"');
    expect(activation).toContain('statusAs="output"');
    expect(activation).toContain("activationScreenStatus(activeWorld?.revision ?? null)");
  });

  it("Use with AI: two screens inside #workspace-ask, setup first", () => {
    const wrapper = page.indexOf('<div id="workspace-ask" className="ask-studio workspace-screens">');
    expect(wrapper).toBeGreaterThan(-1);
    const setup = page.indexOf("status={AI_SETUP_SCREEN_STATUS}", wrapper);
    const ask = page.indexOf('<Screen title="Ask" status={askScreenStatus(activeWorld?.revision ?? null, askPanel)} aria-labelledby="ask-title">', wrapper);
    expect(setup).toBeGreaterThan(wrapper);
    expect(ask).toBeGreaterThan(setup);
  });

  it("Home and Knowledge: attention keeps role=alert, the result and the next-World block are screens", () => {
    const attention = screenOpening('titleId="workspace-attention-title"');
    expect(attention).toContain('role="alert"');
    expect(attention).toContain('bodyClassName="workspace-attention"');
    expect(attention).toContain("attentionScreenStatus(attentionItems)");
    expect(screenOpening('titleId="workspace-complete-title"')).toContain('bodyClassName="workspace-complete"');
    const sources = screenOpening('id="workspace-sources"');
    expect(sources).toContain("readyScreenStatus(readyDocumentCount)");
  });
});

describe("the frame's sheet stays out of the public stylesheet", () => {
  it("lives in the workspace module, which only the workspace shell and the frame import; the public token sheet gained nothing", () => {
    expect(() => read("components/v34/ui/screen.module.css")).toThrow();
    expect(read("components/v34/ui/screen.tsx")).toContain('import s from "@/app/workspace/workspace-ultimate.module.css";');
    expect(read("components/v34/tokens.module.css")).not.toContain("--v34-radius-control");
    const importers = ["app", "components", "lib"].flatMap((dir) => walk(dir)).filter((file) => /workspace-ultimate\.module\.css"/.test(read(file)));
    expect(importers.sort()).toEqual(["components/v34/ui/screen.tsx", "components/workspace-ultimate-shell.tsx"]);
  });
});

describe("the frame's sheet reads the V34 tokens it may, at contrast", () => {
  const tokens = read("components/v34/tokens.module.css");
  const site = new Map([...(/\.site \{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "").matchAll(/(--v34-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  // The frame's rules are the end of the workspace module (round 2: a module of its own was merged into the public root stylesheet).
  const shellSheet = read("app/workspace/workspace-ultimate.module.css");
  const frameAt = shellSheet.indexOf('The product "screen" frame');
  if (frameAt < 0) throw new Error("the frame section is not in the workspace module");
  const sheet = shellSheet.slice(frameAt).replace(/\/\*[\s\S]*?\*\//g, "");
  const hex = (name: string) => {
    const value = site.get(name);
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a declared colour`);
    return value;
  };
  const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const rule = (selector: string) => {
    const body = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]"=]/g, "\\$&")} \\{([^}]*)\\}`).exec(sheet)?.[1];
    if (body === undefined) throw new Error(`no rule ${selector}`);
    return body;
  };
  const colourOf = (body: string, property: string) => {
    const name = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*[^;]*?var\\((--v34-[\\w-]+)\\)`).exec(body)?.[1];
    if (!name) throw new Error(`no ${property} token`);
    return hex(name);
  };

  it("reads no --v34-* name the token sheet does not declare", () => {
    const unknown = [...sheet.matchAll(/var\((--v34-[\w-]+)\)/g)].map((m) => m[1]).filter((name) => !site.has(name));
    expect(unknown).toEqual([]);
  });

  it("the top bar's title and tag read at 4.5:1 on its ground; the dots hold 3:1; the foot reads on the screen", () => {
    const top = colourOf(rule(".screenTop"), "background");
    const screen = colourOf(rule(".screen"), "background");
    expect(contrast(colourOf(rule(".screenTitle"), "color"), top)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colourOf(rule(".screenTag"), "color"), top)).toBeGreaterThanOrEqual(4.5);
    for (const selector of [".screenDot", '.screenDot[data-tone="waiting"]']) expect(contrast(colourOf(rule(selector), "border"), top), selector).toBeGreaterThanOrEqual(3);
    expect(contrast(colourOf(rule('.screenDot[data-tone="stopped"]'), "border-color"), top)).toBeGreaterThanOrEqual(3);
    expect(contrast(colourOf(rule(".screenFoot"), "color"), screen)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the three tones as three different shapes or colours, so a dot is never decoration", () => {
    const ok = rule(".screenDot");
    const waiting = rule('.screenDot[data-tone="waiting"]');
    const stopped = rule('.screenDot[data-tone="stopped"]');
    expect(ok).toMatch(/border:\s*4px solid var\(--v34-ok\)/);
    expect(waiting).toMatch(/border:\s*2px solid/);
    expect(stopped).toMatch(/border-color:\s*var\(--v34-error\)/);
  });
});

/*
  WO-WS-6, 2026-11-26 live run. Home said "No active World" while the workspace had three active Worlds and Ask listed them: the page's
  `activeWorld` is the one collection it has open, and the database keeps an active World per collection. Home now carries the
  workspace listing too, and says "No active World" only after that listing answered "none".
*/
describe("Home names the workspace's active Worlds, not only the open collection's (WO-WS-6, F1)", () => {
  const collectionId = (n: number) => `collection-${n.toString(16).padStart(32, "a")}`;
  const world = (n: number, updatedAt = "2026-11-26T09:44:22Z") => ({ collectionId: collectionId(n), manifestDigest: `sha256:${"b".repeat(64)}`, revision: n, updatedAt });
  const none: WorkspaceWorlds = { kind: "none" };
  const one: WorkspaceWorlds = { kind: "one", world: world(2) };
  const three: WorkspaceWorlds = { kind: "several", worlds: [world(1), world(2), world(3)] };
  const failed: WorkspaceWorlds = { kind: "failed", code: null, status: 503 };

  it("with no open World, the tag and the facts follow the listing", () => {
    expect(homeWorldScreenStatus(null, "returning", none)).toEqual({ tone: "waiting", label: "No active World" });
    expect(homeWorldScreenStatus(null, "returning", one)).toEqual({ tone: "ok", label: "World v2 active" });
    expect(homeWorldScreenStatus(null, "returning", three)).toEqual({ tone: "ok", label: "3 active Worlds" });
    expect(homeWorldFact(null, none)).toBe("No active World");
    expect(homeWorldFact(null, one)).toBe(`World v2 active (${collectionId(2).slice(0, 19)}…)`);
    expect(homeWorldFact(null, three)).toContain("3 active Worlds");
    expect(homeWorldFact(null, three)).toContain("Ask asks you to choose");
    expect(homeWorldFact(null, three)).toContain(collectionId(1).slice(0, 19));
  });

  it("a listing that has not answered, or failed, never says 'No active World'", () => {
    for (const worlds of ["checking", failed] as const) {
      expect(homeWorldScreenStatus(null, "returning", worlds).label, String(worlds)).not.toBe("No active World");
      expect(homeWorldFact(null, worlds), String(worlds)).not.toBe("No active World");
    }
    expect(homeWorldScreenStatus(null, "returning", "checking").label).toBe("Checking Worlds…");
    expect(homeWorldScreenStatus(null, "returning", failed).label).toBe("Worlds not checked");
    expect(homeWorldFact(null, "checking")).toBe("Checking Worlds…");
    expect(homeWorldFact(null, failed)).toBe("Worlds not checked");
  });

  it("an open World keeps its own revision, and says how many the workspace has when that is several", () => {
    expect(homeWorldScreenStatus(3, "returning", none)).toEqual({ tone: "ok", label: "World v3 active" });
    expect(homeWorldFact(3, one)).toBe("World v3 active");
    expect(homeWorldFact(3, three)).toBe("World v3 active here · 3 Worlds active in this workspace");
    expect(homeWorldFact(3, "checking")).toBe("World v3 active");
    expect(() => homeWorldFact(0, three)).toThrow("screen_status_revision_invalid");
  });

  it("without a listing the single-collection words are unchanged, and loading/unavailable still make no claim", () => {
    expect(homeWorldFact(null)).toBe("No active World");
    expect(homeWorldFact(5)).toBe("World v5 active");
    expect(homeWorldScreenStatus(null, "loading", three)).toEqual({ tone: "waiting", label: "Checking World…" });
    expect(homeWorldScreenStatus(null, "unavailable", none)).toEqual({ tone: "waiting", label: "World not checked" });
  });

  it("the real shell draws the listing's answer in the Home tag", () => {
    const props = (activeWorlds: WorkspaceWorlds): Parameters<typeof WorkspaceUltimateShell>[0] => ({
      surface: "home", headerAction: null, activeRevision: null, stateMode: "returning", candidateReady: false, reviewCount: null, activityCount: 0,
      stateTitle: "2 sources are ready to compile.", stateDescription: "x", stateHero: true, nextAction: { label: "Choose" }, activeWorlds,
      onNavigate: () => undefined, onUpload: () => undefined, onRefresh: () => undefined, onSignOut: () => undefined, children: null,
    });
    expect(renderToStaticMarkup(createElement(WorkspaceUltimateShell, props(three)))).toContain("3 active Worlds");
    expect(renderToStaticMarkup(createElement(WorkspaceUltimateShell, props(three)))).not.toContain("No active World");
    expect(renderToStaticMarkup(createElement(WorkspaceUltimateShell, props(none)))).toContain("No active World");
  });

  it("the page reads the listing for Home and hands it to the facts line and the shell", () => {
    const page = read("app/workspace/page.tsx");
    expect(page).toContain("homeWorldFact(activeWorld?.revision ?? null, workspaceWorlds)");
    expect(page).toContain("activeWorlds={workspaceWorlds}");
    expect(page).toContain("setWorkspaceWorlds(found)");
  });
});

describe("the review tags say when the evidence is not loaded instead of counting zero (WO-WS-6, F2)", () => {
  it("evidence: a read that has not answered is neither 0 nor a count", () => {
    expect(evidenceScreenStatus(0, "loading")).toEqual({ tone: "waiting", label: "Loading evidence…" });
    expect(evidenceScreenStatus(0, "unavailable")).toEqual({ tone: "waiting", label: "Evidence not loaded" });
    expect(evidenceScreenStatus(7, "unavailable")).toEqual({ tone: "waiting", label: "Evidence not loaded" });
    expect(evidenceScreenStatus(0, "ready")).toEqual({ tone: "waiting", label: "0 evidence records" });
    expect(evidenceScreenStatus(2)).toEqual({ tone: "ok", label: "2 evidence records" });
    expect(() => evidenceScreenStatus(-1, "ready")).toThrow("screen_status_count_invalid:evidence");
  });

  it("review: 0 recorded reasons beside evidence that is not loaded is not drawn as all clear", () => {
    expect(reviewScreenStatus(0, true, "ready")).toEqual({ tone: "ok", label: "0 reasons to review" });
    expect(reviewScreenStatus(0, true, "unavailable")).toEqual({ tone: "waiting", label: "0 reasons to review · evidence not loaded" });
    expect(reviewScreenStatus(2, true, "loading")).toEqual({ tone: "waiting", label: "2 reasons to review · evidence loading" });
    // No candidate: there is no evidence to be missing.
    expect(reviewScreenStatus(0, false, "unavailable")).toEqual({ tone: "waiting", label: "0 reasons to review" });
  });

  it("the page hands both tags the same evidence read the review queue is built from", () => {
    const page = read("app/workspace/page.tsx");
    expect(page).toContain("reviewScreenStatus(reviewCount, Boolean(collectionResult), evidenceRead)");
    expect(page).toContain("evidenceScreenStatus(worldReadModel?.evidence.length ?? 0, evidenceRead)");
    expect(page).toContain("    evidenceRead,\n");
  });

  it("the compile's counters name what they count: relations are edges, not a verified evidence binding", () => {
    expect(read("app/workspace/page.tsx")).not.toContain("evidence-bound relations");
  });
});

describe("one listing request, and an answer never outlives the World it was read for (WO-WS-6 review)", () => {
  const page = () => read("app/workspace/page.tsx");
  it("Home's effect and Ask's effect both read the listing through the one shared, keyed call", () => {
    const source = page();
    expect(source).toContain("const listActiveWorlds = (): Promise<ActiveWorldDiscovery> => {");
    expect(source).toContain("if (listingInflight.current?.key === key) return listingInflight.current.promise;");
    expect(source.match(/await listActiveWorlds\(\)|void listActiveWorlds\(\)/g)).toHaveLength(2);
    // The only direct caller of the listing is the shared call.
    expect(source.match(/discoverActiveWorlds\(token\)/g)).toHaveLength(1);
  });
  it("the open World changing puts the listing back to 'checking' before the new answer", () => {
    expect(page()).toContain('setWorkspaceWorlds("checking");\n    void listActiveWorlds()');
  });
  it("Home says how many earlier review packages are pending, from the job list already read", () => {
    const source = page();
    expect(source).toContain("setEarlierReviews(earlierReviewPackages(json.jobs ?? [], open));");
    expect(source).toContain('data-testid="earlier-review-packages"');
  });
});
