import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, PRICE_BOOK_EXTRA } from "./billing-catalog";
import { PRODUCT_NOUNS } from "./site-navigation";
import { CUSTOMER_RUN } from "@/components/v34/routes/connect/connect-sources";

/*
  WO-REL-1, closing round. The class: public text that names a plan outside PB-2026-11-V22, or says a
  named plan can be bought, without reading the catalog. `/docs/quickstart` said "Starter is bought
  online; Pro is arranged with us rather than bought at a checkout." -- neither name is in V22, and the
  sentence was false whatever the price env said.

  The sources are read the way a reader meets them: every string literal, template part and JSX text in
  app/, lib/, components/ and content/ (comments are not public text, so they are not read), plus the
  Markdown, JSON and llms.txt content files. Tests and e2e specs are fixtures, not copy.

  The V22 names come from the catalog (`BILLING_OFFERS` entries that are not retired, and
  `PRICE_BOOK_EXTRA`). The retired names are the retired offer codes' own words (`observer_access` ->
  Observer, `studio_access` -> Studio) and the two customer-facing names of 2026-11-10 that the
  catalog records only in a comment (Starter, Pro). A retired name that is also a product noun
  (Studio, the surface) is held only where a sentence also makes a buy claim.
*/

const ROOT = join(__dirname, "..");
/*
  r4: the /guide videos are public too. Their captions are served as public/guide/*.vtt (built from
  scripts/guide/GUIDE-SCRIPTS.json), and the terminal scenes film scripts/guide/terminal/<session>.json
  verbatim, so a sentence recorded there reaches a public page as pixels. Both directories are read.
  The recorder's own .mjs (locators) is not public text and is not read.
*/
const SCANNED_DIRS = ["app", "lib", "components", "content", "scripts/guide", "public/guide"];
const EXTRA_FILES = ["public/llms.txt"];

const V22_NAMES = new Set<string>([
  ...Object.values(BILLING_OFFERS).filter((offer) => offer.status !== "retired").map((offer) => offer.label),
  ...Object.values(PRICE_BOOK_EXTRA).map((extra) => extra.label),
]);
const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const RETIRED_NAMES = [
  ...Object.entries(BILLING_OFFERS).filter(([, offer]) => offer.status === "retired").map(([code]) => capitalised(code.split("_")[0])),
  "Starter",
  "Pro",
].filter((name) => !V22_NAMES.has(name));
const productNouns = new Set<string>(PRODUCT_NOUNS);
const STRICT_RETIRED = RETIRED_NAMES.filter((name) => !productNouns.has(name));

const BUY_CLAIM =
  /\b(?:bought|buy|buys|buying|purchas(?:e|ed|es|able|ing)|sold online|on sale|checkout|available online|available on|included on|included in|open with|opens with|require|requires|subscribe)\b|구매|구입|결제/i;
