import { readLegalOperator } from "@/lib/legal-operator";

export default function LegalOperatorDisclosure({ compact = false }: { compact?: boolean }) {
  /*
    BA-149. This used to render "Paid checkout remains launch-gated until the complete operator
    disclosure is published" whenever the operator environment is absent -- which is the state of
    the pilot deployment, so it was the sentence in production, in 11px mono, in the footer of
    every policy and trust page a procurement reader opens. Two pieces of internal launch
    vocabulary, and a sentence that is pure absence: we cannot be paid, and we have not said who
    we are.

    With no operator record there is nothing to disclose, so nothing renders. The decision on when
    the Korean e-commerce operator notice must be published is a legal one and is a founder item;
    it does not require a placeholder in the meantime.
  */
  const operator = readLegalOperator();
  if (!operator) return null;
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
