import type { Metadata } from "next";
import ExploreCompiledWorld from "@/components/explore-compiled-world";

export const metadata: Metadata = {
  title: "Explore a Compiled World | TAVONEL",
  description: "Inspect a deterministic source-to-world sample with claims, relations, answers, and page-level evidence.",
  alternates: { canonical: "/explore" },
  openGraph: { url: "/explore" },
};

export default function ExplorePage() {
  return <ExploreCompiledWorld />;
}