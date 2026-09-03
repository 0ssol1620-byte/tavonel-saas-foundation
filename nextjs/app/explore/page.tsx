import type { Metadata } from "next";
import ExploreCompiledWorld from "@/components/explore-compiled-world";
import { exploreSampleAnswers, exploreSampleDocuments, exploreSampleWorld } from "@/lib/explore-sample";

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

/*
  A server component so the compile happens once, at build time, on the server.

  `lib/explore-sample` reads three committed PDFs' extracted text layer, runs the production
  compiler over them and refuses to load if the result stops matching its frozen digest. Doing
  that here rather than in the browser keeps `node:crypto` and the compiler off the client
  bundle, and means the page ships the compiled World as data rather than shipping the compiler.
*/
export default function ExplorePage() {
  return (
    <ExploreCompiledWorld
      world={exploreSampleWorld}
      documents={exploreSampleDocuments}
      answers={exploreSampleAnswers}
    />
  );
}
