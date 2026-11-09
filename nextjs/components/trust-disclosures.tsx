import Link from "next/link";
import type { Route } from "next";
import {
  PUBLIC_DISCLOSURE_STATUS_LABEL,
  PUBLIC_TRUST_DISCLOSURES,
  selectPublicTrustDisclosures,
  type PublicTrustDisclosureId,
} from "@/lib/public-trust-contract";

/*
  A published file (a policy .md, security.txt) is not a route. next/link prefetches its RSC
  payload, which 404s and puts an error in every visitor's console on /security, /trust and
  /enterprise. A file gets a plain anchor.
*/
const isFile = (href: string) => /.[a-z0-9]+$/i.test(href);

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
            <p className="fine">{isFile(row.href)
              ? <a href={row.href}>Open resource</a>
              : <Link href={row.href as Route}>Open resource</Link>}</p>
          </article>
        ))}
      </div>
    </>
  );
}
