"use client";

/** Paddle checkout, in one place. */

import { useCallback, useState } from "react";
import type { BillingOfferCode } from "./billing-catalog";
import { trackFunnel } from "./funnel-events";
import { failureSentence } from "./workspace-failure-copy";
import {
  ENTITLEMENT_PENDING_SENTENCE,
  entitlementActiveSentence,
  waitForEntitlement,
  type BillingStatusAccount,
  type EntitlementWaitResult,
} from "./entitlement-wait";

type CheckoutResponse = {
  code?: string;
  environment?: "sandbox" | "production";
  clientToken?: string;
  offer?: { priceId?: string; label?: string };
  customer?: { email?: string };
  customData?: Record<string, string>;
};

/*
  Journey A11 (D-09). The overlay used to be hard-coded `theme: "dark", locale: "en"`, so a Korean
  reader got an English checkout and a paper page got a black one. It now reads the page it opens
  over: the language of the nearest `lang` above `#main` (the `/ko` wrapper and `DocumentLangKo`
  both set `ko`), and the computed `color-scheme` of `#main` itself -- the paper public pages
  declare `light` there while the workspace inherits the root's `dark`. Only `ko` and `en` are
  sent because those are the two languages this site is written in.
*/
function overlayLook(): { theme: "light" | "dark"; locale: "ko" | "en" } {
  const surface = document.getElementById("main") ?? document.documentElement;
  const lang = surface.closest("[lang]")?.getAttribute("lang") ?? "";
  const scheme = getComputedStyle(surface).colorScheme;
  return {
    theme: scheme.includes("dark") && !scheme.includes("light") ? "dark" : "light",
    locale: lang.toLowerCase().startsWith("ko") ? "ko" : "en",
  };
}

/*
  Journey A9 (D-08). A notice is either progress, read when the reader is free (`role="status"`),
  or a refusal -- nothing was opened, nothing was charged -- announced at once (`role="alert"`).
  The hook knows which sentence is which; the page only decides where each region sits.
*/
export type NoticeTone = "status" | "alert";
/** The one next step a refusal can name, shown as a link beside its sentence. */
export type NoticeLink = { href: string; label: string };

/*
  Hotfix 2026-11-10. A workspace that has not accepted the processing terms is refused a checkout
  (no charge for a workspace that cannot process). The link takes the buyer to the workspace terms
  step carrying the offer, and the workspace holds it until access opens and then resumes it
  (`decideCheckoutResume`'s hold_terms in checkout-intent.ts).
*/
export function termsFirstLink(offerCode: BillingOfferCode): NoticeLink {
  return { href: `/workspace?checkout=${encodeURIComponent(offerCode)}`, label: "Accept the processing terms" };
}

/** What a billing-exempt owner is told instead of a checkout; the workspace says it too when it drops a held offer (P2-29). */
export const OWNER_ACCESS_ACTIVE_SENTENCE = "Owner access is already active. No checkout or payment is required for this account.";

/*
  One-step buy (2026-11-10). What a page may take over from the hook's own sentences. /pricing
  collects the processing terms in a dialog on the page itself, so it takes the terms refusal
  instead of a sentence pointing at the workspace, and it shows the outcome of a payment where the
  buyer is, so it hears the moment Paddle reports one. A page that passes neither keeps the
  sentences, which is the workspace.
*/
export type CheckoutHandlers = {
  /** The server refused for the processing terms (403). Nothing was opened or charged. */
  onTermsRequired?: (offerCode: BillingOfferCode) => void;
  /** Paddle reported `checkout.completed`. Entitlement still waits for the signed webhook. */
  onCompleted?: (offerCode: BillingOfferCode) => void;
};

/**
 * `onEntitlement` hears how the bounded wait after `checkout.completed` ended (journey A4), so a
 * page that shows billing can show the account the wait read without a reload.
 */
