/*
  The connector chips under the workspace drop zone (live QA 2026-11-10).

  They listed Dropbox and OneDrive as "Read-only" while the connections page, reading the same
  deployment, offered only Google Drive: no OAuth app exists for the other two. The chips now take
  the provider list from the same /api/v1/oauth-connectors read and show only providers with an
  OAuth app. The other four are real: the local source agent reads a mounted share or an
  S3-compatible bucket (S3, R2, MinIO) with the customer's own credentials, so they are labelled
  by how they work, not by an availability claim.

  Connections are on the two subscription plans, named from lib/billing-catalog.ts so a plan
  rename reaches this copy. A free evaluation or a workspace with no plan gets the
  same answer the connections page gives, before anything is clicked.
*/
import { BILLING_OFFERS } from "./billing-catalog";

/** "Developer and Team" today; follows the catalog labels the pricing page renders. */
export const CONNECTION_PLANS = `${BILLING_OFFERS.observer_access.label} and ${BILLING_OFFERS.studio_access.label}`;

export type WorkspaceAccessSource = "owner" | "paid" | "trial" | "unentitled" | null;
export type OAuthProviderAvailability = { provider: string; configured: boolean };

const OAUTH_LABELS: Readonly<Record<string, string>> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  microsoft_graph: "OneDrive / SharePoint",
};

const AGENT_SOURCES = ["File server", "Amazon S3", "Cloudflare R2", "MinIO"] as const;

export type WorkspaceSourceChoices =
  | { kind: "pending" }
  | { kind: "plan_required" }
  | { kind: "choices"; choices: ReadonlyArray<{ name: string; availability: string }> };

export function workspaceSourceChoices(
  accessSource: WorkspaceAccessSource,
  providers: readonly OAuthProviderAvailability[],
): WorkspaceSourceChoices {
  if (accessSource === null) return { kind: "pending" };
  if (accessSource !== "owner" && accessSource !== "paid") return { kind: "plan_required" };
  return {
    kind: "choices",
    choices: [
      ...providers
        .filter((item) => item.configured && OAUTH_LABELS[item.provider])
        .map((item) => ({ name: OAUTH_LABELS[item.provider]!, availability: "Read-only" })),
      ...AGENT_SOURCES.map((name) => ({ name, availability: "Local source agent" })),
    ],
  };
}
