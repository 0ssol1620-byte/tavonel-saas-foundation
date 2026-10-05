import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Google Drive identity — TAVONEL",
  description: "Link or remove your Google Drive identity so TAVONEL can check your access to Drive sources.",
  alternates: { canonical: "/workspace/google-drive-access" },
  openGraph: { url: "/workspace/google-drive-access" },
};

export default function GoogleDriveAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
