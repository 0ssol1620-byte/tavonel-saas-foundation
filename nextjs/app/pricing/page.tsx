import PricingPageClient from "@/components/pricing-page-client";
import { readCommercialState } from "@/lib/commercial-state";
import { readAccessMode } from "@/lib/foundation-pilot";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const commercial = readCommercialState();
  return (
    <PricingPageClient
      initialLiveCheckout={commercial.liveChargesEnabled}
      initialSelfService={readAccessMode() === "self_service"}
    />
  );
}
