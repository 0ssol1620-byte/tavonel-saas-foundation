import { BILLING_OFFERS, type BillingOfferCode, type PlanAvailability } from "@/lib/billing-catalog";
import { primaryCallToAction } from "@/lib/commercial-state";
import { ACCESS_CTA, type SiteLink } from "@/lib/site-navigation";
import { ButtonLink } from "./button-link";
import { surfaceClass } from "./surface";
import s from "./plan-card.module.css";

/**
 * A plan, read from `BILLING_OFFERS[code]` and nowhere else: name, price, allowance, features and
 * what is not sold yet all come from the catalog, so a rename or a price change there is the only
 * edit. The action is the server's `planAvailability`, passed in: a plan that is `purchasable` points
 * where `primaryCallToAction()` says, and every other plan is Request access. This component reads no
 * environment, so a caller cannot render a Buy action the server did not compute.
 */
export function PlanCard({ code, availability, featured = false, cta }: {
  code: BillingOfferCode;
  availability: PlanAvailability;
  featured?: boolean;
  /** Override for the self-serve destination. Defaults to `primaryCallToAction()`. */
  cta?: SiteLink;
}) {
  const offer = BILLING_OFFERS[code];
  const features: readonly string[] = offer.features;
  const notYetSold: readonly string[] = offer.notYetSold;
  const included = offer.included;
  const action = availability === "purchasable" && offer.saleChannel === "self_serve"
    ? (cta ?? primaryCallToAction())
    : { ...ACCESS_CTA, href: `${ACCESS_CTA.href}?plan=${encodeURIComponent(offer.label)}` };
  return (
    <article className={`${surfaceClass(featured ? "green" : "light")} ${s.card}`}>
      <h3 className={s.name}>{offer.label}</h3>
      <p className={s.price}>
        <span className={s.amount}>{`$${offer.priceUsd}`}</span>
        <span className={s.per}>{offer.kind === "subscription" ? " / month" : ""}</span>
      </p>
      <p className={s.description}>{offer.description}</p>
      <p className={s.volume}>
        {included
          ? `${included.pcu.toLocaleString("en-US")} PCU · ${included.kqu.toLocaleString("en-US")} KQU · ${included.storageGb.toLocaleString("en-US")} GB · ${included.seats.toLocaleString("en-US")} ${included.seats === 1 ? "seat" : "seats"}`
          : `${offer.includedPages.toLocaleString("en-US")} standard pages`}
      </p>
      <ul className={s.list}>
        {features.map((feature) => <li key={feature} className={s.item}>{feature}</li>)}
      </ul>
      {notYetSold.length > 0 ? (
        <div className={s.pending}>
          <p className={s.pendingTitle}>Not sold yet</p>
          <ul className={s.list}>
            {notYetSold.map((item) => <li key={item} className={s.item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      <div className={s.action}>
        <ButtonLink href={action.href} tone={featured ? "primary" : "secondary"}>{action.label}</ButtonLink>
      </div>
    </article>
  );
}
