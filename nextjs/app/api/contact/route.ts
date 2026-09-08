import { createHash, createHmac, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { parseQualification, qualificationLines } from "@/lib/contact-qualification";
import { isAllowedFormOrigin } from "@/lib/public-form-origin";
import { consumeDurableContactLimit } from "@/lib/contact-durable-guard";
import { readBoundedJson } from "@/lib/enterprise-http";

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
/*
  Per-process, so it never leaves this instance and needs no configuration. Its only job is to
  keep the raw client IP and the submitted address out of the limiter keys; the bucket map is
  already process-local, so a durable secret would buy nothing here.
*/
const KEY_SALT = randomBytes(32);

/*
  Local/preview-only fallback. Production uses the atomic two-dimension RPC
  introduced in migration 0055 and fails closed when that store is unavailable.
  The historical design note below explains why developer API-key limits were
  not reused for a public contact form.

  Blueprint §30 asks for a distributed limit across IP AND account/domain, and §31 names this
  Map as the P0 gap. Reusing lib/developer-store.ts consumeDeveloperApiRateLimit is not
  possible without a migration: consume_foundation_api_rate_limit
  (supabase/migrations/0012_foundation_connections_and_api_keys.sql:246) returns false unless
  p_scope is one of the ten developer scopes (:264) and a live foundation_api_keys row exists
  for p_key_id + p_workspace_key (:270), and foundation_api_rate_windows itself constrains
  key_id by foreign key (:55) and workspace_key by `^pilot-...` check (:56). A contact
  submission has none of those. Upgrade path: a `consume_public_form_rate_limit(p_bucket text,
  p_window_seconds int, p_limit int)` RPC over its own table, then this function becomes an
  await on it that answers 503 when the store is unreachable.

  Until then this holds only within one warm instance. It is enforced on both dimensions so a
  single rotating address cannot buy extra allowance, and so the key shape already matches the
  durable version.
*/
function isRateLimitedMultiDimensional(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  // Both must pass. Checking them in sequence would let a rejected first dimension skip
  // recording the second, so every dimension is consumed before the verdict is returned.
  const verdicts = [saltedKey("ip", ip), saltedKey("domain", domain)].map(isRateLimited);
  return verdicts.some(Boolean);
}

function saltedKey(dimension: string, value: string) {
  return createHmac("sha256", KEY_SALT).update(`${dimension}\n${value}`).digest("hex");
}

export async function POST(request: Request) {
  if (!isAllowedFormOrigin(request)) return error("This request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error("Only JSON requests are accepted.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return error("The request is too large.", 413);
  }

  // Bound the actual stream as well as the claimed Content-Length. A chunked
  // request must not allocate arbitrary memory before input validation starts.
  const parsed = await readBoundedJson(request, 16_384);
  if (!parsed.ok) return error(parsed.status === 413
    ? "The request is too large." : "Check the request format and try again.", parsed.status);
  const raw: unknown = parsed.value;

  const contact = parseContact(raw);
  if (!contact) return error("Check the required fields and input lengths.", 400);

  // A successful no-op gives automated submitters no useful feedback.
  if (contact.website || Date.now() - contact.startedAt < 1_500) {
    return accepted();
  }

  const admission = process.env.VERCEL_ENV === "production" || process.env.TAVONEL_DURABLE_WORKSPACE_GUARDS === "1"
    ? await consumeDurableContactLimit(request, contact.email)
    : isRateLimitedMultiDimensional(request, contact.email) ? "limited" : "allowed";
  if (admission === "unavailable") {
    return error("The inquiry channel is temporarily unavailable. Please try again shortly.", 503);
  }
  if (admission === "limited") {
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
