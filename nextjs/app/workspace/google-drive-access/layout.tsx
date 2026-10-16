import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { googleDriveViewerLinkEnabled } from "@/lib/connector-oauth";

// Read per request: the flag is a runtime environment value, not a build-time one.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Google Drive identity — TAVONEL",
  description: "Link or remove your Google Drive identity so TAVONEL can check your access to Drive sources.",
  alternates: { canonical: "/workspace/google-drive-access" },
  openGraph: { url: "/workspace/google-drive-access" },
};

/*
  The page carries OAuth data-access wording that is founder-only and describes a flow production
  cannot start (the viewer-link RPCs exist only in supabase/drafts). Until
  TAVONEL_GOOGLE_VIEWER_LINK_ENABLED is on, the route does not exist.
*/
export default function GoogleDriveAccessLayout({ children }: { children: React.ReactNode }) {
  if (!googleDriveViewerLinkEnabled()) notFound();
  return children;
}
