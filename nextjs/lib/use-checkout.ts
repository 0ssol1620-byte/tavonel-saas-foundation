"use client";

/** Paddle checkout, in one place. */

import { useCallback, useState } from "react";
import type { BillingOfferCode } from "./billing-catalog";
import { trackFunnel } from "./funnel-events";

type CheckoutResponse = {
  code?: string;
  environment?: "sandbox" | "production";
  clientToken?: string;
  offer?: { priceId?: string; label?: string };
  customer?: { email?: string };
  customData?: Record<string, string>;
};

export function useCheckout(notify: (message: string) => void) {
  const [busy, setBusy] = useState<BillingOfferCode | null>(null);

  const start = useCallback(
    async (offerCode: BillingOfferCode) => {
      const { getSupabaseBrowserClient } = await import("./supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client) {
        notify("Provider configuration is required before checkout is available.");
        return;
      }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        notify("Sign in with Google before opening the secure Paddle checkout.");
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
          notify("Owner access is already active. No checkout or payment is required for this account.");
          return;
        }
        if (
          !response.ok ||
          !checkout.clientToken ||
          !checkout.environment ||
          !checkout.offer?.priceId ||
          !checkout.customData
        ) {
          notify(`Checkout is unavailable (${checkout.code ?? response.status}).`);
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
              notify(`Paddle accepted the ${paymentMode} payment. Access and credits remain pending until the signed webhook is persisted.`);
            }
          },
        });
        if (!paddle) {
          notify("Paddle checkout could not initialize.");
          return;
        }

        paddle.Checkout.open({
          items: [{ priceId: checkout.offer.priceId, quantity: 1 }],
          customer: checkout.customer?.email ? { email: checkout.customer.email } : undefined,
          customData: checkout.customData,
          settings: { displayMode: "overlay", theme: "dark", locale: "en" },
        });
        notify(`${checkout.offer.label ?? "Selected offer"} ${paymentMode} checkout opened. Only a verified webhook can change entitlements.`);
      } catch {
        notify("Paddle checkout could not be opened. No entitlement was changed.");
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  return { start, busy };
}
