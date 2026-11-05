import type { Metadata, Viewport } from "next";
import { RemoteMcpAvailability } from "@/components/workspace/connect-ai-panel";
import { remoteMcpEnabled } from "@/lib/remote-mcp";

// Direction C (2026-11-04): the workspace stands on the warm canvas, so the browser chrome does too.
export const viewport: Viewport = { themeColor: "#F5F3EE", colorScheme: "light" };

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
  return <RemoteMcpAvailability enabled={remoteMcpEnabled()}>{children}</RemoteMcpAvailability>;
}
