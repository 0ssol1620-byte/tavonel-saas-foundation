import { permanentRedirect } from "next/navigation";

/**
 * BA-184. The reference is /docs; this was a stub the whole site linked to as "API reference".
 *
 * What stood here was thirty-eight lines: a hero, four one-line tiles, one curl command and two
 * buttons. No endpoint, no authentication detail, no error code, no response shape -- and the page
 * ended at y~800 of a 1,300px viewport. Meanwhile the twenty-two-section reference that answers
 * all four of those questions is at /docs, which the nav, the footer, /developers and /docs itself
 * were all calling "API reference" while pointing here. Two developer landings with opposite
 * information architectures, and the stub was winning the links.
 *
 * So the page is retired rather than grown. Growing it would have produced a second reference to
 * keep in step with the contract, which is the defect /docs was built to end. The 308 keeps every
 * inbound link -- ours and anyone else's -- arriving somewhere that answers the question.
 *
 * `permanentRedirect` is the pattern `app/product/knowledge-compiler/page.tsx` already uses, for
 * the same reason: a 308 rather than a `notFound()` stub, because this URL was published and is
 * linked from outside this repository, and no metadata of its own, because a redirect has no head
 * to declare. The in-repo links that pointed here are changed in this commit where this lane owns
 * them (/developers, /docs) and listed for the integrator where it does not (/sources,
 * /resources, and the `ROUTES` array in `app/sitemap.ts`).
 */
export default function ApiReferenceRedirect() {
  permanentRedirect("/docs");
}
