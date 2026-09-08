import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assertReadOnly, createClient, createServer, TOOLS, validateInput } from "../public/developer/tavonel-mcp.mjs";
import { answerGroundedQuestion } from "./grounded-ask";
import {
  FORBIDDEN_EFFECT_MARKERS,
  PROMPT_INJECTION_FIXTURES,
  quotedFieldsRemoved,
  type InjectionFixture,
} from "./prompt-injection.fixtures";

/*
  Blueprint 2026-09-08 §40, run rather than described (S-78, S-79, S-80).

  Before this file, `grep -ri "prompt.inject" nextjs/` matched nothing. The exposure was real but
  narrow, and saying which is the honest version: `/ask` is retriever-and-excerpt only today, so
  there is no model turn for an instruction to hijack. That is a property of the current build,
  not a permanent one, and the last describe block below is the part that keeps it honest -- it
  fails the day a generator adapter appears without the untrusted-content boundary §40 asks for.

  Two assertions per fixture, and they pull in opposite directions on purpose:

    RETAINED  -- the payload comes back byte-for-byte in the excerpt. A system that strips
                 "suspicious" sentences out of a customer's document has silently changed the
                 document, and would pass a naive version of this test by destroying evidence.

    INERT     -- with the quoted-text fields removed, nothing in what the system itself produced
                 looks like a tool call, a scope grant, a credential or a promotion.

  A test that only checked INERT would be satisfied by deleting the payload. A test that only
  checked RETAINED would be satisfied by an system that obeys it. Both, together, are the claim.
*/

const COLLECTION_ID = `collection-${"a".repeat(32)}`;
const MANIFEST_DIGEST = `sha256:${"b".repeat(64)}`;
const ANCHOR = "quarterlyanchor";

function artifactCarrying(fixture: InjectionFixture) {
  const row = {
    chunkId: `chunk-${fixture.id}`,
    logicalId: `claim-${fixture.id}`,
    text: fixture.payload,
    sourceId: "source-1",
    sourceVersionId: "version-1",
    evidenceId: `evidence-${fixture.id}`,
    pageNumber1: 3,
    bbox1000: [100, 200, 900, 400],
    authority: "contract",
    authorityTier: "controlled",
    authorityScore: 0.7,
    claimIds: ["claim-semantic-1"],
    entityIds: [],
    entityNames: [],
    languages: ["en"],
    temporalRefs: ["2026"],
    retrievalTerms: [ANCHOR, "revenue", "figure"],
  };
  return {
    collectionId: COLLECTION_ID,
    manifestDigest: MANIFEST_DIGEST,
    package: { files: [{ path: "rag/chunks.jsonl", content: `${JSON.stringify(row)}\n` }] },
  };
}

function effectMarkersIn(value: unknown) {
  const structure = JSON.stringify(quotedFieldsRemoved(value));
  return FORBIDDEN_EFFECT_MARKERS.filter((marker) => marker.test(structure)).map(String);
}

describe("the nine §40 injection classes reach the answer path", () => {
  it("covers all nine classes exactly once", () => {
    const classes = PROMPT_INJECTION_FIXTURES.map((fixture) => fixture.injectionClass);
    expect(new Set(classes).size).toBe(9);
    expect(classes.length).toBe(9);
  });

  const inDocuments = PROMPT_INJECTION_FIXTURES.filter((fixture) => fixture.channel === "document");

  it.each(inDocuments.map((fixture) => [fixture.id, fixture] as const))(
    "%s: retains the payload as content and produces no tool call, scope or credential",
    (_id, fixture) => {
      const answer = answerGroundedQuestion(artifactCarrying(fixture), `what does the ${ANCHOR} say`);
      expect(answer, fixture.attempts).not.toBeNull();
      expect(answer!.status).toBe("grounded");
      // RETAINED: the sentence is still there, unedited. Whitespace is collapsed by the excerpt
      // window and nothing else is, so a single-line payload comes back identical.
      expect(answer!.citations[0]!.excerpt).toBe(fixture.payload);
      // INERT: nothing the system produced looks like the effect the payload asked for.
      expect(effectMarkersIn(answer), fixture.attempts).toEqual([]);
      expect(answer!.receipt.candidatePromotion).toBe(false);
    },
  );

  it("keeps the receipt bound to the world that was actually asked, not to one a payload names", () => {
    const fixture = inDocuments.find((item) => item.injectionClass === "fake-tool-json")!;
    const answer = answerGroundedQuestion(artifactCarrying(fixture), `what does the ${ANCHOR} say`);
    // pi-04's payload names collection-000... in a fake tool call. The receipt names the real one.
    expect(answer!.receipt.collectionId).toBe(COLLECTION_ID);
    expect(answer!.receipt.manifestDigest).toBe(MANIFEST_DIGEST);
  });

  it("abstains rather than inventing a citation when only the injected instruction is present", () => {
    const fixture = inDocuments[0]!;
    const answer = answerGroundedQuestion(artifactCarrying(fixture), "unrelated zzzz topic");
    expect(answer!.status).toBe("abstained");
    expect(answer!.citations).toEqual([]);
    expect(answer!.reason).toBe("NO_REGION_BOUND_EVIDENCE_MATCH");
  });
});

