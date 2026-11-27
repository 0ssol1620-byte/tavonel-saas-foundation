"use client";

import { useEffect, useState } from "react";
import type { ProductMeasurementChoice } from "@/lib/product-measurement";
import { readFirstTouch } from "@/lib/recipe-intent";

/*
  WO-AN-RUM-1: the signed-in user's product-measurement choice (D26). Two places, one component:
  `prompt` on the workspace home asks once and disappears after any answer; `setting` under Trust &
  integrity always shows the current state with one button to change it, so withdrawing is as easy
  as allowing. Nothing is recorded until the server holds a yes (fail closed there, not here).

  A yes carries the first-touch campaign name and ad label of this tab, if any; the server keeps it
  only when it is a campaign we registered. A no carries nothing.
*/
type Choice = ProductMeasurementChoice["choice"];

const EXPLANATION = "With your permission, TAVONEL records the date you first verify a record, the date an AI tool or API key first reads one of your Worlds, and the days you use a World after that. Only those dates are kept, never your documents, questions or file names. Turning it off deletes what was recorded.";

async function call(getToken: () => Promise<string | null>, body?: { allowed: boolean; utm_campaign?: string; utm_content?: string }): Promise<Choice | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const response = await fetch("/api/product-measurement", {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const read = await response.json() as Partial<ProductMeasurementChoice>;
    return read.choice === "allowed" || read.choice === "declined" || read.choice === "undecided" ? read.choice : null;
  } catch {
    return null;
  }
}

export default function ProductMeasurement({ getToken, variant }: {
  getToken: () => Promise<string | null>;
  variant: "prompt" | "setting";
}) {
  const enabled = process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1";
  const [choice, setChoice] = useState<Choice | "unread" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void call(getToken).then((read) => { if (live) setChoice(read ?? "unread"); });
    return () => { live = false; };
    // The token getter is a fresh closure every render; the choice is read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || choice === null) return null;
  if (variant === "prompt" && choice !== "undecided") return null;

  const choose = async (allowed: boolean) => {
    setBusy(true);
    setFailed(false);
    const touch = allowed ? readFirstTouch() : null;
    const saved = await call(getToken, {
      allowed,
      ...(touch?.utm_campaign ? { utm_campaign: touch.utm_campaign } : {}),
      ...(touch?.utm_campaign && touch.utm_content ? { utm_content: touch.utm_content } : {}),
    });
    setBusy(false);
    if (saved) setChoice(saved);
    else setFailed(true);
  };

  if (choice === "unread") {
    return variant === "setting"
      ? <section className="card"><h2>Product measurement</h2><p className="fine" role="status">Your choice could not be read right now. Reload the page to try again.</p></section>
      : null;
  }
  return (
    <section className="card" aria-labelledby={`product-measurement-${variant}`} data-product-measurement={variant}>
      <h2 id={`product-measurement-${variant}`}>Product measurement</h2>
      {variant === "setting" ? <p role="status">{choice === "allowed" ? "On." : "Off."}</p> : null}
      <p className="fine">{EXPLANATION} <a href="/privacy">Privacy notice</a></p>
      <div className="billing-actions">
        {variant === "prompt" ? (
          <>
            <button type="button" disabled={busy} onClick={() => void choose(false)}>No thanks</button>
            <button type="button" disabled={busy} onClick={() => void choose(true)}>Allow</button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void choose(choice !== "allowed")}>
            {choice === "allowed" ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {failed ? <p className="fine" role="alert">Your choice was not saved. Try again.</p> : null}
    </section>
  );
}
