/**
 * The exact page is current; a page inside the item's section is a location within it.
 *
 * Its own module, with no imports, because the drawer and the More menu are client components and
 * `lib/v34/nav` is not light: it reaches `lib/v34/release`, which imports `next/server`. Through that
 * one import the client bundle of every V34 page carried Next's server runtime (NextResponse, NextURL,
 * cookies, a user-agent parser: 25,691 B gzipped) and the whole route registry (4,923 B gzipped) —
 * WO-CI-16, measured on the job's build. `lib/v34/shell-client-weight.test.ts` keeps the shell's client
 * modules off that graph and pins this function to the one in `lib/v34/nav`.
 */
export function current(href: string, currentPath: string | null): "page" | "true" | undefined {
  // usePathname() is null when the shell renders outside a router (a static render).
  if (currentPath === null) return undefined;
  if (currentPath === href) return "page";
  return href !== "/" && currentPath.startsWith(`${href}/`) ? "true" : undefined;
}
