/*
  The Korean entry page shares the site's default card, unchanged.

  Not an oversight and not laziness: `next/og` renders with the fonts it is given, and the only
  Korean face in this repository is `public/fonts/WantedSansVariable.split.*.woff2`. Satori cannot
  read woff2, so a card with Korean text on it would render as boxes -- which is worse than an
  English card, because a box is a broken page and an English wordmark is the same wordmark the
  Korean page already puts in its own header.

  A Korean card becomes possible the day a TTF or OTF subset of a Korean face is committed; until
  then this line is the honest answer rather than a card nobody can read.
*/
export { default, alt, contentType, size } from "../opengraph-image";
