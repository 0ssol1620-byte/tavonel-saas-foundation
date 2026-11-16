import s from "./tag.module.css";

/** The labels a thing carries so a reader knows what it is. Each names the object, nothing else. */
export const TAG_KINDS = [
  "Sample",
  "Reference walkthrough",
  "Storyboard",
  "Public reference corpus",
  "Illustration",
  "Configuration steps",
] as const;

export type TagKind = (typeof TAG_KINDS)[number];

export function Tag({ kind }: { kind: TagKind }) {
  return <span className={s.tag}>{kind}</span>;
}
