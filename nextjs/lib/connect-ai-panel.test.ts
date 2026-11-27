import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectAiPanel, { CONNECT_AI_SCOPES, RemoteMcpAvailability } from "@/components/workspace/connect-ai-panel";
import { REMOTE_MCP_SCOPES } from "./remote-mcp";

describe("Connect AI panel (W1-A1)", () => {
  it("names exactly the scopes a remote MCP token can hold", () => {
    expect([...CONNECT_AI_SCOPES]).toEqual([...REMOTE_MCP_SCOPES]);
  });

  it("shows one MCP URL, the Claude steps first, and says no client handshake was verified", () => {
    const html = renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: true }, createElement(ConnectAiPanel)));
    expect(html).toContain("https://tavonel.com/api/mcp");
    expect(html).toContain("Add custom connector");
    expect(html).toContain("Add to ChatGPT");
    expect(html).toContain("has not yet completed this connection with Claude or ChatGPT");
    expect(html).toContain("The access lasts one hour");
    // A radio group, so the choice works with arrow keys and a screen reader without custom key handling.
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
  });

  it("takes availability from the server, so a switched-off deployment shows the local bridge and makes no 404 request", () => {
    const off = renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: false }, createElement(ConnectAiPanel)));
    // WO-REL-4: switched off, it names the local bridge and no hosted client (was "not switched on here yet").
    const localBridge = "An MCP client reads your active World through the local MCP bridge, with an API key from a paid plan.";
    expect(off).toContain(localBridge);
    expect(off).toContain(">Connect an MCP client<");
    expect(off).not.toMatch(/ChatGPT|Claude/);
    expect(off).toContain('class="btn btn-ghost" href="/docs/mcp"');
    expect(off).not.toContain("/api/mcp");
    const on = renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: true }, createElement(ConnectAiPanel)));
    expect(on).toContain("https://tavonel.com/api/mcp");
    expect(on).not.toContain(localBridge);
  });

  it("is switched off where no server said, the same as a server's false (WO-REL-4 closing round)", () => {
    const off = renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: false }, createElement(ConnectAiPanel)));
    const bare = renderToStaticMarkup(createElement(ConnectAiPanel));
    expect(bare).toBe(off);
    expect(bare).not.toContain("/api/mcp");
  });
});

/*
  WO-FIRST5-P1 (#11, #19): whether a free evaluation may connect, and how long access lasts, come
  from the server through the layout's provider -- a boolean and a day count, never an env value.
*/
describe("Connect AI panel for a free evaluation and the refresh window", () => {
  const render = (provider: Record<string, unknown>, panel: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: true, ...provider } as never, createElement(ConnectAiPanel, panel)));

  it("tells a free evaluation it cannot connect before it sets anything up, when trial AI access is off", () => {
    for (const provider of [{}, { trialAiAccess: false }]) {
      const html = render(provider, { trial: true });
      expect(html).toContain("A free evaluation cannot connect Claude or ChatGPT. A paid plan can.");
      expect(html).toContain('href="/pricing"');
      expect(html).not.toContain("/api/mcp");
      expect(html).not.toContain("Add custom connector");
    }
  });

  it("gives a free evaluation the steps when trial AI access is on, and a paid workspace always", () => {
    const trialOn = render({ trialAiAccess: true }, { trial: true });
    expect(trialOn).toContain("https://tavonel.com/api/mcp");
    expect(trialOn).toContain("A paid workspace or a free evaluation can connect.");
    const paid = render({ trialAiAccess: false });
    expect(paid).toContain("https://tavonel.com/api/mcp");
    expect(paid).toContain("A paid workspace can connect.");
    expect(paid).not.toContain("free evaluation");
  });

  it("states the one-hour access with refresh off and the renewal window with it on", () => {
    for (const refreshDays of [undefined, null, 0, -1, Number.NaN]) {
      const off = render({ refreshDays });
      expect(off).toContain("The access lasts one hour and is not renewed in the background");
      expect(off).not.toContain("renews while");
    }
    const on = render({ refreshDays: 30 });
    expect(on).toContain("The access renews while your assistant uses it and lasts up to 30 days without use.");
    expect(on).not.toContain("one hour");
  });

  it("is read by the layout on the server, from the flags' own readers", () => {
    const layout = readFileSync(new URL("../app/workspace/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("trialAiAccess={trialAiAccessEnabled()}");
    expect(layout).toContain("refreshDays={remoteMcpRefreshEnabled() ? REMOTE_MCP_REFRESH_TTL_SECONDS / 86400 : null}");
    expect(layout).not.toMatch(/process\.env/);
    const panel = readFileSync(new URL("../components/workspace/connect-ai-panel.tsx", import.meta.url), "utf8");
    expect(panel).not.toMatch(/process\.env|@\/lib\/(remote-mcp|trial-ai-access|developer-store)/);
  });
});
