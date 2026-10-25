import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { remoteMcpEnabled } from "@/lib/remote-mcp";

// Read per request: the switch is a runtime environment value, not a build-time one.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/oauth/authorize" },
  openGraph: { url: "/oauth/authorize" },
  // A transient consent surface: never indexed, never a canonical competitor.
  robots: { index: false, follow: false },
  title: "Connect an AI client — TAVONEL",
  description: "Allow an MCP client to read this workspace's active Compiled Worlds, read-only.",
};

/* The remote MCP consent page (G11). It does not exist until TAVONEL_REMOTE_MCP_ENABLED is on. */
export default function OAuthAuthorizeLayout({ children }: { children: React.ReactNode }) {
  if (!remoteMcpEnabled()) notFound();
  return children;
}