const word = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`);

/** Every user-visible string of one source file: literals, template parts and JSX text. Comments are trivia and never reach here. */
function visibleStrings(fileName: string, source: string): string[] {
  /*
    r4: JSON is read decoded, the way a page or a replay prints it. Read raw, an escaped "\nPro" put the
    "n" of the escape before the name, the word boundary never matched, and the name was missed. A file
    that does not parse throws: it fails the scan rather than being skipped.
  */
  if (fileName.endsWith(".json")) {
    const out: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") out.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { out.push(key); collect(inner); }
    };
    collect(JSON.parse(source));
    return out;
  }
  if (!/\.(?:ts|tsx|mts)$/.test(fileName)) return [source];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.replace(/\*\*/g, "").trim()).filter(Boolean);

/** A plan named in this sentence that V22 does not have. A capitalised word only because it opens the sentence is not a name. */
function foreignPlanNames(sentence: string, candidates: readonly string[]): string[] {
  const names = new Set(candidates.filter((name) => word(name).test(sentence)));
  for (const match of sentence.matchAll(/\b([A-Z][A-Za-z]+) (?:plan|plans)\b/g)) {
    if (match.index !== 0 && !V22_NAMES.has(match[1])) names.add(match[1]);
  }
  return [...names];
}

type Hit = { file: string; sentence: string; names: string[]; buy: boolean };

/** The two findings for one file's text: retired names anywhere, and a foreign plan name in a buy claim. */
function findHits(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const text of visibleStrings(file, source)) {
    for (const sentence of sentencesOf(text)) {
      const buy = BUY_CLAIM.test(sentence);
      const names = foreignPlanNames(sentence, buy ? RETIRED_NAMES : STRICT_RETIRED);
      if (names.length) hits.push({ file, sentence, names, buy });
    }
  }
  return hits;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else if (/\.(?:ts|tsx|mts|md|mdx|json|vtt)$/.test(entry.name) && !/\.(?:test|spec|selftest)\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

/*
  Hits that are left, each with its reason: key "path :: the whole sentence", value the reason. None is
  left today -- every hit the sweep found was rewritten (receipts/WO-REL-1/r3-sweep.md). An entry that no
  longer matches anything fails the test too, so this list cannot outlive what it excuses. Whole files
  are never excused: a key is one sentence.
*/
const ALLOWED: Record<string, string> = {};

/*
  Quoted third-party source text, not TAVONEL sentences: the Explore sample's input files hold the
  publisher's filings verbatim (Apple's 10-Q and proxy: "MacBook Pro", "Pro models"). Rewriting them would
  falsify the sample's evidence. Only this exact file family is skipped, and it must still exist.
*/
const QUOTED_SOURCE_TEXT = /^lib\/explore-sample\.w\d+\.inputs\.json$/;
const allowed = (hit: Hit) => Object.keys(ALLOWED).find((key) => `${hit.file} :: ${hit.sentence}` === key);

describe("public plan names (WO-REL-1 closing round)", () => {
  it("takes its names from the catalog", () => {
    expect([...V22_NAMES].sort()).toEqual(["Business", "Developer", "Enterprise", "Free", "Personal", "Team"]);
    expect(RETIRED_NAMES).toEqual(expect.arrayContaining(["Observer", "Studio", "Starter", "Pro"]));
    expect(STRICT_RETIRED, "Studio is a product noun, so it is held only in a buy claim").not.toContain("Studio");
  });

  it("fails the sentence /docs/quickstart published, and passes its replacement", () => {
    const old = `const s = { text: "Branch on those three codes. Starter is bought online; Pro is arranged with us rather than bought at a checkout. That is the plan gate." };`;
    expect(findHits("lib/docs-content.ts", old).map((hit) => hit.names)).toEqual([["Starter", "Pro"]]);
    for (const sentence of [
      "API keys and MCP setup require Starter or Pro.",
      "Once it is open, the Observer plan can be bought online.",
      "The Launch plan is sold online.",
      "Studio is bought online.",
      "Pro 플랜은 바로 구매할 수 있습니다.",
    ]) expect(findHits("x.ts", JSON.stringify(sentence)), sentence).not.toEqual([]);
    for (const sentence of [
      "The pricing page shows for each plan whether it can be bought online or is arranged with us.",
      "Team is not sold online today.",
      "Every plan is bought from the pricing page.",
      "Open Studio from the workspace.",
      "// Starter is bought online",
    ]) expect(findHits("x.ts", sentence.startsWith("//") ? sentence : JSON.stringify(sentence)), sentence).toEqual([]);
  });

  it("reads a recorded terminal capture the way its replay prints it, at every position a name can sit", () => {
    // The shape of scripts/guide/terminal/<session>.json: CLI stdout, itself JSON, stored as an escaped string.
    const capture = (stdout: string) => JSON.stringify({ steps: [{ command: "node tavonel-cli.mjs status", stdout }] }, null, 2);
    for (const name of ["Starter", "Pro", "Observer"]) {
      for (const stdout of [
        `{\n  "reason": "${name} can be bought online."\n}\n`,
        `${name}\n`,
        `x\n${name} plan\n`,
        `"${name}"`,
        `\t${name}\r\n`,
      ]) expect(findHits("scripts/guide/terminal/api.json", capture(stdout)).flatMap((hit) => hit.names), JSON.stringify(stdout)).toContain(name);
    }
    expect(findHits("scripts/guide/terminal/api.json", capture('{\n  "reason": "Purchasing does not enable customer document processing today."\n}\n'))).toEqual([]);
    expect(() => findHits("scripts/guide/terminal/api.json", "{ not json")).toThrow();
  });

  it("finds no retired plan name, and no foreign plan name in a buy claim, in any public content source", () => {
    const files = [...SCANNED_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]), ...EXTRA_FILES.map((file) => join(ROOT, file))];
    expect(files.length, "the scan reached the sources").toBeGreaterThan(500);
    const named = files.map((path) => ({ path, file: relative(ROOT, path).split(sep).join("/") }));
    const reached = new Set(named.map(({ file }) => file));
    for (const guideFile of ["scripts/guide/GUIDE-SCRIPTS.json", "scripts/guide/terminal/api.json", "scripts/guide/terminal/mcp.json", "public/guide/guide-3-api-desktop.en.vtt"]) {
      expect(reached.has(guideFile), `the scan reached ${guideFile}`).toBe(true);
    }
    expect(named.filter(({ file }) => QUOTED_SOURCE_TEXT.test(file)).length, "the quoted-source exception names files that exist").toBeGreaterThan(0);
    const hits = named.filter(({ file }) => !QUOTED_SOURCE_TEXT.test(file)).flatMap(({ path, file }) => findHits(file, readFileSync(path, "utf8")));
    const unexcused = hits.filter((hit) => !allowed(hit)).map((hit) => `${hit.file} :: ${hit.sentence} [${hit.names.join(", ")}]`);
    expect(unexcused).toEqual([]);
    const used = new Set(hits.map(allowed));
    expect(Object.keys(ALLOWED).filter((key) => !used.has(key)), "an allow-list entry that excuses nothing").toEqual([]);
  }, 60_000); // parses every source file: ~5 s alone, longer beside other suites
});

/*
  WO-REL-4. The class: a public sentence that offers a way in the product refuses or has switched off.
  /connect and the workspace Connections panel offered SMB, NFS and SFTP mounts and macOS, which the
  import agent refuses before it lists anything (U1, U5); /connect, /solutions, /personal, the route
  metadata and llms.txt promised PKCE sign-in, a URL or any MCP client while the remote MCP endpoint,
  the only path that has any of them, is switched off (U3, U4, U9).

  Neither list is typed here. What the agent refuses is its own runbook's sentence that names it
  (public/developer/source-agent-operations.md, shipped beside the script), anchored to the refusal
  codes the script raises. The remote markers are the remote endpoint's own: the sign-in method
  lib/remote-mcp.ts refuses an authorization without, and the path its route file answers on.

  A file whose remote-MCP text is rendered only behind the switch (it reads remoteMcpEnabled, the
  workspace's RemoteMcpAvailability or the connect page's remoteOpen) is checked by rendering it
  switched off, not by reading it: the connect page in routes-connect.test.ts, the Connect AI panel in
  connect-ai-panel.test.ts, /docs/mcp in docs-content.test.ts. Its refused-transport text is not
  switched and is still read here. The remote endpoint's own files answer 404 while it is off, and API
  and security records are not page text.
*/
const AGENT_SCRIPT = readFileSync(join(ROOT, "public/developer/tavonel-source-agent.py"), "utf8");
const AGENT_RUNBOOK = readFileSync(join(ROOT, "public/developer/source-agent-operations.md"), "utf8");
const REMOTE_MCP_MODULE = readFileSync(join(ROOT, "lib/remote-mcp.ts"), "utf8");

/** The ways in the agent refuses, from its runbook: "...; SMB, NFS and SFTP mounts, other file systems and macOS are refused before anything is listed". */
function refusedByAgent(runbook: string): string[] {
  const clause = /;\s*([^;.]+?) are refused before anything is listed/.exec(runbook)?.[1];
  if (!clause) throw new Error("the agent runbook no longer names what the agent refuses");
  // Each item's proper name: "SFTP mounts" -> SFTP; "other file systems" names no system and gives no token.
  return clause.split(/,\s*|\s+and\s+/).map((item) => item.trim().split(/\s+/)[0]!).filter((name) => /[A-Z]/.test(name));
}

/** The Windows file systems the agent accepts, from the script's own allowlist. */
function windowsFileSystemsAccepted(script: string): string[] {
  const set = /SUPPORTED_FILESYSTEMS = frozenset\(\{([^}]*)\}\)/.exec(script)?.[1];
  if (!set) throw new Error("the agent script no longer declares SUPPORTED_FILESYSTEMS");
  return [...set.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** The sign-in method the remote endpoint refuses an authorization without, read from its refusal. */
function remoteSignIn(module: string): string {
  const method = /"(\w+) with code_challenge_method=S256 is required\."/.exec(module)?.[1];
  if (!method) throw new Error("lib/remote-mcp.ts no longer names the sign-in method it requires");
  return method;
}
const REMOTE_PATH_SEGMENTS = ["api", "mcp"];
const REMOTE_PATH = `/${REMOTE_PATH_SEGMENTS.join("/")}`;
/** A sentence about how a source gets in: a refused name in any other sentence (a sha256 command "on macOS") is not an offer. */
const CONNECTOR_CONTEXT = /\b(?:agent|mount(?:ed|s)?|share|folder|file[- ]server|connections?|connectors?|import)\b/i;

type Claim = { file: string; sentence: string; why: string };

/** The two findings for one file's text: a refused way in offered as a source, and a remote-MCP way in named as page text. */
function capabilityClaims(file: string, source: string, refused: readonly string[], signIn: string): Claim[] {
  const claims: Claim[] = [];
  for (const text of visibleStrings(file, source)) {
    for (const sentence of sentencesOf(text)) {
      const names = refused.filter((name) => word(name).test(sentence));
      // A protocol (SMB, NFS, SFTP) is an offer wherever it is named; a platform (macOS) only where a source gets in.
      if (names.some((name) => /^[A-Z]+$/.test(name)) || (names.length && CONNECTOR_CONTEXT.test(sentence))) claims.push({ file, sentence, why: `the import agent refuses ${names.join(", ")}` });
      const mcp = /\bMCP\b/.test(sentence);
      if (mcp && word(signIn).test(sentence)) claims.push({ file, sentence, why: `${signIn} is the switched-off remote endpoint's sign-in` });
      else if (sentence.includes(REMOTE_PATH)) claims.push({ file, sentence, why: `${REMOTE_PATH} is the switched-off remote endpoint` });
      else if (mcp && /\bURL\b/.test(sentence)) claims.push({ file, sentence, why: "a URL is the switched-off remote endpoint's transport" });
      else if (/\bany\b[^.]{0,20}\bMCP client/i.test(sentence)) claims.push({ file, sentence, why: "a client that attaches only by URL has no way in while the remote endpoint is off" });
    }
  }
  return claims;
}

