import type { ReactNode } from "react";

/**
 * The two inline marks the documentation data actually uses, and nothing else.
 *
 * The content is data rather than MDX on purpose -- a markdown pipeline would let a section carry
 * a heading level, a link or a script that nothing here checks. So exactly two marks render:
 * `**bold**`, and the backticks that the error catalogue, the parameter descriptions and the
 * response descriptions already write around header names, field names and route paths. Those
 * backticks were reaching the page as literal characters, which is worse than not writing them:
 * a reader sees punctuation where the author meant "this is a token you type".
 *
 * One function, shared by /docs and /api, because the same strings render on both.
 */
export function withMarks(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}