describe("a direct injection in the question itself", () => {
  const direct = PROMPT_INJECTION_FIXTURES.find((fixture) => fixture.channel === "question")!;

  it("is treated as a query string and cannot grant itself anything", () => {
    const answer = answerGroundedQuestion(artifactCarrying(direct), direct.payload.slice(0, 400));
    // Either it matches nothing and abstains, or it matches and cites -- both are answers about
    // documents. What it never is, is an instruction: nothing in the receipt moved.
    expect(answer!.receipt.candidatePromotion).toBe(false);
    expect(effectMarkersIn(answer)).toEqual([]);
  });

  it("is refused by the MCP argument validator before it can reach the network as anything else", () => {
    const ask = TOOLS.find((tool) => tool.name === "ask_world")!;
    // A payload trying to add an argument -- the shape a smuggled tool call would need -- is
    // refused by name, not sanitised into something that still travels.
    expect(() => validateInput(ask, { collectionId: COLLECTION_ID, question: "ok question", scope: "world:promote" }))
      .toThrow(/INPUT_INVALID: ask_world has no argument "scope"/);
    expect(() => validateInput(ask, { collectionId: "../../admin", question: "ok question" }))
      .toThrow("INPUT_INVALID: collectionId is not a collection id");
  });
});

describe("tool authority under injection", () => {
  it("still exposes no write tool when every fixture payload is the sample input", () => {
    for (const fixture of PROMPT_INJECTION_FIXTURES) {
      // assertReadOnly builds each tool's request from a sample. Driving it with the payloads
      // asserts that no payload can make a tool's request table entry produce a write.
      expect(assertReadOnly(TOOLS.map((tool) => ({
        ...tool,
        request: (input: Record<string, unknown>) => tool.request({ ...input, question: fixture.payload, query: fixture.payload }),
      })))).toBe(true);
    }
  });

  it("sends an injected question to the ask endpoint as a body value and nowhere else", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ code: "ANSWER_ABSTAINED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const call = createClient({ baseUrl: "https://tavonel.test", apiKey: "key-1", fetcher });
    const server = createServer({ call });
    const payload = PROMPT_INJECTION_FIXTURES.find((fixture) => fixture.channel === "question")!.payload;

    await server({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ask_world", arguments: { collectionId: COLLECTION_ID, question: payload } },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://tavonel.test/api/v1/collections/${COLLECTION_ID}/ask`);
    expect(calls[0]!.init.method).toBe("POST");
    // RETAINED again, on the other side of the boundary: the question travels intact...
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ question: payload });
    // ...and it did not become a header, a path segment or a second request.
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer key-1");
    expect(String(calls[0]!.url)).not.toContain("promote");
  });
});

/*
  S-80's forward guard.

  §40 asks for external content to be tagged untrusted in the model context. There is no model
  context: lib/generator-adapter.ts is a contract with no concrete adapter, and the Ask route
  calls the excerpt path. Writing a tagging convention for a context that does not exist would
  be a convention nobody has to follow.

  So the boundary is asserted instead, and it is asserted where it will break: the day a concrete
  adapter lands, this fails until whoever landed it decides what marks retrieved document text as
  untrusted in the prompt they wrote.
*/
describe("the untrusted-content boundary", () => {
  const root = resolve(import.meta.dirname, "..");
  const adapter = readFileSync(resolve(root, "lib/generator-adapter.ts"), "utf8");
  const askRoute = readFileSync(resolve(root, "app/api/collections/[id]/ask/route.ts"), "utf8");

  it("has no concrete generator adapter, so no document text reaches a model prompt", () => {
    // A concrete adapter is one that names a provider endpoint. The contract names none.
    expect(adapter).not.toMatch(/https?:\/\/[a-z0-9.-]*(?:openai|anthropic|googleapis|azure)/i);
    expect(adapter).toMatch(/no concrete GeneratorAdapter/i);
  });

  it("keeps the Ask route on the evidence-bound paths, which build citations rather than prose", () => {
    expect(askRoute).toMatch(/answerGroundedQuestion|runRetrievalPipeline/);
    expect(askRoute).not.toMatch(/generateGroundedAnswer/);
  });

  it("never interpolates document text into an instruction string on the answer path", () => {
    const groundedAsk = readFileSync(resolve(root, "lib/grounded-ask.ts"), "utf8");
    // The words a prompt is built out of. Their absence is what makes "no model turn" checkable
    // rather than asserted, and their arrival is the moment the tagging decision is due.
    expect(groundedAsk).not.toMatch(/\bsystem prompt\b|\brole:\s*"system"|You are an? /i);
  });
});
