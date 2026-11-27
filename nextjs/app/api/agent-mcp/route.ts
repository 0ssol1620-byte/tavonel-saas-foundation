import { NextResponse } from "next/server";
import { AGENT_MCP_MAX_BODY_BYTES, agentProposalsCohortRefusal, agentProposalsEnabled } from "@/lib/agent-access";
import { agentTool, agentToolList, callAgentTool } from "@/lib/agent-mcp-tools";
import { authorizeAgentRequest } from "@/lib/developer-auth";
import { agentBearerChallenge } from "@/lib/agent-oauth";
import { REMOTE_MCP_PROTOCOL_VERSIONS, remoteMcpEnabled, requestOrigin } from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/*
  POST /api/agent-mcp (workorders/agent-native.md §2.3, §3; WO-AN-5). JSON-RPC 2.0, one message per POST, one JSON
  response. An agent credential (tvnl_agt_) works here and nowhere else; every request, initialize included,
  needs it. The nine tools read or propose; none decides.

  Order: flag off, or a cohort that admits nobody -> 404 before the body is read; body bound -> 413 (a declared
  Content-Length over it is refused at once, but the bound is counted on the bytes read from the stream, so a
  chunked or mis-declared body stops at the first chunk past it and nothing more is buffered); the bytes
  as UTF-8 JSON-RPC; authorizeAgentRequest with the tool's scope (it enters the agent dispatch for authentication
  alone; the tool handler runs outside it, so a REST helper a handler reaches never sees the agent audience); the
  caller's workspace outside the cohort -> 404; then the method. Every failure leaves as a constant code: an
  exception anywhere is UNAVAILABLE, never its text. Telemetry is {event, tool, code, decidingReadFailed} only;
  the last says whether a NOT_FOUND came from a deciding read that failed, and never reaches the agent (WO-AN-8).

  WO-AGENT-OAUTH-1 (hosted connectors): an Origin header that is not this origin is refused before the body, as
  /api/mcp does (Streamable HTTP; server-side clients send none). While the OAuth issuer is on
  (TAVONEL_REMOTE_MCP_ENABLED), a 401 carries the RFC 9728 challenge naming this resource's metadata, and a missing
  agent:propose a 403 insufficient_scope challenge, so a connector can discover sign-in and step up. Credential
  rules, codes and bodies are unchanged; a static agent credential works exactly as before.
*/

const NO_STORE = { "Cache-Control": "no-store" };
const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

function rpcError(status: number, id: unknown, code: number, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

/** The WWW-Authenticate header for a refused authorization, or none (issuer off, or a refusal no sign-in fixes). */
function challenge(origin: string, status: number, code: string, scope: string | undefined): Record<string, string> {
  if (!remoteMcpEnabled()) return {};
  // A revoked grant or a membership revision that moved is a 403 (status unchanged), but only a new sign-in fixes it: invalid_token.
  if (status === 401 || code === "API_KEY_AUTHORIZATION_REVOKED") {
    return { "WWW-Authenticate": agentBearerChallenge(origin, code === "AUTH_REQUIRED" ? undefined : { error: "invalid_token", description: code }) };
  }
  // Step-up names every scope the new consent needs: the authorization step refuses a request without agent:read.
  if (code === "API_SCOPE_REQUIRED" && scope) {
    const needed = scope === "agent:read" ? "agent:read" : `agent:read ${scope}`;
    return { "WWW-Authenticate": agentBearerChallenge(origin, { error: "insufficient_scope", description: `This tool needs ${scope}.`, scope: needed }) };
  }
  return {};
}
const rpcResult = (id: unknown, result: unknown) => NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: NO_STORE });

function telemetry(tool: string, code: string, decidingReadFailed = false) {
  console.info(JSON.stringify({ event: "agent_mcp_tool", tool, code, decidingReadFailed }));
}

/** The body's bytes, or null once they pass `cap`: the stream is cancelled there, so nothing past it is buffered. */
async function readBounded(request: Request, cap: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > cap) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
}

