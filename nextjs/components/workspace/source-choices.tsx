import { useConfiguredOAuthProviders } from "@/components/connections-panel";

/*
  These are action labels, not qualification claims. Workspace tells a user how access works;
  /connect owns the evidence-backed support level and provider-specific limitations.

  WO-REL-4: a choice with an OAuth `provider` is shown only where this deployment can connect that
  provider (useConfiguredOAuthProviders: the workspace layout reads configuredOAuthProviders on the
  server), the same fact the Connections panel shows. Where no server said, no provider is shown.
  Connections are a paid-plan feature (lib/self-service-trial.ts), and a tile says so where it applies.
  Moved out of app/workspace/page.tsx so lib/workspace-source-choices.test.ts can render it.
*/
export const WORKSPACE_SOURCE_CHOICES = [
  { name: "Google Drive", availability: "Read-only", provider: "google_drive" },
  { name: "Dropbox", availability: "Read-only", provider: "dropbox" },
  { name: "OneDrive", availability: "Read-only", provider: "microsoft_graph" },
  { name: "Local folder", availability: "Command-line agent", provider: null },
  { name: "Amazon S3", availability: "Command-line agent", provider: null },
  { name: "Cloudflare R2", availability: "Command-line agent", provider: null },
  { name: "MinIO", availability: "Command-line agent", provider: null },
] as const;

export type WorkspaceAccessSource = "owner" | "paid" | "trial" | "unentitled" | null;

export function WorkspaceSourceChoices({ accessSource, onChoose }: { accessSource: WorkspaceAccessSource; onChoose: () => void }) {
  const configured = useConfiguredOAuthProviders();
  const paidOnly = accessSource === "trial" || accessSource === "unentitled";
  return (
    <div className="workspace-source-choices" aria-label="Available source connections">
      {WORKSPACE_SOURCE_CHOICES.filter((source) => source.provider === null || configured.includes(source.provider)).map((source) => (
        <button type="button" key={source.name} onClick={onChoose}>
          <span>{source.name}</span>
          <small>{paidOnly ? "Paid plan" : source.availability}</small>
        </button>
      ))}
    </div>
  );
}
