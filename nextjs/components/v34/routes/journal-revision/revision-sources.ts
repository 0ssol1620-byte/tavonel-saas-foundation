import type { ArticleSource } from "@/components/v34/ui/article-layout";

/** The NIST publications the article reads: the release announcement and the change summary it points to. */
export const REVISION_SOURCES: readonly ArticleSource[] = [
  {
    label: "NIST releases revision to SP 800-53 controls",
    href: "https://csrc.nist.gov/news/2025/nist-releases-revision-to-sp-800-53-controls",
    note: "The announcement of release 5.2.0, published on August 27, 2025.",
  },
  {
    label: "SP 800-53 release 5.2.0, summary of changes",
    href: "https://csrc.nist.gov/csrc/media/Projects/risk-management/800-53%20Comment%20Site/SP800-53-r5.2.0-changes.pdf",
    note: "The official list of what changed in the catalog.",
  },
];
