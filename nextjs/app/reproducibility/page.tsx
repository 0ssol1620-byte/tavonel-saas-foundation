import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";
import { TrustNext } from "@/components/trust-next";

/*
  Noindex until there is a run to reproduce.

  Most of what this page could say is what is missing: there is no frozen container digest, no
  evaluator version and no raw predictions to hand a third party yet. Fixture identity is real
  and worth keeping for anyone who follows a link here from Resources, but a page whose largest
  section was an empty "No independent reproduction receipt is currently registered" panel
  should not be advertised to search. The index entry comes back when the bundle does.

  BA-100 asks for `index: true`, now that the audit's other findings here are applied and the
  page is three digest-bound public samples plus two verifiable downloads. It is not taken in
  this lane, and the reason is written in the lane report rather than guessed at here: flipping
  it needs `app/sitemap.ts` (whose own comment argues the opposite), two positive controls in
  `lib/seo-surface.test.ts` that use this page as *the* noindex example, and the
  `public-copy-purge.test.ts` exemption that lets this page keep "does not prove semantic
  quality" -- a phrase the audit's own recommended hero sentence for this page also contains.
  Three files in two other lanes' trees, one of them a shared guard. It is an integration
  decision with a patch attached, not a page edit.
*/
export const metadata: Metadata = { title: "Reproducibility — TAVONEL", description: "Digest-bound public samples you can download, rerun and verify byte for byte.", alternates: { canonical: "/reproducibility" }, openGraph: { url: "/reproducibility" }, robots: { index: false, follow: true } };

/*
  What the audit changed on this page, all of it in props to the shared registry:

  BA-079  The first element a reader's eye reached was an amber-bordered pill announcing
          "FIXTURE VERIFIED · EXTERNAL BENCHMARK OPEN". "OPEN" is our internal work-item word
          and "FIXTURE" is test vocabulary, and they were rendered in a warning colour as the
          page's opening statement. The state the page actually offers is a public sample bound
          by digest, so that is what the badge says.
  BA-080  The hero paragraph printed four raw route slugs, asking a reader to type
          "/research/notes", and then ended on "none has been given". Those are the page's
          opening words. The slugs are a real linked row at the foot now, and BA-072 took the
          consent count off this page as it did off /benchmarks and /evidence.
  BA-081  The "What it establishes" table had a row whose state value was literally NOT YET,
          in a three-row table whose other two are QUALIFIED. A section called what it
          establishes is not where a row that establishes nothing belongs; the caveat it was
          carrying is a scope, so it is stated as the section's scope.
  BA-115  /evidence says an export is signed on the way out and this page said its sample is
          unsigned, with nothing reconciling them -- two clicks apart in the trust sequence.
          One clause does it: the signature is applied to a workspace export, not to a public
          sample, and the sample carries a Content-Digest instead.
  BA-116  Three internal fixture filenames and three 64-character digests were the visible row
          values, each wrapping mid-hash. The rows name the document in English, and the digest
          is shortened; the complete values are what the manifest download carries.
*/
const FIXTURES: readonly { key: string; name: string; digest: string }[] = [
  { key: "INPUT 01", name: "Korean regulatory filing · page 1", digest: "bbc9bcd5c5c3efce74755e451e04f62ca1ca97402a10908d309ba5645d63751a" },
  { key: "INPUT 02", name: "Korean regulatory filing · page 2", digest: "cbcd0747921a49fc88420521e6d655ddfa0ee7febdc8895f204e61625c933ee6" },
  { key: "INPUT 03", name: "Korean regulatory filing · page 3", digest: "2224c8c1ca8a0057992e1dba2605a7e5184edb22af820ab976ff6d900374ee53" },
];

/** "bbc9bcd5…d63751a" -- enough to recognise, with the whole value in the manifest. */
const short = (digest: string) => `${digest.slice(0, 8)}…${digest.slice(-7)}`;

export default function ReproducibilityPage() {
  return <PublicProofRegistry footer={<>
    {/*
      BA-080. The four cross-links the hero used to print as bare slugs, as links, at the foot.
    */}
    <p className="fine">
      <b>Also in the trust case:</b>{" "}
      <Link href={"/research/notes" as Route}>Research notes</Link> ·{" "}
      <Link href={"/benchmarks" as Route}>Benchmarks</Link> ·{" "}
      <Link href={"/evidence" as Route}>Evidence</Link> ·{" "}
      <Link href={"/research" as Route}>Research</Link> ·{" "}
      <Link href={"/trust" as Route}>Trust</Link>
    </p>
    <TrustNext from="/reproducibility" />
  </>} eyebrow="PUBLIC PROOF PROTOCOL" title="Rebuild the evidence, not the claim." state="PUBLIC SAMPLE · DIGEST-BOUND" summary="One question: can you rerun the same input and get the same bytes. A digest proves bytes — it does not prove semantic quality, and this page does not claim it does." sections={[
    { title: "Frozen inputs", body: "The downloadable manifest names three public proof PDFs already shipped with the product and pins each byte sequence by SHA-256. The complete digests are in the manifest.", rows: FIXTURES.map((fixture) => (
      { key: fixture.key, description: `${fixture.name} · sha256 ${short(fixture.digest)}`, state: "PUBLIC SAMPLE" }
    )), download: { href: "/reproducibility/sample", label: "Download reproducibility manifest" } },
    { title: "What it establishes", body: "The manifest establishes input identity, declared processing boundaries, and the URLs needed to rerun the public sample. Its scope is byte identity, not semantic quality.", rows: [
      { key: "BYTES", description: "Every input has an exact SHA-256 binding.", state: "QUALIFIED" },
      { key: "PIPELINE", description: "Quarantine, CDR, GPU OCR and candidate compilation are declared as separate stages.", state: "QUALIFIED PATH" },
    ] },
    { title: "Portable sample World", body: "A deterministic JSON package mirrors the public Explore object, relation and page-region evidence. Its response carries a SHA-256 Content-Digest header, so the downloaded bytes are verifiable; the signature /evidence describes is applied to a workspace export, not to a public sample.", download: { href: "/reproducibility/sample-world", label: "Download digest-bound sample World" } },
  ]} />;
}
