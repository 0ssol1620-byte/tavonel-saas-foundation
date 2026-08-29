"use client";

/**
 * Paddle checkout, in one place.
 *
 * The landing page and the workspace both need to open a checkout, and until now only the
 * landing page could -- so a signed-in user who ran out of credits had to navigate back out to
 * the marketing page to buy more. Duplicating the flow to fix that would have been worse: this
 * is the path that moves money, and two copies drift.
 *
 * Every guarantee the original flow made is preserved here, and they are the point of the
 * function rather than incidental to it:
 *
 *   - A session token is required before the server is asked for anything.
 *   - The server owns the price allow-list; the client sends an offer code, never a price.
 *   - The response must carry a client token, an environment, a price id and custom data, or
 *     nothing opens. A partial response is a failure, not something to work around.
 *   - Completing checkout changes nothing. Only a signed, idempotently persisted webhook moves
 *     an entitlement, and the message on success says so rather than implying access is live.
 */

import { useCallback, useState } from "react";
import type { BillingOfferCode } from "./billing-catalog";

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
        notify("Foundation mode is active. Provider configuration is required before checkout is available.");
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
        const paddle = await initializePaddleBrowser({
          token: checkout.clientToken,
          environment: checkout.environment,
          eventCallback: (event) => {
            if (event.name === "checkout.completed") {
              notify("Paddle accepted the sandbox payment. Access and credits remain pending until the signed webhook is persisted.");
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
        notify(`${checkout.offer.label ?? "Selected offer"} sandbox checkout opened. Only a verified webhook can change entitlements.`);
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
