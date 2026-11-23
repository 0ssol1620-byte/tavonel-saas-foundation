import { v34Route, type V34RouteKey, type V34RouteRecord } from "@/lib/v34/routes";

/**
 * The publication dates of a journal article, from the registry record. They are computed from the
 * git history of the article's source file and written to the registry, never typed in a page. A
 * live article without them fails here, so a page cannot render a date that nobody computed.
 */
export function articleDates(key: V34RouteKey, record: V34RouteRecord = v34Route(key)): { published: string; modified: string } {
  if (!record.article) throw new Error(`journal: the registry record of ${key} has no article dates`);
  return record.article;
}