/** Files whose remote-MCP text sits behind the switch, by what they read. */
const SWITCHED = /\bremoteMcpEnabled\(|\bRemoteMcpAvailability\b|\bremoteOpen\b/;
/** The remote endpoint itself (404 while off), the API's own documents and the security records: not page text. */
const NOT_PAGE_TEXT = /^(?:app\/api\/|app\/oauth\/|app\/\.well-known\/|lib\/remote-mcp[\w-]*\.ts$|lib\/security\/)/;

/*
  Sentences left, each with its reason, under the rules of ALLOWED above: a key is one sentence, and a
  key that matches nothing fails. The sweep and the reason for each are in receipts/WO-REL-4.
*/
const CLAIMS_LEFT: Record<string, string> = {
  "lib/api-error-codes.ts :: The token is a remote MCP connection's (`tvnl_mcp_`): it works only through the MCP endpoint, /api/mcp, never against the REST API directly.":
    "the meaning of an error code (/docs/errors) that only a remote MCP token can produce; it explains a refusal and offers nothing",
  "lib/changelog.ts :: /docs/mcp has a section on the remote MCP endpoint, for clients that connect by URL instead of launching a local process, such as ChatGPT connectors and other web agents: how to connect, the OAuth flow step by step and the read-only scopes a connection gets.":
    "a dated changelog entry whose title says the endpoint is switched off on tavonel.com; a published history record is not rewritten",
};

describe("public capability claims (WO-REL-4)", () => {
  it("takes the refused list from the agent and the remote markers from the remote endpoint", () => {
    expect(refusedByAgent(AGENT_RUNBOOK)).toEqual(["SMB", "NFS", "SFTP", "macOS"]);
    expect(AGENT_SCRIPT).toContain('raise UnsupportedSafeTraversal("remote_volume")');
    expect(AGENT_SCRIPT).toContain('raise UnsupportedSafeTraversal("platform_not_supported")');
    expect(() => refusedByAgent("The agent reads everything.")).toThrow();
    expect(remoteSignIn(REMOTE_MCP_MODULE)).toBe("PKCE");
    expect(() => remoteSignIn("export {};")).toThrow();
    expect(existsSync(join(ROOT, "app", ...REMOTE_PATH_SEGMENTS, "route.ts")), `${REMOTE_PATH} is the remote endpoint's route`).toBe(true);
    expect(REMOTE_MCP_MODULE).toContain('env.TAVONEL_REMOTE_MCP_ENABLED === "true"');
  });

  it("fails each sentence the audit found, and passes its replacement", () => {
    const refused = refusedByAgent(AGENT_RUNBOOK);
    const signIn = remoteSignIn(REMOTE_MCP_MODULE);
    const hits = (sentence: string) => capabilityClaims("x.ts", `const s = ${JSON.stringify(sentence)};`, refused, signIn);
    for (const old of [
      "Read an SMB, NFS or SFTP-backed mounted directory through your own import agent.",
      "Mounted SMB / NFS / SFTP share",
      "Mount the share with Windows, macOS, Linux, or an SFTP filesystem.",
      "Configuration steps for reading a World from an MCP client over stdio or through the HTTP API, with PKCE sign-in and read-only tools.",
      "Read a World from code with read-only MCP tools, authorize with PKCE, manage API keys and call the HTTP API.",
      "Any MCP client can read the World, and you can revoke its API key whenever you like.",
      "One URL for any MCP client that signs in with OAuth.",
      "Add the MCP server at https://tavonel.com/api/mcp.",
      "Works with your NFS server.",
      "Connect a folder from macOS.",
    ]) expect(hits(old), old).not.toEqual([]);
    for (const ok of [
      CUSTOMER_RUN.find(([name]) => name === "Local folder")![1],
      "Configuration steps for reading a World from an MCP client through a local stdio server or the HTTP API, with an API key and read-only tools.",
      "An MCP client that runs the local server reads the World with an API key from a paid plan, and you can revoke that key whenever you like.",
      "Compute its sha256: shasum -a 256 on macOS, certutil on Windows.",
      "The authorization is single-use and PKCE, and it fails closed.",
    ]) expect(hits(ok), ok).toEqual([]);
  });

  it("names the agent's own Windows file systems where it offers a local folder", () => {
    const row = CUSTOMER_RUN.find(([name]) => name === "Local folder");
    expect(row, "the connector list offers a local folder").toBeDefined();
    const accepted = windowsFileSystemsAccepted(AGENT_SCRIPT);
    expect(accepted.length).toBeGreaterThan(0);
    for (const fileSystem of accepted) expect(row![1]).toContain(fileSystem);
  });

  it("finds no refused way in and no switched-off remote MCP way in, in any public content source", () => {
    const refused = refusedByAgent(AGENT_RUNBOOK);
    const signIn = remoteSignIn(REMOTE_MCP_MODULE);
    // The developer README is served as it is at /developer/README.md, so its sentences are page text too.
    const files = [...SCANNED_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]), ...[...EXTRA_FILES, "public/developer/README.md"].map((file) => join(ROOT, file))];
    const named = files.map((path) => ({ path, file: relative(ROOT, path).split(sep).join("/") }));
    for (const reached of ["public/developer/README.md", "lib/v34/routes.ts", "components/v34/routes/connect/connect-sources.ts", "components/connections-panel.tsx", "app/workspace/page.tsx", "lib/billing-catalog.ts", "public/llms.txt"]) {
      expect(named.some(({ file }) => file === reached), `the scan reached ${reached}`).toBe(true);
    }
    const claims = named
      .filter(({ file }) => !QUOTED_SOURCE_TEXT.test(file) && !NOT_PAGE_TEXT.test(file))
      .flatMap(({ path, file }) => {
        const source = readFileSync(path, "utf8");
        const found = capabilityClaims(file, source, refused, signIn);
        return SWITCHED.test(source) ? found.filter((claim) => claim.why.startsWith("the import agent")) : found;
      });
    const key = (claim: Claim) => `${claim.file} :: ${claim.sentence}`;
    expect(claims.filter((claim) => !(key(claim) in CLAIMS_LEFT)).map((claim) => `${key(claim)} [${claim.why}]`)).toEqual([]);
    const used = new Set(claims.map(key));
    expect(Object.keys(CLAIMS_LEFT).filter((entry) => !used.has(entry)), "a left sentence that matches nothing").toEqual([]);
  }, 60_000);
});
