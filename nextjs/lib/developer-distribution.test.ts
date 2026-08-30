import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";

describe("developer distribution", () => {
  it("publishes a bounded API contract without decision endpoints", async () => {
    const response = openApi(new Request("https://tavonel.com/api/openapi"));
    const document = await response.json() as { paths: Record<string, unknown>; [key: string]: unknown };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/documents"]).toBeTruthy();
    expect(document.paths["/connections"]).toBeTruthy();
    expect(document.paths["/connections/{id}"]).toBeTruthy();
    expect(document.paths["/connections/{id}/sync"]).toBeTruthy();
    expect(Object.keys(document.paths).some((path) => path.includes("promote") || path.includes("rollback"))).toBe(false);
    expect(document["x-tavonel-decision-gates"]).toEqual({ promotion: "browser-session-only", rollback: "browser-session-only", mcp: "read-only" });
  });

  it("completes a real MCP initialize and exposes read-only tools only", () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const child = spawnSync(process.execPath, ["public/developer/tavonel-mcp.mjs"], { input: `${message}\n`, encoding: "utf8", timeout: 5_000 });
    expect(child.status).toBe(0);
    const response = JSON.parse(child.stdout.trim()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(response.result.serverInfo.name).toBe("tavonel-readonly");
    expect(response.result.instructions).toContain("No tool can upload, compile, promote");
  });

  it("ships a CLI that can render help without credentials", () => {
    const child = spawnSync(process.execPath, ["public/developer/tavonel-cli.mjs", "help"], { encoding: "utf8", timeout: 5_000 });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain("node tavonel-cli.mjs documents");
    expect(child.stdout).toContain("node tavonel-cli.mjs connections");
  });
});
