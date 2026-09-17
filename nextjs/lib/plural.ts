/*
  "1 source", not "1 sources".

  The workspace prints counted nouns in several places and did the counting without the grammar,
  so a workspace holding one file said "1 sources" in its board heading and "All 1 sources" in the
  review filter (workspace-02). English's regular plural is a suffix; the irregular cases pass
  their own plural in rather than pulling an i18n runtime in for two call sites.
*/
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
