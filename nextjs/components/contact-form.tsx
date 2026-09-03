"use client";

import { useState, type FormEvent } from "react";
import { QUALIFICATION } from "@/lib/contact-qualification";

type State = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [startedAt] = useState(() => Date.now());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const form = event.currentTarget;

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
          `getAll` rather than `Object.fromEntries`: source types are checkboxes and share a
          name, and fromEntries keeps only the last of them -- so a visitor who ticked four
          boxes would have been reported as having ticked one.
        */
        body: JSON.stringify({ ...collect(new FormData(form)), startedAt }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We could not send your inquiry.");
      form.reset();
      setState("sent");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "We could not send your inquiry.");
    }
  }

  return (
    <form className="contact-form" onSubmit={(event) => void submit(event)}>
      <div className="contact-pair">
        <Field label="Name" name="name" autoComplete="name" minLength={2} maxLength={80} required />
        <Field label="Work email" name="email" type="email" autoComplete="email" maxLength={254} required />
      </div>
      <Field label="Company or organisation" name="company" autoComplete="organization" maxLength={120} />
      <label className="contact-field">
        <span>Inquiry type</span>
        <select name="topic" defaultValue="sales">
          <option value="sales">Product and pricing</option>
          <option value="support">Product support</option>
          <option value="security">Security review</option>
          <option value="privacy">Privacy</option>
          <option value="partnership">Partnership</option>
        </select>
      </label>
      {/*
        The qualification block. Closed lists, all optional -- a visitor who only wants to ask a
        question answers none of them, and the one who wants a useful first reply answers six
        without typing anything a customer document could end up inside.
      */}
      <fieldset className="contact-qualify">
        <legend>About the material</legend>
        {QUALIFICATION.map((field) => (
          field.multiple ? (
            <fieldset className="contact-field" key={field.name}>
              <legend>{field.label}</legend>
              {field.hint ? <small>{field.hint}</small> : null}
              <div className="contact-checks">
                {field.options.map((option) => (
                  <label key={option}>
                    <input type="checkbox" name={field.name} value={option} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <label className="contact-field" key={field.name}>
              <span>{field.label}</span>
              <select name={field.name} defaultValue="">
                <option value="">No answer</option>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )
        ))}
      </fieldset>
      <label className="contact-field">
        <span>What should we understand?</span>
        <textarea
          name="message"
          rows={8}
          minLength={20}
          maxLength={5000}
          placeholder="What the material is, who needs to answer from it, and anything the questions above did not cover. Do not paste customer documents."
          required
        />
      </label>
      <label className="contact-trap" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <div className="contact-submit">
        <button className="btn" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending..." : "Send inquiry"}
        </button>
        <span>Your information is used only to answer this inquiry.</span>
      </div>
      <div className="contact-status" aria-live="polite">
        {state === "sent" && <p data-state="sent">Received. We will reply from an official TAVONEL address.</p>}
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

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="contact-field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
