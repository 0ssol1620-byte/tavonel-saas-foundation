import { Fragment, type ReactNode } from "react";

/*
  BQ-103. The half of the row that was still missing: a code block that is not one flat tone.

  The row asked for Shiki. Shiki is not in this toolchain -- it is not a dependency of this
  package or a transitive one, `node_modules` has no highlighter in it at all -- and the design
  direction bars adding a runtime dependency for highlighting. So this is the other reading of the
  same requirement: tokenize at render time, in the server component, with what is already here.

  Two token classes, not twenty. The token contract has no syntax palette, and a real one would
  have to be invented -- and the colours that exist on this site already mean something
  (`--verified` is evidence, `--changed` is a diff, `--failed` is a failure). Borrowing one of
  them for "string literal" would be the third meaning for a colour that is supposed to have one.
  What is left is the text ramp, which is enough for the thing that actually costs a reader time:
  telling prose inside a block (a comment) from the command, and a literal from the syntax around
  it.

  The one invariant is that the characters are unchanged. Every branch below appends either a
  matched slice or the gap before it, in order, so the rendered text is the input by construction
  rather than by care -- a tokenizer that can quietly drop a character out of a curl command is
  worse than no tokenizer. `lib/docs-highlight.test.ts` pins it.
*/

/*
  Strings before comments in the alternation, and both anchored on real openers.

  `//` is guarded against a preceding colon, or every `https://tavonel.com/...` in the reference
  would render its own host as a comment. A `#` inside a quoted string is consumed by the string
  branch because that branch starts earlier in the input, and a quote inside a `#` comment is
  consumed by the comment branch for the same reason: `matchAll` scans by position, so the token
  that opens first wins without a rule saying so.
*/
const TOKEN = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|((?:#|(?<!:)\/\/)[^\n]*)/g;

export type CodeToken = { text: string; kind: "plain" | "string" | "comment" };

export function codeTokens(body: string): CodeToken[] {
  const out: CodeToken[] = [];
  let at = 0;
  for (const match of body.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ text: body.slice(at, start), kind: "plain" });
    out.push({ text: match[0], kind: match[1] ? "string" : "comment" });
    at = start + match[0].length;
  }
  if (at < body.length) out.push({ text: body.slice(at), kind: "plain" });
  return out;
}

/** The body of one code block, with comments and string literals set apart from the syntax. */
export function CodeTokens({ body }: { body: string }): ReactNode {
  return (
    <>
      {codeTokens(body).map((token, index) =>
        token.kind === "plain" ? (
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          <span className={token.kind === "string" ? "tok-str" : "tok-com"} key={index}>{token.text}</span>
        ),
      )}
    </>
  );
}

export default CodeTokens;
