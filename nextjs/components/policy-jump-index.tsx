import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import PageTocList from "@/components/docs/page-toc-list";

/*
  G2-040 / G2-041. Two findings, one cause.

  The two-column document template puts the H1 in a 480px left column and the whole document in
  the right rail, so on a long page -- /status was measured at 2,300px of it -- the left column is
  empty from the H1 down. On a phone the same document is one unbroken scroll: /security measured
  8,007 CSS px, roughly twenty-five screens, with no way to reach a section except by thumb.

  A table of contents fixes both, and the sections it needs already exist: every one of these
  pages writes `<h2>`s inside `.policy-copy`. So the index is read from the document rather than
  declared a second time in five page files -- there is no list to keep in step, and a page that
  adds a section gets a jump link for it in the same commit.

  The first version read the headings from the DOM after mount. That cost /privacy a cumulative
  layout shift of 0.42 on a phone (Lighthouse, 2026-09-16): the index was inserted above the
  document once JavaScript ran and pushed every paragraph down. This version reads the same
  headings from the React tree on the server, so the index is in the HTML the first paint uses,
  works with scripting off, and moves nothing.

  `IndexedPolicyBody` wraps the document's markup; `PolicyJumpIndex` marks where the index goes.
  The walk only descends into host elements and fragments -- a heading inside another component
  is that component's to index -- and a document with fewer than three sections gets no index.
*/
type Entry = { id: string; text: string };

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";

/** Marker only. Rendered on its own, outside `IndexedPolicyBody`, it renders nothing. */
export default function PolicyJumpIndex() {
  return null;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return "";
}

const isHost = (el: ReactElement) => typeof el.type === "string" || el.type === Fragment;

function count(node: ReactNode, level: "h2" | "h3"): number {
  let n = 0;
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ children?: ReactNode }>;
    if (el.type === level) n += 1;
    else if (isHost(el)) n += count(el.props.children, level);
  });
  return n;
}

/*
  pages-13. One "On this page", not five.

  The index this file derives is the right index; the list it drew was a fifth rendering of a
  component the site already has -- a numbered list with full-width hairline rules, measured at
  582px on /status, 1,253 on /research, 1,173 on /trust and 1,336 on /enterprise, each rule
  spanning a kilopixel for a 150px label. `PageTocList` is the boxed form the documentation
  routes use, and it marks the section being read, which this list never did. Only the reading of
  the document tree stays here.
*/
function JumpNav({ entries }: { entries: Entry[] }) {
  if (entries.length < 3) return null;
  return <PageTocList entries={entries.map((entry) => ({ id: entry.id, label: entry.text }))} />;
}

export function IndexedPolicyBody({ children }: { children: ReactNode }) {
  /*
    `h2` where the document has them, `h3` where it does not. /status writes its three sections
    as `h3` under an `h1` and /subprocessors has a single `h2` over an `h3` list -- a heading
    level is that page's to fix, and until it is, an index keyed only to `h2` silently skips the
    longest page in the set. The two levels are never mixed.
  */
  const level: "h2" | "h3" = count(children, "h2") >= 3 ? "h2" : "h3";
  const entries: Entry[] = [];
  const used = new Set<string>();

  const walk = (node: ReactNode): ReactNode =>
    Children.map(node, (child) => {
      if (!isValidElement(child)) return child;
      const el = child as ReactElement<{ children?: ReactNode; id?: string }>;
      if (el.type === PolicyJumpIndex) {
        // The array is complete by the time React renders the nav: this walk finishes first.
        return <JumpNav entries={entries} />;
      }
      if (el.type === level) {
        const text = textOf(el.props.children).trim();
        if (!text) return child;
        let id = el.props.id ?? slug(text);
        let suffix = 2;
        while (used.has(id)) id = `${slug(text)}-${suffix++}`;
        used.add(id);
        entries.push({ id, text });
        return el.props.id === id ? child : cloneElement(el, { id });
      }
      if (isHost(el) && el.props.children !== undefined) {
        return cloneElement(el, undefined, walk(el.props.children));
      }
      return child;
    });

  const body = walk(children);
  // Two headings are a heading pair, not a document that needs an index; the marker then renders nothing.
  return <>{entries.length >= 3 ? body : children}</>;
}
