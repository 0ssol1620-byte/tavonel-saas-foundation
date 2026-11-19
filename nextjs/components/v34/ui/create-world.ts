import { primaryCallToAction } from "@/lib/commercial-state";
import type { SiteLink } from "@/lib/site-navigation";

/** Decision 2 (2026-11-16): the primary action's label. Its destination and gating are not ours to decide. */
export const CREATE_WORLD_LABEL = "Create your World";

/**
 * The primary action: the label above, where `primaryCallToAction()` says it goes (self-serve ->
 * /login, otherwise the access page). The header, the drawer and every closing strip read this one.
 */
export function createWorldAction(): SiteLink {
  return { href: primaryCallToAction().href, label: CREATE_WORLD_LABEL };
}
