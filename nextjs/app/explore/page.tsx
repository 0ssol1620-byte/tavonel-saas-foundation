import type { Metadata } from "next";
import ExploreCompiledWorld from "@/components/explore-compiled-world";

export const metadata: Metadata = {
  title: "Explore a Compiled World | TAVONEL",
  /*
    The description follows the page, and the page stopped arguing.

    This read "Inspect a deterministic source-to-world sample", which is the same defensive
    register the visible copy shed: "deterministic" and "sample" together tell a searcher what
    the page is *not* before telling them what it does. The page is labelled a sample in its
    header badge, once, which is where masterplan 13.9 puts it. A description is a sales
    surface too, and this one now says the thing the hero says.
  */
  description: "Follow a compiled result back to the document version, the page and the exact region it came from.",
  alternates: { canonical: "/explore" },
  openGraph: { url: "/explore" },
};

export default function ExplorePage() {
  return <ExploreCompiledWorld />;
}