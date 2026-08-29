import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace — TAVONEL",
  description: "Your governed knowledge space.",
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
