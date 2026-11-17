import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";
import { recovery } from "@/components/connection-sync-status";
import { apiErrorCode } from "./api-error-codes";
import { failureSentence } from "./workspace-failure-copy";

/*
  WO-CAT-8 item 4: a plan meter's refusal is a plan limit, not a server fault. The catalogue carries
  its status, the OpenAPI document lists it on every operation that can return it, and the customer
  reads a plain sentence with no number in it (the numbers live in lib/billing-catalog.ts).
  The routes' own statuses are tested where the routes are: lib/kqu-meter.test.ts (402 on ask and
  search), lib/intake-approval-rollout-off.test.ts and lib/intake-rollout-compatibility.test.ts (402 on
  both capability paths), lib/sync-worker.test.ts (a full workspace defers a sync).
*/

type Responses = Record<string, { "x-tavonel-error-codes"?: string[] }>;
async function responsesOf(path: string): Promise<Responses> {
  const spec = await (await openApi(new Request("https://tavonel.com/api/openapi"))).json() as {
    paths: Record<string, { post?: { responses: Responses } }>;
  };
  const responses = spec.paths[path]?.post?.responses;
  if (!responses) throw new Error(`no POST ${path} in the document`);
  return responses;
}
const codesAt = (responses: Responses, status: string) => responses[status]?.["x-tavonel-error-codes"] ?? [];

describe("plan meter refusals carry the status of a plan limit", () => {
  it("the catalogue states 402 for both allowances and 503 for an unreadable meter", () => {
    expect(apiErrorCode("KQU_ALLOWANCE_EXHAUSTED").status).toBe(402);
    expect(apiErrorCode("STORAGE_ALLOWANCE_EXHAUSTED").status).toBe(402);
    expect(apiErrorCode("WORKSPACE_SEAT_LIMIT_REACHED").status).toBe(402);
    expect(apiErrorCode("READ_FAILED").status).toBe(503);
  });

  it("the OpenAPI document lists 402 KQU_ALLOWANCE_EXHAUSTED and 503 READ_FAILED on ask and search", async () => {
    for (const path of ["/collections/{id}/ask", "/collections/{id}/search"]) {
      const responses = await responsesOf(path);
      expect(codesAt(responses, "402"), path).toContain("KQU_ALLOWANCE_EXHAUSTED");
      expect(codesAt(responses, "503"), path).toContain("READ_FAILED");
      expect(codesAt(responses, "503"), path).not.toContain("KQU_ALLOWANCE_EXHAUSTED");
    }
  });

  it("the OpenAPI document lists 402 STORAGE_ALLOWANCE_EXHAUSTED on the upload capability, in both of its forms", async () => {
    const served = await responsesOf("/uploads/capability");
    expect(codesAt(served, "402")).toContain("STORAGE_ALLOWANCE_EXHAUSTED");
    expect(codesAt(served, "503")).not.toContain("STORAGE_ALLOWANCE_EXHAUSTED");
    // The approval-lineage operation is served only with that rollout on; its source says the same.
    const source = readFileSync(resolve(import.meta.dirname, "../app/api/openapi/route.ts"), "utf8");
    const lines402 = source.split(/\r?\n/).filter((line) => /"402": err\(/.test(line) && line.includes("STORAGE_ALLOWANCE_EXHAUSTED"));
    expect(lines402).toHaveLength(2);
  });

  it("the customer reads what happened and what to do, with no number that is not the catalogue's", () => {
    for (const code of ["KQU_ALLOWANCE_EXHAUSTED", "STORAGE_ALLOWANCE_EXHAUSTED"]) {
      const sentence = failureSentence(code, 402);
      expect(sentence, code).not.toContain("Reference");
      expect(sentence, code).not.toMatch(/\d/);
    }
    const sync = recovery("STORAGE_ALLOWANCE_EXHAUSTED");
    expect(sync).toMatch(/storage allowance/);
    expect(sync).toMatch(/waiting/);
    expect(sync).not.toMatch(/\d/);
    expect(sync).not.toBe(recovery("SOME_UNKNOWN_IMPORT_FAILURE"));
  });
});
