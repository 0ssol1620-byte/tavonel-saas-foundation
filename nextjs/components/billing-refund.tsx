"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { REFUND_WINDOW_DAYS } from "@/lib/billing-catalog";
import { formatTimestamp } from "@/lib/format";
import type { RefundFacts } from "@/lib/refund-eligibility";

/*
  One-step buy (2026-11-10). The renewal date and the refund path, on the billing card of a paying
  workspace. The reading is `/api/billing/refund-request` (GET), the request is the same route
  (POST), which pages an operator who refunds in Paddle by hand. The turnaround sentence is the one
  /refunds already states, and nothing else is promised.
*/

const NOT_READ = "not read yet";

type Request = "idle" | "sending" | "sent" | "failed";

// R1 review (2026-11-10): the rule and the recorded dates only. No verdict, no page count.
function ruleSentence(facts: RefundFacts) {
  const window = facts.windowEndsAt ? ` For your latest payment that window closes ${formatTimestamp(facts.windowEndsAt) ?? NOT_READ}.` : "";
  return `A payment can be refunded within ${REFUND_WINDOW_DAYS} days while fewer than ${facts.allowancePages.toLocaleString("en-US")} pages have been processed.${window} Eligibility is confirmed when you request.`;
}

export default function BillingRefund({ getToken }: { getToken: () => Promise<string | null> }) {
  const [facts, setFacts] = useState<RefundFacts | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [request, setRequest] = useState<Request>("idle");

  useEffect(() => {
    let live = true;
    void (async () => {
      const token = await getToken();
      const response = token
        ? await fetch("/api/billing/refund-request", { cache: "no-store", headers: { authorization: `Bearer ${token}` } }).catch(() => null)
        : null;
      const body = response?.ok ? await response.json().catch(() => null) as { facts?: RefundFacts } | null : null;
      if (!live) return;
      if (body?.facts) setFacts(body.facts);
      else setReadFailed(true);
    })();
    return () => { live = false; };
    // One reading per mount. The caller's token reader is a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setRequest("sending");
    const token = await getToken();
    const response = token
      ? await fetch("/api/billing/refund-request", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null)
      : null;
    setRequest(response?.status === 202 ? "sent" : "failed");
  };

  return (
    <section className="billing-refund" aria-labelledby="billing-refund-title">
      {facts ? (
        <dl>
          <div><dt>Renews</dt><dd>{formatTimestamp(facts.renewsAt) ?? "no renewal scheduled"}</dd></div>
          <div><dt>Latest payment</dt><dd>{formatTimestamp(facts.paidAt) ?? NOT_READ}</dd></div>
        </dl>
      ) : null}
      <h3 id="billing-refund-title">Refund</h3>
      <p className="fine">
        {facts ? ruleSentence(facts) : readFailed
          ? "The refund rule could not be read right now. Eligibility is confirmed when you request."
          : "Reading the refund rule for your latest payment."}{" "}
        <Link href={"/refunds" as Route}>Refund rules</Link>
      </p>
      {request === "sent" ? (
        <p className="fine" role="status">
          Request sent. An operator reviews it and refunds an approved request in Paddle to the original payment method. Approved card refunds typically appear within 3-5 working days.
        </p>
      ) : (
        <div className="billing-actions">
          <button type="button" disabled={request === "sending"} onClick={() => void send()}>
            {request === "sending" ? "Sending…" : "Request a refund"}
          </button>
        </div>
      )}
      {request === "failed" ? (
        <p className="billing-hold" role="alert">
          The request could not be sent, and nothing was refunded. Write to{" "}
          <a href="mailto:support@tavonel.com">support@tavonel.com</a> with your transaction email.
        </p>
      ) : null}
    </section>
  );
}
