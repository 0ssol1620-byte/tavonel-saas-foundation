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
import { remoteMcpEnabled } from "@/lib/remote-mcp";

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
    <RemoteMcpAvailability enabled={remoteMcpEnabled()}>
      <OAuthProviderAvailability providers={configuredOAuthProviders()}>{children}</OAuthProviderAvailability>
    </RemoteMcpAvailability>
  );
}
