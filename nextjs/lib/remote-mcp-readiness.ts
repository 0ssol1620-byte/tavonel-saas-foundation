import { remoteMcpCohortRefusal } from "./remote-mcp";
import { trialAiAccess } from "./trial-ai-access";
import { listFoundationActiveWorlds } from "./world-store";

/*
  D19 / F30-10: what the consent page may say before Allow. A public DTO: no workspace, user or key
  identifier. Side-effect free -- trialAiAccess is a pure decision (the route, not this file, writes
  the funnel line, and the usage read passes consume=false), and nothing here mints or revokes.
  `ready` is entitlement and cohort; `active_world` is advisory, because connecting before a World
  exists is allowed.
*/
export type RemoteMcpReadinessCheck = { id: "entitlement" | "cohort" | "active_world"; ok: boolean; code: string; action?: { href: string } };
export type RemoteMcpReadinessView = { code: "AUTHORIZATION_READINESS"; ready: boolean; checks: RemoteMcpReadinessCheck[] };

type Principal = Parameters<typeof trialAiAccess>[0];

export async function remoteMcpReadiness(principal: Principal): Promise<RemoteMcpReadinessView> {
  const trial = await trialAiAccess(principal, "mcp_authorize");
  const entitlement: RemoteMcpReadinessCheck = { id: "entitlement", ok: trial.ok, code: trial.ok ? "ENTITLEMENT_OK" : trial.code };
  const refusal = remoteMcpCohortRefusal(principal.workspaceKey);
  const cohort: RemoteMcpReadinessCheck = { id: "cohort", ok: refusal === null, code: refusal ?? "COHORT_OK" };
  const worlds = await listFoundationActiveWorlds(principal.workspaceKey, { limit: 1 }).catch(() => null);
  const activeWorld: RemoteMcpReadinessCheck = !worlds || !worlds.ok
    ? { id: "active_world", ok: false, code: "WORLD_STORE_READ_FAILED" }
    : worlds.worlds.length > 0
      ? { id: "active_world", ok: true, code: "ACTIVE_WORLD_OK" }
      : { id: "active_world", ok: false, code: "NO_ACTIVE_WORLD", action: { href: "/workspace/sources" } };
  return { code: "AUTHORIZATION_READINESS", ready: entitlement.ok && cohort.ok, checks: [entitlement, cohort, activeWorld] };
}
