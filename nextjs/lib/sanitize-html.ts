/*
  Document-derived text on its way into a page, with the markup taken out of it.

  Every document this product reads is hostile input, and a cookbook is the first public surface
  that carries text lifted out of one -- an excerpt, a heading, the answer a run produced. React
  escapes what it interpolates, so a text node is already safe; what is not safe is the habit. A
  section body that arrives with `<script>` in it is a body somebody pasted out of a source, and
  the moment that string reaches an attribute, a JSON-LD payload or a markdown renderer somebody
  adds later, the escaping that used to be implicit is gone.

  So the text is cleaned where it enters the page instead of being trusted to stay in a text
  node. `lib/output-escaping.test.ts` holds the raw-HTML sinks in this app at two, both of them
  JSON-LD built from literals; this is the other half of that rule, for content that is not a
  literal.

  The ceiling is deliberate: no markup survives, and there is no allowlist of safe tags. No
  cookbook section needs one today, and a section that carries formatted document HTML is a new
  decision rather than a wider regular expression here.
*/

/** `<script>` and `<style>` take their contents with them. An unterminated one takes the rest. */
const ELEMENT_WITH_BODY = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/** Every other tag, and HTML comments, lose themselves and keep their text. */
const ANY_TAG = /<\/?[a-z][^>]*>?|<!--[\s\S]*?(?:-->|$)/gi;

export function sanitizeDocumentText(raw: string): string {
  return raw
    .replace(ELEMENT_WITH_BODY, " ")
    .replace(ANY_TAG, " ")
    .replace(/\s+/g, " ")
    .trim();
}
