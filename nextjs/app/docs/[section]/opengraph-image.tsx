import { notFound } from "next/navigation";
import { DOCS_SECTIONS } from "@/lib/docs-content";
import { renderOgCard } from "@/lib/og-card";

export { alt, contentType, size } from "@/lib/og-card";

/*
  One card per documentation section, from the section's own record.

  The static list is what makes these prerender with the pages rather than being rendered on the
  first share; it is the same list `generateStaticParams` on the page uses, read from the same
  module, so a new section gets a card by existing.
*/
export function generateStaticParams() {
  return DOCS_SECTIONS.map((section) => ({ section: section.slug }));
}

export default async function OpengraphImage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const record = DOCS_SECTIONS.find((candidate) => candidate.slug === section);
  // The page answers 404 for an unknown slug; a card for a page that does not exist would be a
  // preview of nothing.
  if (!record) notFound();
  return renderOgCard(record.title, record.summary);
}
