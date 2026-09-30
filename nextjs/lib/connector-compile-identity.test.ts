import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectorSourceIdentity } from "./connector-source-identity";
import { readConnectorCompileIdentities } from "./connector-compile-identity";
const scope={workspaceKey:"pilot-acme01",connectionId:"22222222-2222-4222-8222-222222222222",provider:"google_drive" as const,nativeId:"native",revision:"1"};
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://binding-test.supabase.co");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY",`sb_secret_${"x".repeat(40)}`);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function binding(revision="1") {const identity=await connectorSourceIdentity({...scope,revision});return {...identity,row:{workspace_key:scope.workspaceKey,oauth_connection_id:scope.connectionId,provider:scope.provider,native_id:scope.nativeId,provider_revision:revision,source_id:identity.sourceId,source_version_id:identity.sourceVersionId,document_id:identity.documentId}};}
it("maps different immutable uploads to the same logical source across separate compiles",async()=>{
  const first=await binding(),next=await binding("2");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json([first.row])).mockResolvedValueOnce(Response.json([next.row])));
  const a=await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId]);
  const b=await readConnectorCompileIdentities(scope.workspaceKey,[next.documentId]);
  expect(first.documentId).not.toBe(next.documentId);
  expect(a.ok && a.identities.get(first.documentId)).toBe(first.sourceId);
  expect(b.ok && b.identities.get(next.documentId)).toBe(first.sourceId);
});
it("refuses two revisions of a logical source in the same selection",async()=>{
  const first=await binding(),next=await binding("2");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json([first.row])).mockResolvedValueOnce(Response.json([next.row])));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId,next.documentId])).toEqual({ok:false,code:"CONNECTOR_SOURCE_REVISION_AMBIGUOUS"});
});
it.each(["workspace_key","document_id","source_id","source_version_id","provider_revision"])("rejects a corrupt %s binding",async field=>{
  const first=await binding();vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json([{...first.row,[field]:"wrong"}])));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).toMatchObject({ok:false});
});
it("fails closed on missing mapping or unavailable store",async()=>{
  const first=await binding();vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(new Response(null,{status:503})));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).toEqual({ok:false,code:"CONNECTOR_IDENTITY_UNRESOLVED"});
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).toEqual({ok:false,code:"CONNECTOR_IDENTITY_UNAVAILABLE"});
});
