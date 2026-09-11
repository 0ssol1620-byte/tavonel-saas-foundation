/*
  §12.4 -- the Korean subtree says it is Korean.

  The root layout hard-codes `<html lang="en">`, and a nested layout cannot change an attribute
  on an element it does not render. It can declare the language of the subtree it does render,
  which is what this does: one wrapper carrying `lang="ko"`, so a screen reader picks the right
  voice and a crawler is not told that Korean prose is English. An hreflang tag that claims a
  Korean alternate over a document declaring `lang="en"` is the annotation disagreeing with the
  page it annotates, and the page wins.

  No metadata here on purpose. `/ko` declares its own title, description, canonical and
  hreflang set through `lib/page-seo.ts`; a second declaration in this layout would be
  inherited by the next page added under `/ko` and would give that page `/ko`'s address.
*/
export default function KoreanLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div lang="ko">{children}</div>;
}
