import { createHash } from "node:crypto";

/*
  Agent proposals v1 (workorders/agent-native.md §2, §5.4; ADR docs/adr/0009-agent-proposals.md).
  Server only: it imports node:crypto. The consent copy a client panel renders lives in
  lib/agent-consent.ts, which imports nothing; this module does not re-export it.

  Every number below is a start value, uncalibrated: chosen for v1, not measured.
*/

type Env = Readonly<Record<string, string | undefined>>;

/** Disjoint from DEVELOPER_SCOPES; the database CHECK foundation_api_keys_scopes_by_kind_check holds it. */
export const AGENT_SCOPES = ["agent:read", "agent:propose"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** Requests per key per scope per minute. Start value, uncalibrated. */
export const AGENT_SCOPE_RATE_LIMITS: Readonly<Record<AgentScope, number>> = { "agent:read": 120, "agent:propose": 10 };
/** Lifetime of one agent credential. Start value, uncalibrated. */
export const AGENT_CREDENTIAL_TTL_DAYS = 30;
/** Open agent proposals per (workspace, person) across all their grants. Start value, uncalibrated. */
export const AGENT_OPEN_PROPOSALS_PER_PERSON = 200;
/** Items in one propose_library_labels call. Start value, uncalibrated. */
export const AGENT_LABEL_BATCH_MAX = 25;
/** Page sizes of the read tools. Start values, uncalibrated. */
export const AGENT_PAGE = { proposals: 50, jobs: 20, candidates: 20, objects: 100, documents: 100 } as const;
/** Store pages read to fill one page after the access filter. Start value, uncalibrated. */
export const AGENT_ACL_SCAN_PAGES = 4;
/** Body bound of POST /api/agent-mcp. Start value, uncalibrated. */
export const AGENT_MCP_MAX_BODY_BYTES = 8192;
/** maxDuration of the decision and undo routes. Start value, uncalibrated. */
export const DECISION_MAX_DURATION_S = 120;
/** A confirmed-but-unrecorded row may be resumed by its confirmer after this long (twice the route's maxDuration). Start value, uncalibrated. */
export const PROPOSAL_RESUME_AFTER_MS = 240_000;
/** Workspaces in TAVONEL_AGENT_PROPOSALS_COHORT. Start value, uncalibrated. */
export const AGENT_COHORT_MAX = 20;

export const AGENT_CREDENTIAL_PREFIX = "tvnl_agt_";

/** Exactly "true" turns the feature on; anything else, unset included, is off. */
export function agentProposalsEnabled(env: Env = process.env): boolean {
  return env.TAVONEL_AGENT_PROPOSALS_ENABLED === "true";
}

/**
 * TAVONEL_AGENT_PROPOSALS_COHORT: one to AGENT_COHORT_MAX exact workspace keys, comma-separated.
 * remoteMcpCohortRefusal's semantics without its "all" token: there is no general-availability value.
 * Unset, empty, malformed or wider than the cap admits nobody. Both refusals mean "outside the cohort".
 */
const COHORT_WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
export type AgentCohortRefusal = "AGENT_COHORT_EXCLUDED" | "AGENT_COHORT_CONFIG_INVALID";
export function agentProposalsCohortRefusal(workspaceKey: string, env: Env = process.env): AgentCohortRefusal | null {
  const ids = (env.TAVONEL_AGENT_PROPOSALS_COHORT ?? "").split(",").map((id) => id.trim());
  if (ids.length > AGENT_COHORT_MAX || !ids.every((id) => COHORT_WORKSPACE.test(id))) return "AGENT_COHORT_CONFIG_INVALID";
  return ids.includes(workspaceKey) ? null : "AGENT_COHORT_EXCLUDED";
}

/** The client's idempotency key, the same pattern as PROPOSAL_IDEMPOTENCY_KEY (lib/change-proposals.ts). */
export const AGENT_CLIENT_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The stored idempotency key of an agent proposal (§5.4): the agent names `clientKey`, the server
 * names everything else, so two grants, two tools or two batch items never share a key.
 * 'agt_' + base64url(sha256) = 47 characters, inside the stored-key pattern. Every part is checked:
 * no part can carry the separator, so two different inputs never hash the same text.
 */
export function deriveAgentIdempotencyKey(input: Readonly<{
  principalId: string; grantId: string; toolName: string; clientKey: string; index: number;
}>): string {
  const { principalId, grantId, toolName, clientKey, index } = input;
  if (!UUID.test(principalId) || !UUID.test(grantId) || !TOOL_NAME.test(toolName) || !AGENT_CLIENT_KEY.test(clientKey)
    || !Number.isSafeInteger(index) || index < 0 || index >= AGENT_LABEL_BATCH_MAX) {
    throw new TypeError("agent idempotency key input invalid");
  }
  const text = ["agent-proposal/1", principalId, grantId, toolName, clientKey, String(index)].join("\n");
  return `agt_${createHash("sha256").update(text, "utf8").digest("base64url")}`;
}
