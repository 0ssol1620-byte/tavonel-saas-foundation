import Link from "next/link";
import type { Route } from "next";
import { primaryCallToAction } from "@/lib/commercial-state";

/**
 * The access action, resolved on the server.
 *
 * BA-232: this component used to paint "Get started" pointing at `/login`, fetch `/api/status`
 * from the browser and then replace the label with "Contact" or "Start free" -- a label swap on
 * the most important control on the page, and a third and fourth verb for an action that already
 * had two. The commercial state is server state (`COMMERCIAL_MODE`, the payment provider and the
 * launch flag), so it is read where it lives, the way `app/page.tsx` already reads it.
 *
 * It is deliberately **not** a client component and must not become one: the flags it depends on
 * are unprefixed environment variables, which a client bundle inlines as `undefined` and would
 * then render the closed posture without saying so. `components/public-site-chrome.tsx` takes the
 * resolved action as a prop for exactly that reason -- two of its callers are client components.
 * `server-only` would say this in the module graph; the package is not installed in this tree and
 * installing one is not this lane's to do.
 *
 * A statically prerendered page bakes the posture of the build that produced it, which is the same
 * contract as every other flag in `lib/commercial-state.ts`: changing one is a redeploy.
 */
export default function PublicPrimaryCta({ className = "btn small" }: { className?: string }) {
  const cta = primaryCallToAction();
  return <Link className={className} href={cta.href as Route}>{cta.label}</Link>;
}
