import { changelogEntries, changelogSections, changelogUpdatedAt } from "@/lib/changelog";

/*
  The Atom feed masterplan 13.3 asks for.

  Atom rather than RSS: it has a required, unambiguous `updated` timestamp and a required stable
  `id` per entry, which is exactly what a reader following a product's breaking changes needs.

  Built from the same `CHANGELOG` the page renders, so a release cannot reach one and not the
  other -- the failure that makes a feed worth less than no feed, because a subscriber believes
  they have seen everything.
*/

export const dynamic = "force-static";

const ORIGIN = "https://tavonel.com";

function escapeXml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return value.replace(/[&<>"']/g, (character) => entities[character]!);
}

export function GET() {
  const entries = changelogEntries();
  const body = entries.map((entry) => {
    const paragraphs = [
      ...(entry.breaking ? [`Breaking change: ${entry.breaking}`] : []),
      ...(entry.migration ? [entry.migration] : []),
      ...changelogSections(entry).flatMap(([label, items]) => [`${label}:`, ...items.map((item) => `- ${item}`)]),
    ];
    return `  <entry>
    <id>${ORIGIN}/changelog#${entry.date}</id>
    <title>${escapeXml(entry.title)}</title>
    <link rel="alternate" href="${ORIGIN}/changelog#${entry.date}"/>
    <updated>${entry.date}T00:00:00Z</updated>
    ${entry.surfaces.map((surface) => `<category term="${escapeXml(surface)}"/>`).join("\n    ")}
    <content type="text">${escapeXml(paragraphs.join("\n"))}</content>
  </entry>`;
  }).join("\n");

  const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${ORIGIN}/changelog</id>
  <title>TAVONEL changelog</title>
  <link rel="self" href="${ORIGIN}/changelog/feed.xml"/>
  <link rel="alternate" href="${ORIGIN}/changelog"/>
  <updated>${changelogUpdatedAt()}T00:00:00Z</updated>
${body}
</feed>
`;

  return new Response(feed, {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
