import Link from "next/link";
import type { Route } from "next";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS } from "@/lib/compile-limits";
import { RECIPE_START, type RecipeIntent } from "@/lib/recipe-intent";
import {
  MAX_UNITS_PER_PAGE,
  PROCESSING_UNIT_USD,
  formatUsd,
  quoteCompilePages,
} from "@/lib/usage-pricing";

/**
 * What a recipe will cost and what it needs, before anyone signs in.
 *
 * Four rows, every number imported. The page count is the one that cannot be: nothing has
 * measured the reader's files yet, so `pages` is null on the sign-in page and the row says where
 * the number comes from instead of showing one. A preflight that guesses a page count is a
 * preflight that quotes a price for work nobody sized -- which is the thing this component exists
 * to stop, so `pages={null}` is the normal case and not a degraded one.
 *
 * The activation row is the fact readers are most likely to get wrong on the way in: turning a
 * reviewed candidate into a live World needs a paid plan -- Developer if the reader owns the
 * workspace (FD-02, `planReachesLevel(..., "activation", "owner")`), or Team, which is arranged
 * in a conversation. Every half is read from the catalog, so if either `saleChannel` flips the
 * sentence follows it. The refusal is stated as plainly as the permission: a free evaluation
 * compiles, reviews and exports and is refused at activation, which is the sentence that must
 * not soften. What a given deployment will accept from a given account is a separate question
 * the sign-in page asks `/api/status`; this component states the plan, not the deployment.
 */
export function RecipePreflight({
  intent,
  pages = null,
  omitLanding = false,
}: {
  intent: RecipeIntent;
  pages?: number | null;
  /**
   * Drops the "where you land" row where it is not the next thing that happens: after sign-in it
   * gives way to the continuation, and where storage is blocked the resume it promises cannot
   * happen.
   */
  omitLanding?: boolean;
}) {
  const team = BILLING_OFFERS.studio_access;
  const developer = BILLING_OFFERS.observer_access;
  const quote = typeof pages === "number" ? quoteCompilePages(pages) : null;
  const perPageCeiling = formatUsd(MAX_UNITS_PER_PAGE * PROCESSING_UNIT_USD);

  return (
    <ul className="auth-facts">
      <li>
        <b>Pages.</b>{" "}
        {quote
          ? `${quote.pages} pages in this run.`
          : "Counted from your own files before a run starts, and shown to you then."}
      </li>
      <li>
        <b>Maximum cost.</b>{" "}
        {quote
          ? `Up to ${formatUsd(quote.maximumUsd)} for this run.`
          : `Up to ${perPageCeiling} per page, quoted in full for your confirmation before anything runs.`}
      </li>
      <li>
        <b>Sources in one compile.</b> {COMPILE_MIN_DOCUMENTS} to {COMPILE_MAX_DOCUMENTS} documents.
      </li>
      <li>
        <b>Review.</b> {activationPolicy.candidatePromotion.reason}
      </li>
      <li>
        <b>Activation.</b> Turning a reviewed candidate into a live World needs a paid plan: the{" "}
        {developer.label} plan if you own the workspace
        {developer.saleChannel === "self_serve" ? (
          <>, which you can start on <Link href="/pricing">pricing</Link></>
        ) : (
          <>, which we arrange with you</>
        )}
        , or the {team.label} plan
        {team.saleChannel === "contact" ? (
          <>
            , which we set up with you directly — <Link href="/contact">talk to us</Link> to arrange
            it
          </>
        ) : (
          <>, also shown on <Link href="/pricing">pricing</Link></>
        )}
        . A free evaluation compiles, reviews and exports; its activation request is refused.
      </li>
      {omitLanding ? null : <li>
        {/*
          A plain anchor, not `next/link`. `returnTo` is one of `RETURN_TO_PATHS`, and the cookbook
          half of that list is typed-routes-unknown until the cookbook route exists -- so a `Link`
          here would tie this component's compilation to another route landing first. The
          destination is still a closed allow-list, which is the property that matters, and a
          full navigation is what the sign-in hop does anyway.
        */}
        <b>Where you land.</b> Signing in brings you to this recipe&rsquo;s first step with nothing
        run, and <a href={intent.returnTo}>the page you started from</a> stays one link away.
      </li>}
    </ul>
  );
}

/**
 * The same recipe, once the reader is signed in.
 *
 * The sign-in used to end on the cookbook page, which is server-rendered text that cannot know a
 * sign-in just happened -- so the reader was shown the same "Start this recipe" button again, and
 * pressing it bounced them to an empty workspace. This is the step that was missing: the same
 * preflight, then one link to where the recipe's first step actually lives.
 *
 * Every action is a link the reader presses. Nothing here uploads, compiles, activates or opens a
 * checkout, and the destination comes from `RECIPE_START` by the closed recipe id -- the URL that
 * brought the reader here cannot name it. `processing` is the deployment's customer-processing
 * gate from `/api/status`; until it has answered `true`, a recipe that needs the reader's files
 * points at the workspace home rather than at a file picker the deployment would refuse.
 */
export function RecipeContinuation({
  intent,
  processing,
}: {
  intent: RecipeIntent;
  processing: boolean | null;
}) {
  const start = RECIPE_START[intent.recipeId];
  const needsFiles = start === "/workspace/sources";
  const ready = start !== null && (!needsFiles || processing === true);
  const href = (ready && start) || "/workspace";
  const label = !ready ? "Open your workspace"
    : needsFiles ? "Choose your documents"
      : "Open the developer page";
  const next = start === null
    ? "This recipe has no starting control in the workspace yet. Its page lists the next steps, including who to talk to."
    : needsFiles && processing === null
      ? "Checking whether this deployment accepts customer files."
      : needsFiles && processing === false
        ? "Customer file processing is not open on this deployment yet, so this recipe cannot take your files here today. The workspace shows where your access stands."
        : needsFiles
          ? "Files you choose are counted and quoted before anything is processed, and nothing runs until you confirm the quote."
          : "Keys are issued there only if your plan includes them.";

  return (
    <>
      <p className="notice static" role="status">
        <strong>You are signed in, and nothing has run.</strong> Signing in did not upload,
        compile, activate or charge anything, and it did not change your plan.
      </p>
      <RecipePreflight intent={intent} omitLanding />
      <p className="fine">{next}</p>
      <div className="auth-actions">
        <Link className="btn" href={href as Route}>{label}</Link>
        <a className="btn ghost" href={intent.returnTo}>Back to the recipe</a>
      </div>
    </>
  );
}
