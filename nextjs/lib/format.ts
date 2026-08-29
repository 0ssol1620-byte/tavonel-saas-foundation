/**
 * Formatting that does not vary by machine.
 *
 * The landing page pins its number formatting in `demo-world.ts` so a figure quoted in a bug
 * report matches the figure on the reporter's screen. The workspace was left outside that rule and
 * rendered dates with the browser's own locale, which is the one place it matters most: support
 * conversations about billing turn on "what does it say on your screen".
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hour12: false,
});

/** A UTC timestamp, identical on every device. Returns null for anything unparseable. */
export function formatTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${DATE.format(date)} UTC`;
}

/** A count, pinned the same way the landing page pins its figures. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
