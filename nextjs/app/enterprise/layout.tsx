import type { Metadata } from "next";
import "./enterprise.css";

export const metadata: Metadata = {
  title: "Enterprise control plane — TAVONEL",
  description: "Identity, governance, audit, residency and operating economics for TAVONEL organizations.",
};

export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
