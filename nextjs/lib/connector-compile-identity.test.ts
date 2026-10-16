import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectorSourceIdentity } from "./connector-source-identity";
import { readConnectorCompileIdentities } from "./connector-compile-identity";
const scope={workspaceKey:"pilot-acme01",connectionId:"22222222-2222-4222-8222-222222222222",provider:"google_drive" as const,nativeId:"native",revision:"1"};
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://binding-test.supabase.co");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY",`sb_secret_${"x".repeat(40)}`);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function binding(revision="1",recordedAt=`2026-10-01T00:00:0${revision}.000000+00:00`) {const identity=await connectorSourceIdentity({...scope,revision});return {...identity,row:{workspace_key:scope.workspaceKey,oauth_connection_id:scope.connectionId,provider:scope.provider,native_id:scope.nativeId,provider_revision:revision,source_id:identity.sourceId,source_version_id:identity.sourceVersionId,document_id:identity.documentId,recorded_at:recordedAt}};}
type Row=Awaited<ReturnType<typeof binding>>["row"];
/** Microseconds of an ISO instant, for the stand-in only (the real comparison runs in SQL). */
const micros=(at:string)=>{const m=/.(d{1,6})/.exec(at);return BigInt(Date.parse(at.replace(/.d+/,"")))*1000n+BigInt((m?.[1]??"").padEnd(6,"0"));};
/** A PostgREST stand-in: rows by document_id, and connector_source_newest_versions over the RPC. */
function store(rows:Row[],override?:(url:URL)=>Response|undefined){
  return vi.fn(async(input:string|URL,init?:RequestInit)=>{
    const url=new URL(String(input));const forced=override?.(url);if(forced)return forced;
    if(url.pathname.endsWith("/rpc/connector_source_newest_versions")){
      const {p_workspace_key,p_source_id}=JSON.parse(String(init?.body));
      const scoped=rows.filter(r=>r.workspace_key===p_workspace_key&&r.source_id===p_source_id);
      const top=scoped.reduce<bigint|null>((max,r)=>max===null||micros(r.recorded_at)>max?micros(r.recorded_at):max,null);
      return Response.json(scoped.filter(r=>micros(r.recorded_at)===top).map(r=>r.source_version_id).sort());
    }
    const q=url.searchParams;const eq=(k:string)=>q.get(k)?.replace(/^eq\./,"");
    let hit=rows.filter(r=>r.workspace_key===eq("workspace_key")&&(!q.has("document_id")||r.document_id===eq("document_id"))&&(!q.has("source_id")||r.source_id===eq("source_id")));
    if(q.get("order")==="recorded_at.desc")hit=[...hit].sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    return Response.json(hit.slice(0,Number(q.get("limit")??hit.length)));
  });
}
it("maps different immutable uploads to the same logical source across separate compiles",async()=>{
  const first=await binding(),next=await binding("2");
  vi.stubGlobal("fetch",store([first.row]));
  const a=await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId]);
  vi.stubGlobal("fetch",store([first.row,next.row]));
  const b=await readConnectorCompileIdentities(scope.workspaceKey,[next.documentId]);
  expect(first.documentId).not.toBe(next.documentId);
  expect(a.ok && a.identities.get(first.documentId)).toBe(first.sourceId);
  expect(b.ok && b.identities.get(next.documentId)).toBe(first.sourceId);
});
it("refuses two revisions of a logical source in the same selection",async()=>{
  const first=await binding(),next=await binding("2");
  vi.stubGlobal("fetch",store([first.row,next.row]));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId,next.documentId])).toEqual({ok:false,code:"CONNECTOR_SOURCE_REVISION_AMBIGUOUS"});
});
it("refuses a revision that a later bound revision of the same logical source superseded",async()=>{
  const first=await binding(),next=await binding("2");
  vi.stubGlobal("fetch",store([first.row,next.row]));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).toEqual({ok:false,code:"CONNECTOR_SOURCE_REVISION_SUPERSEDED"});
});
it("uses the database's first observation, not the provider revision string, as the order",async()=>{
  // Provider revision "9" was observed before "10": lexical provider order would pick the wrong one.
  const older=await binding("9","2026-10-01T00:00:01.000000+00:00"),newer=await binding("10","2026-10-01T00:00:02.000000+00:00");
  vi.stubGlobal("fetch",store([older.row,newer.row]));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[older.documentId])).toEqual({ok:false,code:"CONNECTOR_SOURCE_REVISION_SUPERSEDED"});
  const latest=await readConnectorCompileIdentities(scope.workspaceKey,[newer.documentId]);
  expect(latest.ok && latest.identities.get(newer.documentId)).toBe(newer.sourceId);
});
it("refuses two revisions first observed at the same instant instead of tie-breaking by id",async()=>{
  const at="2026-10-01T00:00:05.000000+00:00";const first=await binding("1",at),next=await binding("2",at);
  vi.stubGlobal("fetch",store([first.row,next.row]));
  for(const documentId of [first.documentId,next.documentId])
    expect(await readConnectorCompileIdentities(scope.workspaceKey,[documentId])).toEqual({ok:false,code:"CONNECTOR_SOURCE_REVISION_AMBIGUOUS"});
});
it("does not treat a same-native revision in another workspace as a newer revision",async()=>{
  const first=await binding(),foreign={...(await binding("2")).row,workspace_key:"pilot-other01"};
  vi.stubGlobal("fetch",store([first.row,foreign]));
  const result=await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId]);
  expect(result.ok && result.identities.get(first.documentId)).toBe(first.sourceId);
});
it.each([
  ["an unavailable newest read",()=>new Response(null,{status:503}),"CONNECTOR_IDENTITY_UNAVAILABLE"],
  ["an empty newest set",()=>Response.json([]),"CONNECTOR_IDENTITY_UNRESOLVED"],
  ["an unresolved newest tie",()=>Response.json([`sv-${"1".repeat(64)}`,`sv-${"2".repeat(64)}`]),"CONNECTOR_SOURCE_REVISION_AMBIGUOUS"],
  ["a malformed version id",()=>Response.json(["sv-x"]),"CONNECTOR_IDENTITY_UNAVAILABLE"],
  ["a duplicated version id",()=>Response.json([`sv-${"1".repeat(64)}`,`sv-${"1".repeat(64)}`]),"CONNECTOR_IDENTITY_UNAVAILABLE"],
  ["an object body",()=>Response.json({}),"CONNECTOR_IDENTITY_UNAVAILABLE"],
] as const)("fails closed on %s",async(_label,respond,code)=>{
  const first=await binding();
  vi.stubGlobal("fetch",store([first.row],url=>url.pathname.endsWith("/rpc/connector_source_newest_versions")?respond():undefined));
  expect(await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).toEqual({ok:false,code});
});
it("asks the database for the scoped newest set rather than ordering rows itself",async()=>{
  const first=await binding();const fetcher=store([first.row]);vi.stubGlobal("fetch",fetcher);
  expect((await readConnectorCompileIdentities(scope.workspaceKey,[first.documentId])).ok).toBe(true);
  const call=fetcher.mock.calls.find(([input])=>String(input).includes("/rpc/connector_source_newest_versions"))!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({p_workspace_key:scope.workspaceKey,p_source_id:first.sourceId});
  expect(fetcher.mock.calls.some(([input])=>String(input).includes("order=recorded_at"))).toBe(false);
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
