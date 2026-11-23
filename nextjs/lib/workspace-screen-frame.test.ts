import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assertScreenStatus, Screen, type ScreenStatus } from "@/components/v34/ui/screen";
import WorkspaceUltimateShell from "@/components/workspace-ultimate-shell";
import {
  activationScreenStatus, AI_SETUP_SCREEN_STATUS, attentionScreenStatus, evidenceScreenStatus, readyScreenStatus, reviewScreenStatus, worldScreenStatus,
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
      surface: "home", headerAction: null, activeRevision, candidateReady: false, reviewCount: null, activityCount: 0,
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
    const ask = page.indexOf('<Screen title="Ask" status={worldScreenStatus(activeWorld?.revision ?? null)} aria-labelledby="ask-title">', wrapper);
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

describe("the frame's sheet reads the V34 tokens it may, at contrast", () => {
  const tokens = read("components/v34/tokens.module.css");
  const site = new Map([...(/\.site \{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "").matchAll(/(--v34-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const sheet = read("components/v34/ui/screen.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
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
    const top = colourOf(rule(".top"), "background");
    const screen = colourOf(rule(".screen"), "background");
    expect(contrast(colourOf(rule(".title"), "color"), top)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colourOf(rule(".tag"), "color"), top)).toBeGreaterThanOrEqual(4.5);
    for (const selector of [".dot", '.dot[data-tone="waiting"]']) expect(contrast(colourOf(rule(selector), "border"), top), selector).toBeGreaterThanOrEqual(3);
    expect(contrast(colourOf(rule('.dot[data-tone="stopped"]'), "border-color"), top)).toBeGreaterThanOrEqual(3);
    expect(contrast(colourOf(rule(".foot"), "color"), screen)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the three tones as three different shapes or colours, so a dot is never decoration", () => {
    const ok = rule(".dot");
    const waiting = rule('.dot[data-tone="waiting"]');
    const stopped = rule('.dot[data-tone="stopped"]');
    expect(ok).toMatch(/border:\s*4px solid var\(--v34-ok\)/);
    expect(waiting).toMatch(/border:\s*2px solid/);
    expect(stopped).toMatch(/border-color:\s*var\(--v34-error\)/);
  });
});
