// Match the existing Korean evaluation fallback: the OG renderer has no registered Korean
// TTF/OTF. Reuse the existing English pricing card rather than rendering missing glyphs.
// The Korean page's title, description and canonical/hreflang metadata remain localized.
export { default, alt, contentType, size } from "../../pricing/opengraph-image";
