import styles from "./pricing-plan-overview.module.css";

export type PricingPlanSummary = Readonly<{ name: string; price: string; unit: string }>;

export const pricingPlanId = (index: number) => `pricing-plan-${index}`;
export const pricingPlanDestinationClass = styles.destination;

/** Navigation over the page's existing plan presentation; this owns no pricing values. */
export default function PricingPlanOverview({ plans, korean = false }: {
  plans: readonly PricingPlanSummary[];
  korean?: boolean;
}) {
  return <nav className={styles.overview} aria-label={korean ? "요금제 비교 및 상세 보기" : "Compare plans and jump to details"}>
    <p className={styles.caption}>{korean ? "요금제 한눈에 보기 · 선택하면 상세 내용으로 이동합니다" : "Plans at a glance · Select a plan to read its details"}</p>
    <ul className={styles.list}>
      {plans.map((plan, index) => <li key={pricingPlanId(index)}>
        <a href={`#${pricingPlanId(index)}`} aria-label={`${plan.name}, ${plan.price}${plan.unit ? `, ${plan.unit}` : ""} — ${korean ? "요금제 상세 보기" : "View plan details"}`}>
          <span className={styles.name}>{plan.name}</span>
          <span className={styles.price}>{plan.price}</span>
          {plan.unit ? <span className={styles.unit}>{plan.unit}</span> : null}
          <span className={styles.arrow} aria-hidden="true">↘</span>
        </a>
      </li>)}
    </ul>
  </nav>;
}
