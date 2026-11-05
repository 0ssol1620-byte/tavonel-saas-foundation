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
    const html = renderToStaticMarkup(createElement(ConnectAiPanel));
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
    expect(off).toContain("not switched on here yet");
    expect(off).toContain('class="btn btn-ghost" href="/docs/mcp"');
    expect(off).not.toContain("/api/mcp");
    const on = renderToStaticMarkup(createElement(RemoteMcpAvailability, { enabled: true }, createElement(ConnectAiPanel)));
    expect(on).toContain("https://tavonel.com/api/mcp");
    expect(on).not.toContain("not switched on");
  });
});
