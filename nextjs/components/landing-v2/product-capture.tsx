import manifest from "@/public/visuals/MANIFEST.json";

/*
  A real product capture (PR #191, public/visuals/MANIFEST.json), placed on a page.

  The image is the product's own DOM, cropped and never retouched or recoloured, so it sits on a neutral
  sheet as it is. Both files of a pair come from the manifest -- the 1440 capture, and the 390 one under
  640px -- so a page loads one of them, and `width`/`height` are the manifest's pixel size, which holds the
  layout before the file arrives. Always lazy: no capture is placed above the fold.

  The captures show public SEC sample figures and e2e fixture counts. None of them is a TAVONEL claim, so no
  caller quotes a number it can see in one, and `alt` describes what is on screen without repeating any.
  A name with no pair in the manifest is a build failure, not a missing picture.
*/
export type CaptureName = "evidence-inspector" | "change-center" | "use-with-ai" | "compile-timeline";

const PHONE = "(max-width: 640px)";

function entry(file: string) {
  const found = manifest.captures.find((capture) => capture.file === file);
  if (!found) throw new Error(`product_capture_not_in_manifest: ${file}`);
  return found;
}

export default function ProductCapture({ name, alt, sizes, className }: {
  name: CaptureName;
  /** What is on screen, in the page's language. No figure: the captures' numbers are sample data. */
  alt: string;
  /** The rendered width above 640px, e.g. "(min-width: 1320px) 640px, 50vw". */
  sizes: string;
  className?: string;
}) {
  const wide = entry(`${name}-1440.webp`);
  const narrow = entry(`${name}-390.webp`);
  return (
    <picture className={className} data-capture={name}>
      <source media={PHONE} srcSet={`/visuals/${narrow.file} ${narrow.pixelWidth}w`} sizes="calc(100vw - 32px)"
        width={narrow.pixelWidth} height={narrow.pixelHeight} />
      <img src={`/visuals/${wide.file}`} srcSet={`/visuals/${wide.file} ${wide.pixelWidth}w`} sizes={sizes}
        width={wide.pixelWidth} height={wide.pixelHeight} alt={alt} loading="lazy" decoding="async" />
    </picture>
  );
}
