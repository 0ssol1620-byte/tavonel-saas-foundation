import type { Metadata } from "next";

/*
  §12.2 -- one constructor that turns a page's own record into its <head>, and refuses the
  values that make a <head> a lie.

  Two guards already read the route tree for this: `lib/route-canonical-metadata.test.ts` fails
  when a page inherits the homepage's canonical, and `lib/page-metadata.test.ts` fails when a
  page has no title or description of its own. Both read source text, which is the right way to
  catch a missing field and no way at all to catch a wrong value -- a canonical pointing at
  another page, a nine-character description, an author nobody is, or a "verified on" date
  naming a day on which nothing was verified. §12.2 asks for exactly those fields to be real.

  So this throws rather than returning something plausible. A build that stops is a bad <head>
  nobody shipped; a build that renders one is a wrong page in a search result and a wrong
  preview in every chat window it is pasted into.

  What it deliberately does not do is decide that a date may move. "Do not refresh the date
  without changing the content" is a human rule -- `DOCS_REVIEWED` in `lib/docs-content.ts`
  states it in those words and a person moves it. What is mechanical is narrower and still
  worth having: the date is never derived at render time, never in the future, and never
  accepted without naming the build and the reviewer it was verified against. A reviewer
  moving the date has to say which build they checked.
*/

/** The hreflang keys Next itself accepts, so a typo is a type error rather than a dead tag. */
type Hreflang = keyof NonNullable<NonNullable<Metadata["alternates"]>["languages"]>;

export type PageLanguages = Partial<Record<Hreflang, string>>;

/**
 * A verification that happened. All three together: a date with no build behind it is the
 * freshness signal §12.2 bars, and a date with no reviewer is an unsigned one.
 */
export type PageVerification = { at: string; reviewer: string; build: string };

export type PageSeoRecord = {
  title: string;
  description: string;
  /** Same-origin path, and the page's own. Both the canonical and og:url are built from it. */
  canonical: string;
  /** `false` keeps the page out of the index -- the mechanism a draft uses. Default: indexable. */
  index?: boolean;
  /** hreflang -> same-origin path. Must name this page too, or the annotation omits itself. */
  languages?: PageLanguages;
  verified?: PageVerification | null;
};

/*
  The bounds `lib/page-metadata.test.ts` already applies to the tree, applied to the value
  instead of to the source line. Under ~50 characters a search engine writes its own snippet;
  over ~200 it truncates mid-sentence. Either way the sentence someone wrote is not the one
  anyone reads.
*/
const TITLE_LENGTH = { min: 7, max: 72 };
const DESCRIPTION_LENGTH = { min: 50, max: 200 };

function refuse(message: string): never {
  throw new Error(`page-seo: ${message}`);
}

/** A path this site can actually serve: absolute, origin-relative, no query, no trailing slash. */
function sitePath(value: string, field: string): string {
  if (!value.startsWith("/")) refuse(`${field} must be a same-origin path beginning with "/", got ${JSON.stringify(value)}`);
  if (value.startsWith("//")) refuse(`${field} ${JSON.stringify(value)} is protocol-relative, which points off this origin`);
  if (/[?#\s]/.test(value)) refuse(`${field} ${JSON.stringify(value)} carries a query, fragment or space, so it is not one canonical address`);
  if (value.length > 1 && value.endsWith("/")) refuse(`${field} ${JSON.stringify(value)} ends in a slash, which is a second address for the same page`);
  return value;
}

/*
  A calendar date, checked as a calendar date. `new Date("2026-02-30")` does not throw, it
  rolls over into March -- so the round trip is the check, and it is the difference between
  refusing a typo and publishing one.
*/
function checkVerification(verified: PageVerification, today: Date): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verified.at)) refuse(`verified.at must be YYYY-MM-DD, got ${JSON.stringify(verified.at)}`);
  const parsed = new Date(`${verified.at}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== verified.at) refuse(`verified.at ${JSON.stringify(verified.at)} is not a date on the calendar`);
  if (parsed.getTime() > today.getTime()) refuse(`verified.at ${verified.at} is in the future, so nothing was verified on it`);
  if (verified.reviewer.trim() === "") refuse("verified.reviewer is empty -- a verification date is signed or it is not one");
  if (verified.build.trim() === "") refuse("verified.build is empty -- a date that names no build is a freshness signal, not a verification");
}

/**
 * The record, as metadata. `today` is a parameter so the future-date rule can be tested on a
 * fixed day; nothing in the returned object is derived from the clock.
 */
export function pageMetadata(record: PageSeoRecord, today: Date = new Date()): Metadata {
  const title = record.title.trim();
  const description = record.description.trim();
  if (title.length < TITLE_LENGTH.min || title.length > TITLE_LENGTH.max) refuse(`title is ${title.length} characters, outside ${TITLE_LENGTH.min}-${TITLE_LENGTH.max}: ${JSON.stringify(title)}`);
  if (description.length < DESCRIPTION_LENGTH.min || description.length > DESCRIPTION_LENGTH.max) refuse(`description is ${description.length} characters, outside ${DESCRIPTION_LENGTH.min}-${DESCRIPTION_LENGTH.max}: ${JSON.stringify(description)}`);

  const canonical = sitePath(record.canonical, "canonical");

  let languages: PageLanguages | undefined;
  if (record.languages) {
    const entries = Object.entries(record.languages).filter((entry): entry is [string, string] => entry[1] !== undefined);
    if (entries.length < 2) refuse("languages needs at least two locales -- a one-entry map annotates nothing");
    for (const [tag, path] of entries) sitePath(path, `languages.${tag}`);
    /*
      The page has to be in its own alternates map. An hreflang set that lists every
      translation except the page carrying it is the single most common way the annotation is
      wrong, and the pages still render, so nothing else notices.
    */
    if (!entries.some(([, path]) => path === canonical)) refuse(`languages names no entry for ${canonical}, so this page is missing from its own hreflang set`);
    languages = record.languages;
  }

  const verified = record.verified ?? null;
  if (verified) checkVerification(verified, today);

  return {
    title,
    description,
    alternates: languages ? { canonical, languages } : { canonical },
    // og:url is the canonical, always. A share card that claims another address is a wrong
    // canonical wearing a different hat.
    // No `authors` inside openGraph. og's `article:author` takes a profile URL, and a reviewer's
    // name is not one -- the name goes out as the top-level `authors` below, which is the field
    // that takes a name. If og ever needs the author, `PageVerification` gains a `reviewerUrl`.
    openGraph: verified
      ? { title, description, url: canonical, type: "article", modifiedTime: verified.at }
      : { title, description, url: canonical, type: "website" },
    ...(verified ? { authors: [{ name: verified.reviewer }] } : {}),
    ...(record.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}
