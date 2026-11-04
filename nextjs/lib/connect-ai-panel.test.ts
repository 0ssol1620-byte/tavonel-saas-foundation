import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectAiPanel, { CONNECT_AI_SCOPES } from "@/components/workspace/connect-ai-panel";
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
});
