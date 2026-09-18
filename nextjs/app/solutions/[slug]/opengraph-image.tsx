import { notFound } from "next/navigation";
import { renderOgCard } from "@/lib/og-card";
import { SOLUTIONS, type SolutionSlug } from "./page";

export { alt, contentType, size } from "@/lib/og-card";

/* The five slugs from the record the page renders, so a sixth solution gets a card by existing. */
export function generateStaticParams() {
  return Object.keys(SOLUTIONS).map((slug) => ({ slug }));
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = SOLUTIONS[slug as SolutionSlug];
  // The page answers 404 for an unknown slug; a card for a page that does not exist previews nothing.
  if (!solution) notFound();
  return renderOgCard(solution.title, solution.lede);
}
