import Link from "next/link";

/*
  SD-10 (delegated decision, 2026-09-16). The audit asked for social proof and this site has
  none: no customer names, no logos, no quotes, no case studies. Inventing any of them is the one
  thing the constitution forbids outright, and an empty logo wall would be the same lie in a
  lighter typeface.

  So the block says what a design partner actually receives. Every line below is a description of
  something that already exists on this deployment -- the capability manifest, the published
  limits, the receipts -- or of the intake path the header already states ("arranged with us").
  Nothing here promises a date, a price or a contract term; those are the founder's to set.

  BQ-065 changes how it says it, not what it says. The heading was "No customer logos, because
  there are none to show." under an eyebrow reading "DESIGN PARTNERS / INSTEAD OF A LOGO WALL" --
  two lines that advertise an absence twice, above a kicker that restates the heading under it,
  which the kicker rule deletes rather than restyles. The four things a partner gets have not
  changed by a word; the frame around them names the programme instead of naming what the
  programme is not. The sentence that has to stay -- that nothing on this site belongs to a
  customer -- stays, as the fine print it always was.

  What it may not do is write a new claim. The first draft of the lede here read "TAVONEL is set
  up with an early partner rather than sold to one" -- present tense, on a page whose previous
  copy said there are no customers to show. Whether a design partner exists is a fact about the
  business and a public claim, which is the founder's to make, not an implementer's. The lede is
  the surviving half of the sentence that was already here.
*/
export default function DesignPartners({ className }: { className?: string }) {
  return (
    <section className={className ? `design-partners ${className}` : "design-partners"} aria-labelledby="design-partners-title">
      <h2 id="design-partners-title">Working with a design partner.</h2>
      <p className="design-partners-lede">
        What an early partner works with:
      </p>
      <ul className="design-partners-list">
        <li>
          <strong>A compile of your own corpus, arranged with us.</strong>
          Rather than a self-serve upload, we set the collection up with you and run it.
        </li>
        <li>
          <strong>The limits for your formats, in writing, before anything runs.</strong>
          The same capability manifest this deployment validates every upload against, read against
          the files you actually have.
        </li>
        <li>
          <strong>Your result with its receipts.</strong>
          Every compiled fact carries the source location it was read from, and the package is
          verifiable with the published scripts rather than on our word.
        </li>
        <li>
          <strong>A direct line to the people writing the compiler.</strong>
          What you find changes what gets built next, and you see the change land.
        </li>
      </ul>
      <p className="design-partners-fine">
        No name, logo or quote on this site belongs to a customer, and none will until a customer
        signs off on the exact wording. Availability is a conversation, not a checkout:{" "}
        <Link href="/contact">request access</Link> and say what you are trying to compile.
      </p>
    </section>
  );
}
