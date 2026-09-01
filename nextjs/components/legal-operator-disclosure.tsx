import { readLegalOperator } from "@/lib/legal-operator";

export default function LegalOperatorDisclosure({ compact = false }: { compact?: boolean }) {
  const operator = readLegalOperator();
  if (!operator) {
    return <p className="fine">Paid checkout remains launch-gated until the complete operator disclosure is published.</p>;
  }
  if (compact) {
    return (
      <p className="fine">
        {operator.businessName} · Representative {operator.representative} · Business registration {operator.businessNumber}<br />
        {operator.address} · <a href={`tel:${operator.phone}`}>{operator.phone}</a> · <a href={`mailto:${operator.email}`}>{operator.email}</a>
      </p>
    );
  }
  return (
    <dl>
      <dt>Business</dt><dd>{operator.businessName}</dd>
      <dt>Representative</dt><dd>{operator.representative}</dd>
      <dt>Business registration</dt><dd>{operator.businessNumber}</dd>
      <dt>Business address</dt><dd>{operator.address}</dd>
      <dt>Contact</dt><dd><a href={`tel:${operator.phone}`}>{operator.phone}</a> · <a href={`mailto:${operator.email}`}>{operator.email}</a></dd>
    </dl>
  );
}