export function useCheckout(
  notify: (message: string, tone: NoticeTone, link?: NoticeLink) => void,
  onEntitlement?: (wait: EntitlementWaitResult) => void,
  handlers?: CheckoutHandlers,
) {
  const [busy, setBusy] = useState<BillingOfferCode | null>(null);

  const start = useCallback(
    async (offerCode: BillingOfferCode) => {
      const { getSupabaseBrowserClient } = await import("./supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client) {
        notify("Provider configuration is required before checkout is available.", "alert");
        return;
      }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        notify("Sign in with Google before opening the secure Paddle checkout.", "alert");
        return;
      }

      setBusy(offerCode);
      try {
        const response = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ offerCode }),
        });
        const checkout = (await response.json()) as CheckoutResponse;
        if (checkout.code === "OWNER_ACCESS_ACTIVE") {
          notify(OWNER_ACCESS_ACTIVE_SENTENCE, "status");
          return;
        }
        // Journey A1 (D-03): a refusal is a sentence from the one failure-copy table, never a raw
        // code in parentheses. A code with no sentence still reaches the screen as a reference.
        if (!response.ok) {
          if (checkout.code === "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" && handlers?.onTermsRequired) {
            handlers.onTermsRequired(offerCode);
            return;
          }
          notify(
            `Checkout is unavailable. ${failureSentence(checkout.code, response.status)}`,
            "alert",
            checkout.code === "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE"
              ? termsFirstLink(offerCode)
              : checkout.code === "BILLING_PLAN_CHANGE_REQUIRED" || checkout.code === "BILLING_PLAN_ALREADY_ACTIVE"
                  || checkout.code === "BILLING_SUBSCRIPTION_NEEDS_PORTAL"
                ? { href: "/workspace/settings/usage", label: "Manage or cancel subscription" }
                : checkout.code === "BILLING_RESUBSCRIBE_CONTACT"
                  ? { href: "mailto:support@tavonel.com", label: "Write to support@tavonel.com" }
                  : undefined,
          );
          return;
        }
        if (!checkout.clientToken || !checkout.environment || !checkout.offer?.priceId || !checkout.customData) {
          notify("Checkout is unavailable. The checkout response was incomplete, so nothing was opened or charged.", "alert");
          return;
        }

        const { initializePaddleBrowser } = await import("./paddle-browser");
        const paymentMode = checkout.environment === "production" ? "live" : "sandbox";
        const paddle = await initializePaddleBrowser({
          token: checkout.clientToken,
          environment: checkout.environment,
          eventCallback: (event) => {
            if (event.name === "checkout.completed") {
              /*
                The last hop of §40's funnel, and the only one the browser can see.

                `checkout_opened` without a matching close is the abandonment this measures. The
                honest name is `checkout_completed`, not `paid`: Paddle has accepted the payment
                here, and the sentence below says out loud that entitlement waits for the signed
                webhook. Naming this event for the entitlement would put a number on the dashboard
                that the product refuses to act on.

                Server-side is where the entitlement truth is, and it is not reachable from this
                module: `trackFunnel` is a browser call, and the property that would identify a
                workspace in a webhook is exactly the kind of value this module exists to keep off
                the wire.
              */
              trackFunnel("checkout_completed", { offer: offerCode, mode: paymentMode });
              notify(`Paddle accepted the ${paymentMode} payment. Access and credits remain pending until the signed webhook is persisted.`, "status");
              // The page under the overlay states the outcome, so the buyer is not left on Paddle's own screen.
              if (handlers?.onCompleted) {
                window.Paddle?.Checkout.close?.();
                handlers.onCompleted(offerCode);
              }
              /*
                Journey A4 (D-04): then read billing status again, a bounded number of times, and
                end in a stated outcome -- active, or still pending with what to do next.
              */
              const label = checkout.offer?.label;
              void waitForEntitlement(offerCode, async () => {
                const status = await fetch("/api/billing/status", { headers: { authorization: `Bearer ${token}` } });
                if (!status.ok) return null;
                return ((await status.json()) as { account?: BillingStatusAccount }).account ?? null;
              }).then((wait) => {
                notify(wait.outcome === "active" ? entitlementActiveSentence(label) : ENTITLEMENT_PENDING_SENTENCE, "status");
                onEntitlement?.(wait);
              });
            }
          },
        });
        if (!paddle) {
          notify("Paddle checkout could not initialize.", "alert");
          return;
        }

        paddle.Checkout.open({
          items: [{ priceId: checkout.offer.priceId, quantity: 1 }],
          customer: checkout.customer?.email ? { email: checkout.customer.email } : undefined,
          customData: checkout.customData,
          settings: { displayMode: "overlay", ...overlayLook() },
        });
        notify(`${checkout.offer.label ?? "Selected offer"} ${paymentMode} checkout opened. Only a verified webhook can change entitlements.`, "status");
      } catch {
        notify("Paddle checkout could not be opened. No entitlement was changed.", "alert");
      } finally {
        setBusy(null);
      }
    },
    [notify, onEntitlement, handlers],
  );

  return { start, busy };
}
