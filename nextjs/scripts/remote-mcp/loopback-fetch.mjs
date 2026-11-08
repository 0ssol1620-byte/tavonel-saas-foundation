/**
 * Preload for the W1-A1 remote MCP shadow (`node --import`). Test plumbing, never shipped.
 *
 * The fixture build inlines NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co (playwright.config.ts),
 * so the server's Supabase calls are sent to that origin and rewritten here to the synthetic store
 * on loopback, and the synthetic R2 account's host to an empty bucket there. Every other non-loopback request is refused, so a shadow run cannot reach a real
 * service even if an env value leaks in. Refusals are logged by host only.
 */
const store = process.env.TAVONEL_SHADOW_STORE_ORIGIN;
if (!store || !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(store)) throw new Error("TAVONEL_SHADOW_STORE_ORIGIN must be http://127.0.0.1:<port>");
const original = globalThis.fetch;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

globalThis.fetch = async function shadowFetch(input, init) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  // The synthetic object store: an empty bucket on the same loopback server, under /__r2.
  const r2 = url.hostname === "00000000000000000000000000000000.r2.cloudflarestorage.com";
  if (url.origin === "https://test.supabase.co" || r2) {
    const target = `${store}${r2 ? "/__r2" : ""}${url.pathname}${url.search}`;
    if (typeof input === "string" || input instanceof URL) return original(target, init);
    return original(new Request(target, input), init);
  }
  if (LOOPBACK.has(url.hostname)) return original(input, init);
  console.error(JSON.stringify({ shadowBlockedHost: url.hostname }));
  throw new TypeError(`shadow run: outbound request to ${url.hostname} refused`);
};
