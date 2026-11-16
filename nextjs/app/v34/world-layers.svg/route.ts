import { publicCorpusIdsSha256, readPublicCorpus } from "@/lib/v34/public-corpus";
import { renderStaticSvg } from "@/lib/v34/world-geometry";

/*
  The static overview of the public reference corpus: the pre-hydration image of the home hero and
  /world, and the last fallback when neither WebGL nor Canvas2D is available. Drawn from the same
  layout and projection as the two live renderers, so all 567 records and 1,513 relationships are
  in it. Generated at build time from the hash-verified corpus; nothing is typed in.
*/
export const dynamic = "force-static";

export function GET() {
  const corpus = readPublicCorpus();
  return new Response(renderStaticSvg(corpus, { idsSha: publicCorpusIdsSha256(corpus) }), {
    headers: { "content-type": "image/svg+xml" },
  });
}
