// `.one-path-ai-*` and `.one-path-more`: from the root layout to the routes that render them (WO-CI-16b).
import "@/app/one-path.css";
// WO-PERF-4: product-polish.css (`@layer overrides`) left globals.css for the routes that render its classes; it stays ahead of the two
// workspace sheets below, the same relative order inside `overrides` that it had in the root.
import "@/app/product-polish.css";
// The workspace sheets (`@layer overrides`), from globals.css to the routes that render them (WO-CI-16d).
import "@/app/workspace-final-polish.css";
import "@/app/workspace-no1.css";
import type { Metadata, Viewport } from "next";
import { OAuthProviderAvailability } from "@/components/connections-panel";
import { RemoteMcpAvailability } from "@/components/workspace/connect-ai-panel";
import { configuredOAuthProviders } from "@/lib/connector-oauth-secrets";
import { REMOTE_MCP_REFRESH_TTL_SECONDS, remoteMcpEnabled, remoteMcpRefreshEnabled } from "@/lib/remote-mcp";
import { trialAiAccessEnabled } from "@/lib/trial-ai-access";

// WO-WS-2 (2026-11-23): the workspace stands on the V34 paper (--v34-paper), so the browser chrome does too.
export const viewport: Viewport = { themeColor: "#f7f8f4", colorScheme: "light" };

export const metadata: Metadata = {
  alternates: { canonical: "/workspace" },
  openGraph: { url: "/workspace" },
  // Not a marketing page: an authenticated or transient surface must not be
  // indexed, and must not compete with a public page for the same canonical.
  robots: { index: false, follow: false },
  title: "Workspace — TAVONEL",
  description: "Your governed knowledge space.",
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // W1-A1: the Connect AI panel shows the hosted MCP URL only where this deployment serves it.
  // WO-REL-4: the source choices name an OAuth provider only where this deployment can connect it.
  return (
    // WO-FIRST5-P1: whether a free evaluation may connect and the refresh window, read here on the server, sent as a boolean and a day count.
    <RemoteMcpAvailability enabled={remoteMcpEnabled()} trialAiAccess={trialAiAccessEnabled()}
      refreshDays={remoteMcpRefreshEnabled() ? REMOTE_MCP_REFRESH_TTL_SECONDS / 86400 : null}>
      <OAuthProviderAvailability providers={configuredOAuthProviders()}>{children}</OAuthProviderAvailability>
    </RemoteMcpAvailability>
  );
}
