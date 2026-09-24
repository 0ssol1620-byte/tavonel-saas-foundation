"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { QUALIFICATION } from "@/lib/contact-qualification";
import { contactText, koreanContactError, type ContactLocale } from "@/lib/contact-locale";
import { trackFunnel, trackFunnelOnce } from "@/lib/funnel-events";

type State = "idle" | "sending" | "sent" | "error";

export default function ContactForm({ locale = "en" }: { locale?: ContactLocale }) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [startedAt] = useState(() => Date.now());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    // The endpoint returns the same response for honeypots; exclude those submissions locally.
    const eligibleLead = !formData.get("website") && Date.now() - startedAt >= 1_500;

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
          `getAll` rather than `Object.fromEntries`: source types are checkboxes and share a
          name, and fromEntries keeps only the last of them -- so a visitor who ticked four
          boxes would have been reported as having ticked one.
        */
        body: JSON.stringify({ ...collect(formData), startedAt, locale }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setState("error");
        setMessage(locale === "ko"
          ? koreanContactError(response.status)
          : result.error || "We could not send your inquiry.");
        return;
      }
      const topic = formData.get("topic");
      // Count only a received commercial inquiry; no form values enter analytics.
      if (eligibleLead && (topic === "sales" || topic === "partnership")) trackFunnel("generate_lead");
      /*
        D7 `request_access_complete`: the close of the access funnel `request_access_start`
        opened, fired here beside `generate_lead` rather than folded into it.

        Two names because they count two things. `generate_lead` is a COMMERCIAL enquiry and is
        narrowed to the two topics that are one; this is a request that reached us, whatever the
        reader chose in the topic list -- and /contact is the destination `ACCESS_CTA` sends
        every "Request access" click on the site to, so narrowing it to sales would report most
        of that funnel's completions as abandonment. The honeypot and timing gate is shared: a
        submission that failed either is not a reader.
      */
      if (eligibleLead) trackFunnel("request_access_complete");
      form.reset();
      setState("sent");
    } catch (reason) {
      setState("error");
      setMessage(locale === "ko"
        ? koreanContactError()
        : reason instanceof Error ? reason.message : "We could not send your inquiry.");
    }
  }

  return (
    <form
      className="contact-form"
      onSubmit={(event) => void submit(event)}
      /*
        D7 `request_access_start`: the reader began filling the form, which is the step between
        arriving on /contact and sending it. React's synthetic focus event bubbles, so one
        handler on the form covers every field without one per input, and `trackFunnelOnce`
        keeps a reader who tabs through eleven fields from producing eleven rows. It carries no
        detail: WHICH field was touched first is a fact about the reader, not about the funnel.
      */
      onFocus={() => trackFunnelOnce("request_access_start")}
    >
      {/*
        G2-034. Which fields are required, before the submit rather than after it.

        Three fields are required and none of them said so, so a visitor discovered it from a
        browser validation bubble on whichever one the browser reached first. The mark is rendered
        inside the label beside the field name, and the word is spelled out for a screen reader
        rather than left as a bare asterisk.
      */}
      <p className="fine">{contactText("Three fields are needed for a reply. They are marked Required.", locale)}</p>
      <div className="contact-pair">
        <Field label={contactText("Name", locale)} requiredLabel={contactText("Required", locale)} name="name" autoComplete="name" minLength={2} maxLength={80} required />
        <Field label={contactText("Work email", locale)} requiredLabel={contactText("Required", locale)} name="email" type="email" autoComplete="email" maxLength={254} required />
      </div>
      <Field label={contactText("Company or organization", locale)} name="company" autoComplete="organization" maxLength={120} />
      <label className="contact-field">
        <span>{contactText("Inquiry type", locale)}</span>
        <select name="topic" defaultValue="sales">
          <option value="sales">{contactText("Product and pricing", locale)}</option>
          <option value="support">{contactText("Product support", locale)}</option>
          <option value="security">{contactText("Security review", locale)}</option>
          <option value="privacy">{contactText("Privacy", locale)}</option>
          <option value="partnership">{contactText("Partnership", locale)}</option>
        </select>
      </label>
      {/*
        The qualification block. Closed lists, all optional -- a visitor who only wants to ask a
        question answers none of them, and the one who wants a useful first reply answers six
        without typing anything a customer document could end up inside.
      */}
      <details className="contact-qualification-fold">
        <summary>{contactText("Help us prepare a better reply", locale)} <span>{contactText("Optional", locale)}</span></summary>
        <fieldset className="contact-qualify">
          <legend>{contactText("About the material", locale)}</legend>
          {QUALIFICATION.map((field) => (
            field.multiple ? (
              <fieldset className="contact-field" key={field.name}>
                <legend>{contactText(field.label, locale)}</legend>
                {field.hint ? <small>{contactText(field.hint, locale)}</small> : null}
                <div className="contact-checks">
                  {field.options.map((option) => (
                    <label key={option}>
                      <input type="checkbox" name={field.name} value={option} />
                      <span>{contactText(option, locale)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label className="contact-field" key={field.name}>
                <span>{contactText(field.label, locale)}</span>
                <select name={field.name} defaultValue="">
                  <option value="">{contactText("No answer", locale)}</option>
                  {field.options.map((option) => <option key={option} value={option}>{contactText(option, locale)}</option>)}
                </select>
              </label>
            )
          ))}
        </fieldset>
      </details>
      <label className="contact-field">
        {/* BA-141. The abstract question asked for an essay; the concrete one gets an answer. */}
        <span>{contactText("What are you trying to do?", locale)} <RequiredMark label={contactText("Required", locale)} /></span>
        {/*
          BQ-113. The one rule about this field, said once and kept on screen.

          It was in the placeholder and again in the page lede above the form. A placeholder is
          gone as soon as there is a character in the box, so the copy that mattered most was the
          copy that vanished first. The description is tied to the field for a screen reader.
        */}
        <small className="fine" id="contact-message-rule">{contactText("Do not attach or paste customer documents here.", locale)}</small>
        <textarea
          name="message"
          rows={8}
          minLength={20}
          maxLength={5000}
          aria-describedby="contact-message-rule"
          placeholder={contactText("What the material is, who needs to answer from it, and anything the questions above did not cover.", locale)}
          required
        />
      </label>
      <label className="contact-trap" aria-hidden="true">
        {contactText("Website", locale)}
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <div className="contact-submit">
        <button className="btn" type="submit" disabled={state === "sending"}>
          {contactText(state === "sending" ? "Sending..." : "Send inquiry", locale)}
        </button>
        <span>
          {contactText("We use this information to answer your inquiry.", locale)}{" "}
          <Link href="/privacy" hrefLang={locale === "ko" ? "en" : undefined}>
            {locale === "ko" ? "개인정보 처리방침 (영문)" : "Privacy notice"}
          </Link>
        </span>
      </div>
      <div className="contact-status" aria-live="polite">
        {state === "sent" && <p data-state="sent">{contactText("Received. We will reply from an official TAVONEL address.", locale)}</p>}
        {state === "error" && <p data-state="error">{message}</p>}
      </div>
    </form>
  );
}

/** Every value for every name, so a repeated checkbox name keeps all of its answers. */
function collect(data: FormData) {
  const body: Record<string, string | string[]> = {};
  for (const key of new Set(data.keys())) {
    const values = data.getAll(key).map((value) => String(value));
    body[key] = values.length > 1 ? values : values[0];
  }
  return body;
}

/*
  Announced as a word, not as an asterisk a screen reader may skip or read as "star".

  pages-11: the word was set in the label's own face, size, weight and colour, so "Name Required"
  read as one string and the field looked as if it were called that. The marker carries its own
  class now -- a separator and the eyebrow tone, sentence case against the label's caps -- so it
  is visibly a qualifier. It stays a word inside the label element, which is what keeps it in the
  accessible name and what the sentence above the form promises ("They are marked Required").
*/
function RequiredMark({ label = "Required" }: { label?: string }) {
  return <small className="contact-required">{label}</small>;
}

function Field({ label, requiredLabel, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; requiredLabel?: string }) {
  return (
    <label className="contact-field">
      <span>{label}{props.required ? <> <RequiredMark label={requiredLabel} /></> : null}</span>
      <input {...props} />
    </label>
  );
}
