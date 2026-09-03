import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { parseQualification, qualificationLines } from "@/lib/contact-qualification";

export const runtime = "nodejs";

const TOPICS = {
  sales: "Product and pricing",
  support: "Product support",
  security: "Security review",
  privacy: "Privacy",
  partnership: "Partnership",
} as const;

type Topic = keyof typeof TOPICS;
type Contact = {
  name: string;
  email: string;
  company: string;
  topic: Topic;
  message: string;
  website: string;
  startedAt: number;
  /* Closed-list answers only, validated against the same lists the form renders. */
  qualification: Record<string, string[]>;
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const buckets = new Map<string, number[]>();

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return error("This request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error("Only JSON requests are accepted.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return error("The request is too large.", 413);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return error("Check the request format and try again.", 400);
  }

  const contact = parseContact(raw);
  if (!contact) return error("Check the required fields and input lengths.", 400);

  // A successful no-op gives automated submitters no useful feedback.
  if (contact.website || Date.now() - contact.startedAt < 1_500) {
    return accepted();
  }

  if (isRateLimited(fingerprint(request))) {
    return error("Too many requests. Please try again in 10 minutes.", 429);
  }

  const apiKey = process.env.AKC_RESEND_API_KEY;
  const from = process.env.AKC_CONTACT_FROM;
  const to = process.env.AKC_CONTACT_TO;
  if (!apiKey || !from || !to) {
    return error("The inquiry channel is not available yet. Please try again shortly.", 503);
  }

  const delivery = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": contactId(contact.email, contact.message),
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: contact.email,
      subject: `[TAVONEL inquiry] ${TOPICS[contact.topic]} - ${contact.name}`,
      text: plainText(contact),
      html: htmlBody(contact),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!delivery?.ok) return error("Delivery is delayed. Please try again shortly.", 502);
  return accepted();
}

function parseContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const name = text(value.name);
  const email = text(value.email).toLowerCase();
  const company = text(value.company);
  const topic = text(value.topic);
  const message = text(value.message);
  const website = text(value.website);
  const startedAt = value.startedAt;
  /*
    A submission carrying an option this form never offered is not an unusual visitor. It is
    rejected outright rather than dropped, because dropping it would deliver the rest of the
    message as though nothing had happened.
  */
  const qualification = parseQualification(value);
  if (!qualification) return null;

  if (
    name.length < 2 || name.length > 80 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    company.length > 120 ||
    !(topic in TOPICS) ||
    message.length < 20 || message.length > 5_000 ||
    website.length > 200 ||
    typeof startedAt !== "number" || !Number.isInteger(startedAt) || startedAt <= 0
  ) return null;

  return { name, email, company, topic: topic as Topic, message, website, startedAt, qualification };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  if (process.env.NODE_ENV !== "production") {
    try {
      if (["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) return true;
    } catch {
      return false;
    }
  }

  return (process.env.AKC_CONTACT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => {
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    });
}

function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return createHash("sha256")
    .update(forwarded || request.headers.get("x-real-ip") || "unknown")
    .digest("hex");
}

function isRateLimited(key: string) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10_000) buckets.clear();
  return false;
}

function contactId(email: string, message: string) {
  const digest = createHash("sha256")
    .update(`${email}\n${message}`)
    .digest("hex")
    .slice(0, 32);
  return `contact/${digest}`;
}

function plainText(contact: Contact) {
  return [
    "TAVONEL website inquiry",
    "",
    `Type: ${TOPICS[contact.topic]}`,
    `Name: ${contact.name}`,
    `Email: ${contact.email}`,
    `Company: ${contact.company || "Not provided"}`,
    "",
    contact.message,
  ].join("\n");
}

function htmlBody(contact: Contact) {
  return `<main style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#171a1f">
    <p style="font-size:12px;letter-spacing:.12em;color:#3159d9">TAVONEL WEBSITE INQUIRY</p>
    <h1 style="font-size:24px">${escapeHtml(TOPICS[contact.topic])}</h1>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:10px 0;border-bottom:1px solid #ddd">Name</th><td style="padding:10px 0;border-bottom:1px solid #ddd">${escapeHtml(contact.name)}</td></tr>
      <tr><th style="text-align:left;padding:10px 0;border-bottom:1px solid #ddd">Email</th><td style="padding:10px 0;border-bottom:1px solid #ddd">${escapeHtml(contact.email)}</td></tr>
      <tr><th style="text-align:left;padding:10px 0;border-bottom:1px solid #ddd">Company</th><td style="padding:10px 0;border-bottom:1px solid #ddd">${escapeHtml(contact.company || "Not provided")}</td></tr>
      ${qualificationLines(contact.qualification).map((line) => `<tr><th style="text-align:left;padding:10px 0;border-bottom:1px solid #ddd">${escapeHtml(line.label)}</th><td style="padding:10px 0;border-bottom:1px solid #ddd">${escapeHtml(line.value)}</td></tr>`).join("")}
    </table>
    <p style="font-size:15px;line-height:1.7;margin-top:28px">${escapeHtml(contact.message).replaceAll("\n", "<br>")}</p>
  </main>`;
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]!);
}

function accepted() {
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
