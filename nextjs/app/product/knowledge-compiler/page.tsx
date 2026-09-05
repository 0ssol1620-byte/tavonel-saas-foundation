import { permanentRedirect } from "next/navigation";

/**
 * The definitive Knowledge Compiler explanation lives at /knowledge-compiler.
 * Keeping a second canonical page for the same concept split search intent and left the shorter
 * page without a distinct product job. Preserve old inbound links with a permanent redirect.
 */
export default function ProductKnowledgeCompilerRedirect() {
  permanentRedirect("/knowledge-compiler");
}
