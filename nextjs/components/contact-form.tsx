"use client";

import { useState, type FormEvent } from "react";

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
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), startedAt }),
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
      <label className="contact-field">
        <span>What should we understand?</span>
        <textarea
          name="message"
          rows={8}
          minLength={20}
          maxLength={5000}
          placeholder="Document volume, source types, target outputs, security requirements, and timing."
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

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="contact-field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
