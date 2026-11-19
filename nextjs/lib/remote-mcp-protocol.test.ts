import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* WO-D19-6: initialize negotiates the protocol revision; the header on later requests is checked. */

const mocks = vi.hoisted(() => ({
  toolCall: vi.fn(async () => null),
  timing: vi.fn(async () => "not_recorded"),
}));
vi.mock("@/lib/operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: mocks.toolCall,
}));
vi.mock("@/lib/operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: mocks.timing,
}));

import { POST as mcp } from "../app/api/mcp/route";
import { REMOTE_MCP_PROTOCOL_VERSIONS } from "./remote-mcp";

const ORIGIN = "https://tavonel.test";
const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  mcp(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
const init = (protocolVersion?: unknown, headers?: Record<string, string>) =>
  rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: protocolVersion === undefined ? {} : { protocolVersion } }, headers);
const negotiated = async (response: Response) => ((await response.json()) as { result: { protocolVersion: string } }).result.protocolVersion;

beforeEach(() => {
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
});
afterEach(() => vi.unstubAllEnvs());

describe("initialize protocol negotiation", () => {
  it.each(["2025-03-26", "2025-06-18"])("echoes a supported requested revision %s", async (version) => {
    expect(await negotiated(await init(version))).toBe(version);
  });

  it.each([["1999-01-01"], [undefined], [20250618], [null]])("answers the newest supported revision for %s", async (asked) => {
    expect(await negotiated(await init(asked))).toBe(REMOTE_MCP_PROTOCOL_VERSIONS[0]);
  });

  it("accepts a later request carrying the negotiated header", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, { "mcp-protocol-version": "2025-03-26" });
    expect(response.status).not.toBe(400);
  });

  it("refuses an unsupported header with 400 MCP_PROTOCOL_VERSION_UNSUPPORTED", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, { "mcp-protocol-version": "1999-01-01" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("MCP_PROTOCOL_VERSION_UNSUPPORTED");
  });

  it("stays 404 with the switch off", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "");
    expect((await init("2025-03-26")).status).toBe(404);
  });
});
