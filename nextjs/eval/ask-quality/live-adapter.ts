/**
 * The baseline answerer: POST /api/v1/collections/{id}/ask on a NON-production deployment, with
 * answerMode required to be evidence_excerpts. Typed against `Answerer` (review R1 m6).
 *
 * Host policy (review R1 m2): an allowlist, not a denylist. Only loopback hosts are allowed by
 * default; any other host must be named exactly with --allow-host. A production host is refused
 * even when named -- measuring production is not this harness's call.
 */
import type { Answerer, AnswererResponse } from "./score";

export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export const PRODUCTION_HOSTS = [/^(?:www\.)?tavonel\.com$/, /\.tavonel\.com$/, /^tavonel-saas-foundation(?:-[a-z0-9-]+)?\.vercel\.app$/];

export function checkHost(baseUrl: string, allowHosts: string[] = []): string {
  // A fully qualified name with its root dot(s) ("tavonel.com.", "tavonel.com..") is the same host; strip them before either check.
  const host = new URL(baseUrl).hostname.replace(/\.+$/, "");
  if (PRODUCTION_HOSTS.some((pattern) => pattern.test(host))) throw new Error(`refusing production host ${host}`);
  if (![...DEFAULT_ALLOWED_HOSTS, ...allowHosts].includes(host)) throw new Error(`host ${host} is not allowed; name it with --allow-host`);
  return host;
}

type AskBody = {
  code?: string;
  status?: string;
  answer?: unknown;
  answerMode?: string;
  retrievalPath?: string;
  reason?: string | null;
  citations?: Array<{ excerpt?: unknown; evidenceId?: string; pageNumber1?: number }>;
};

export function createEvidenceExcerptsAnswerer(options: {
  baseUrl: string | undefined;
  token: string | undefined;
  collections: Record<string, string>;
  allowHosts?: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Answerer {
  const { baseUrl, token, collections, allowHosts = [], fetchImpl = fetch, now = () => performance.now() } = options;
  if (!token) throw new Error("TAVONEL_EVAL_WORKSPACE_TOKEN is not set");
  if (!baseUrl) throw new Error("--base-url is required for the live answerer");
  checkHost(baseUrl, allowHosts);
  return {
    id: "evidence-excerpts-http",
    kind: "live",
    async ask(question: string, corpusRef: string): Promise<AnswererResponse> {
      const collectionId = collections[corpusRef];
      if (!collectionId) throw new Error(`no collection mapped for ${corpusRef}`);
      const url = new URL(`/api/v1/collections/${encodeURIComponent(collectionId)}/ask`, baseUrl);
      for (let attempt = 0; ; attempt += 1) {
        const started = now();
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const latencyMs = Math.round(now() - started);
        if (response.status === 429 && attempt < 3) {
          const wait = Math.min(60, Number(response.headers.get("retry-after") ?? "5") || 5);
          await new Promise((resolve) => setTimeout(resolve, wait * 1000));
          continue;
        }
        const body = (await response.json().catch(() => null)) as AskBody | null;
        // An operational failure is not an abstention: abort the run, write no receipt.
        if (response.status !== 200 || body === null) throw new Error(`ask ${corpusRef}: HTTP ${response.status} ${body?.code ?? ""}`.trim());
        if (body.answerMode !== "evidence_excerpts") throw new Error(`ask ${corpusRef}: answerMode ${body.answerMode}, the baseline is evidence_excerpts`);
        return {
          answer: typeof body.answer === "string" ? body.answer : "",
          numeric: null,
          // The route exposes a 420-character `excerpt` per citation; that preview is what is scored.
          citations: (body.citations ?? []).map((citation) => ({
            text: typeof citation.excerpt === "string" ? citation.excerpt : "",
            evidenceId: citation.evidenceId ?? null,
            pageNumber1: citation.pageNumber1 ?? null,
          })),
          abstained: body.status !== "grounded",
          latencyMs,
          meta: { code: body.code ?? null, retrievalPath: body.retrievalPath ?? null, answerMode: body.answerMode, reason: body.reason ?? null },
        };
      }
    },
  };
}
