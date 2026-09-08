/*
  The origin allowlist an unauthenticated public form is entitled to.

  This was written inside `app/api/contact/route.ts` and stayed there while it had one caller.
  The research-updates opt-in is the second, and a second copy of an origin check is how two
  public forms end up with two different ideas of which origins are ours -- so it moved here
  before the copy could be made rather than after.

  Semantics are unchanged from the contact route: no Origin header at all is accepted outside
  production (curl and same-origin form posts from a dev server), localhost is accepted outside
  production, and in every case the header must equal the origin of one of the configured
  allowlist entries. `AKC_CONTACT_ALLOWED_ORIGINS` keeps its name because it is already set in
  every deployment and renaming it would silently open the check on the first deploy that missed
  the new name.

  This is anti-abuse, not CSRF defence. Neither caller derives privilege from an ambient cookie
  (`lib/security/route-classification.json` classifies both `P-public`), so there is nothing for
  a forged cross-site request to ride; what this does is keep somebody else's page from posting
  the form.
*/
export function isAllowedFormOrigin(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return env.NODE_ENV !== "production";

  if (env.NODE_ENV !== "production") {
    try {
      if (["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) return true;
    } catch {
      return false;
    }
  }

  return (env.AKC_CONTACT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => {
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    });
}
