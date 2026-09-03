import { PublicSitePage } from "@/components/public-site-chrome";

/**
 * Kept as the name the existing pages import, now delegating to the one site chrome.
 *
 * It used to carry its own header — same seven links as the landing page but a different
 * button — which is how "Try TAVONEL" and "Sign in" ended up on facing pages of the same site.
 */
export function PublicPageShell({ children }: { children: React.ReactNode }) {
  return <PublicSitePage>{children}</PublicSitePage>;
}
