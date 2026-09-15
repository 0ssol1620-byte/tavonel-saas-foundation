/**
 * Two pages and the thread between them.
 *
 * This was nine cells with the middle one lit -- the most common AI/ML mark in circulation, the
 * first item on the founder's list of things that must not ship, and not this brand's identity in
 * the first place (BA-230). Decision A-06 had already specified the mark: a verso page with its
 * corner cut, a shorter recto page beside it, and one thread crossing between them at -34.2
 * degrees, in strokes of 1.9 and 1.6.
 *
 * It means what the product does -- two sources, one compiled link between them -- and it is
 * geometry rather than colour, so it survives at 16px, in greyscale and behind a blur. It is also
 * monochrome now: the mark used to paint the product's state colour as though that were a brand
 * colour. It takes `currentColor` from whatever it sits in.
 */
export default function Logomark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="logomark"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {/* Verso: x 2.5-9.5, with the top corner cut. */}
      <path d="M2.5 5.5H7.4L9.5 7.6V18.5H2.5Z" strokeWidth={1.9} opacity={0.66} />
      {/* Recto: x 14.5-21.5, deliberately shorter than the verso. */}
      <path d="M14.5 8.2H21.5V18.5H14.5Z" strokeWidth={1.9} opacity={0.66} />
      {/* The thread: -34.2 degrees across the gap, and the one element at full contrast. */}
      <path d="M9.5 15.5L14.5 12.1" strokeWidth={1.6} />
    </svg>
  );
}
