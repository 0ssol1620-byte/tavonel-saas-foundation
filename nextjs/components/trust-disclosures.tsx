import Link from "next/link";
import type { Route } from "next";
import {
  PUBLIC_DISCLOSURE_STATUS_LABEL,
  PUBLIC_TRUST_DISCLOSURES,
  selectPublicTrustDisclosures,
  type PublicTrustDisclosureId,
} from "@/lib/public-trust-contract";

export function TrustDisclosures({
  heading = "Public trust resources",
  ids,
}: {
  heading?: string;
  ids?: readonly PublicTrustDisclosureId[];
}) {
  const rows = ids ? selectPublicTrustDisclosures(ids) : PUBLIC_TRUST_DISCLOSURES;

  return (
    <>
      <h2>{heading}</h2>
      <div className="status-list">
        {rows.map((row) => (
          <article key={row.id} data-disclosure-id={row.id} data-state={row.status}>
            <span>{PUBLIC_DISCLOSURE_STATUS_LABEL[row.status]}</span>
            <h3>{row.subject}</h3>
            <p>{row.line}</p>
            <p className="fine"><Link href={row.href as Route}>Open resource</Link></p>
          </article>
        ))}
      </div>
    </>
  );
}
