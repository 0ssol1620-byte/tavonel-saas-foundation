export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  OpenAI app submission domain verification (WO-MCP-LISTING-2): the token the OpenAI dashboard
  issues, served as plain text. The value only ever comes from TAVONEL_OPENAI_APPS_CHALLENGE, typed
  by the founder at submission time. Unset, blank, or not a single printable token: 404, so this
  server never invents or half-serves one.
*/
const TOKEN = /^[\x21-\x7e]{1,512}$/;

export function GET() {
  const token = process.env.TAVONEL_OPENAI_APPS_CHALLENGE?.trim() ?? "";
  if (!TOKEN.test(token)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(token, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
