/**
 * The link preview for `/`.
 *
 * BQ-008 / BQ-061. This file drew its own card: a nine-cell dot grid for a mark, and a three-line
 * headline ("Your AI needs more than searchable files. It needs a current, traceable world.")
 * that appears on no page of this site and matches neither the H1 nor the `og:title` the same
 * route declares. A share card is where most readers meet the brand first, so the site was
 * introducing itself with a logo it had retired and a sentence it had stopped saying.
 *
 * It is `ogCard` now, like the other twenty-nine, and its two lines are `BRAND_LINE` -- the same
 * constant the H1, the footer tagline and this route's metadata derive from, so the card cannot
 * drift away from the page again.
 *
 * TRUST-09 / VIS-51. The third argument is the one thing this card does that the other twenty-nine
 * do not. `/` and `/ko` are where a reader who has never seen the product meets it, so the card
 * carries a frame of the running evidence view beside the two lines. Every other page keeps the
 * text-only card: a crop of `/explore` on the pricing card would be a picture of a different page.
 */

import { ogCard } from "@/lib/og-card";
import { BRAND_LINE } from "@/lib/site-navigation";

export { alt, contentType, size } from "@/lib/og-card";

export default ogCard(BRAND_LINE.headline, BRAND_LINE.descriptor, true);
