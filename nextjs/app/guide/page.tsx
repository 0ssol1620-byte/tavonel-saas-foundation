import type { Metadata } from "next";
import { GuidePage } from "@/components/guide/guide-page";
import { pageMetadata } from "@/lib/page-seo";

/* EN-1. The product guide; the copy is `lib/guide-content.ts`, the page is `components/guide/guide-page.tsx`. */
export const metadata: Metadata = pageMetadata({
  title: "Product guide — TAVONEL",
  description: "Use what TAVONEL offers today, step by step: the public Compiled World, its evidence and changes, the signed sample, API reads with no key, the developer files and the MCP bridge.",
  canonical: "/guide",
  languages: { en: "/guide", ko: "/ko/guide", "x-default": "/guide" },
});

export default function Page() {
  return <GuidePage language="en" />;
}