export async function POST(request: Request) {
  if (!agentProposalsEnabled() || agentProposalsCohortRefusal("") === "AGENT_COHORT_CONFIG_INVALID") return notFound();
  try {
    return await answer(request);
  } catch {
    return rpcError(503, null, -32603, "UNAVAILABLE");
  }
}

async function answer(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  const from = request.headers.get("origin");
  if (from !== null && from !== origin) return rpcError(403, null, -32000, "MCP_ORIGIN_REFUSED");
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !REMOTE_MCP_PROTOCOL_VERSIONS.includes(version)) return rpcError(400, null, -32600, "MCP_PROTOCOL_VERSION_UNSUPPORTED");
  // The response is JSON only: an Accept that names neither JSON nor a wildcard is refused before authorization and any write.
  const accept = request.headers.get("accept");
  if (accept !== null && !["application/json", "*/*"].some((type) => accept.toLowerCase().includes(type))) return rpcError(406, null, -32600, "NOT_ACCEPTABLE");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > AGENT_MCP_MAX_BODY_BYTES) return rpcError(413, null, -32600, "REQUEST_TOO_LARGE");
  const bytes = await readBounded(request, AGENT_MCP_MAX_BODY_BYTES);
  if (bytes === null) return rpcError(413, null, -32600, "REQUEST_TOO_LARGE");
  let message: unknown;
  try {
    // Not UTF-8 is a parse error, never a body decoded with replacement characters.
    message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return rpcError(400, null, -32700, "Parse error");
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || (message as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
    return rpcError(400, null, -32600, "Invalid Request");
  }
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  const rpcParams = params !== null && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  const calling = method === "tools/call";
  const tool = calling ? agentTool(rpcParams.name) : null;
  const toolLabel = tool?.name ?? "unknown";

  // Every request needs the agent credential; a propose tool spends a unit of agent:propose, anything else agent:read.
  const scope = tool?.scope ?? "agent:read";
  const auth = await authorizeAgentRequest(request, scope);
  if (!auth.ok) {
    const code = auth.code === "API_RATE_LIMITED" ? "RATE_LIMITED" : auth.code;
    if (calling) telemetry(toolLabel, code);
    return rpcError(auth.status, id, -32001, code, challenge(origin, auth.status, auth.code, scope));
  }
  // The cohort is re-read on every call, so removing a workspace stops its credentials at once.
  if (agentProposalsCohortRefusal(auth.principal.workspaceKey) !== null) return notFound();
  // WO-C-T3 (fail closed, as TC-D3 for the remote MCP): the agent tools list Worlds without a member's
  // source scope, so a member's agent is refused until those reads are scope-aware.
  if (auth.principal.workspaceRole !== "owner" && auth.principal.workspaceRole !== "admin") {
    if (calling) telemetry(toolLabel, "AGENT_MCP_MEMBER_UNAVAILABLE");
    return rpcError(403, id, -32001, "AGENT_MCP_MEMBER_UNAVAILABLE");
  }
  // A notification or a response: accepted, nothing to answer.
  if (typeof method !== "string" || id === undefined || id === null) return new NextResponse(null, { status: 202, headers: NO_STORE });

  switch (method) {
    case "initialize": {
      const asked = rpcParams.protocolVersion;
      const protocolVersion = typeof asked === "string" && REMOTE_MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : REMOTE_MCP_PROTOCOL_VERSIONS[0];
      return rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "tavonel-agent", version: "1" } });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: agentToolList() });
    case "tools/call": {
      if (!tool) {
        telemetry(toolLabel, "UNKNOWN_TOOL");
        return rpcError(200, id, -32602, "Unknown tool");
      }
      const result = await callAgentTool(tool, { principal: auth.principal, request }, rpcParams.arguments);
      telemetry(tool.name, result.ok ? "OK" : result.code, !result.ok && result.decidingReadFailed === true);
      return rpcResult(id, result.ok
        ? { content: [{ type: "text", text: JSON.stringify(result.output) }] }
        : { content: [{ type: "text", text: result.code }], isError: true });
    }
    default:
      return rpcError(200, id, -32601, "Method not found");
  }
}

/* The JSON response form only: no server-initiated stream. */
export function GET() {
  if (!agentProposalsEnabled()) return notFound();
  return new NextResponse(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}
