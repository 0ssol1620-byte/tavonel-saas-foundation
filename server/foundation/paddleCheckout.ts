import type { WorkspaceMembership } from "../../shared/tenantDomain";
import { canAccessWorkspace } from "./tenantAuthorization";

const planCatalog = {
  observer: { label: "Observer", livePriceId: null },
  studio: { label: "Studio", livePriceId: null },
} as const;

export type CheckoutIntent =
  | { permitted: false; code: "FORBIDDEN" | "PLAN_NOT_FOUND" | "BILLING_NOT_CONFIGURED" }
  | { permitted: true; code: "READY"; planCode: keyof typeof planCatalog; priceId: string };

export function createCheckoutIntent({
  actorId,
  workspaceId,
  membership,
  planCode,
}: {
  actorId: string;
  workspaceId: string;
  membership: WorkspaceMembership | null | undefined;
  planCode: string;
}): CheckoutIntent {
  if (!canAccessWorkspace(membership, actorId, workspaceId, "workspace.manageBilling")) {
    return { permitted: false, code: "FORBIDDEN" };
  }
  if (!(planCode in planCatalog)) return { permitted: false, code: "PLAN_NOT_FOUND" };

  const plan = planCatalog[planCode as keyof typeof planCatalog];
  // Live price IDs are deliberately absent until Paddle sandbox catalog approval.
  if (!plan.livePriceId) return { permitted: false, code: "BILLING_NOT_CONFIGURED" };
  return { permitted: true, code: "READY", planCode: planCode as keyof typeof planCatalog, priceId: plan.livePriceId };
}
