import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
  Shared by the V34 route tests. Node only: nothing the app builds imports this file.
*/

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };

/** The text of the one h1 in a server-rendered body: tags dropped, entities decoded, spaces collapsed. */
export function h1Text(html: string): string {
  const found = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  if (found.length !== 1) throw new Error(`expected exactly one h1, found ${found.length}`);
  return found[0]![1]!
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (entity, name: string) => ENTITIES[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WORDS = "zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve"
  + "|(?:thir|four|fif|six|seven|eigh|nine)teen|(?:twen|thir|for|fif|six|seven|eigh|nine)ty"
  + "|hundreds?|thousands?|millions?|dozens?|handful|couple|pair|score";

export const COUNTED_NOUNS = [
  "files?", "PDFs?", "pages?", "documents?", "records?", "sources?", "filings?", "reports?", "statements?", "rows?",
  "figures?", "periods?", "tools?", "clients?", "keys?", "answers?", "questions?", "days?", "steps?",
] as const;

/*
  A count typed into copy, where a figure needs a receipt or a computed value: a number word or
  digits, then up to four words (a hyphenated token such as 10-K is one word), then a counted noun.
  A possessive ends the phrase, so "one company's filings" counts the company. Digits or a word
  glued to a hyphen ("TRAPPIST-1", "non-zero") belong to an identifier and are not a count.
  "one" before a singular noun is an article more often than a figure, so it is in the pattern only
  where a route asks for it ({ one: true }: /personal, /markets, /engineering and /teams, which were
  written to it). A route adds the nouns its own subject counts (`nouns`).
*/
type CountOptions = { one?: boolean; nouns?: readonly string[] };

export function typedCount({ one = false, nouns = [] }: CountOptions = {}): RegExp {
  const words = one ? `one|${NUMBER_WORDS}` : NUMBER_WORDS;
  return new RegExp(`(?:^|[^\\w-])(?:(?:${words})(?:-[a-z]+)?|\\d+)\\s+(?:[\\w-]+\\s+){0,4}(?:${[...COUNTED_NOUNS, ...nouns].join("|")})\\b`, "i");
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/** Every typed count in a route folder's sources (`components/v34/routes/<folder>`), as "file: phrase". */
export function typedCounts(folder: string, options: CountOptions = {}): string[] {
  const dir = join(import.meta.dirname, "../../components/v34/routes", folder);
  const pattern = new RegExp(typedCount(options).source, "gi");
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name))
    .flatMap((name) => [...stripComments(readFileSync(join(dir, name), "utf8")).matchAll(pattern)]
      .map((match) => `${name}: ${match[0].trim()}`));
}
