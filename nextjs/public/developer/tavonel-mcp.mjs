/**
 * The TAVONEL MCP server: read-only access to a Compiled World, for agents.
 *
 * Masterplan 22.2 asks for this and states the constraint that shapes it: "write/promotion은
 * browser session과 human gate로 유지한다." Promotion is the moment a candidate becomes the World
 * an organisation answers from, and it stays behind a person in a browser. So this server has no
 * write tool, and it cannot grow one by accident -- every tool declares the request it makes, and
 * `assertReadOnly` refuses to start if any of them is not a read.
 *
 *   TAVONEL_API_KEY=tvnl_live_... node tavonel-mcp.mjs
 *   TAVONEL_BASE_URL=https://tavonel.com           (default)
 *   node tavonel-mcp.mjs --version                 (record the exact build before registering it)
 *   node tavonel-mcp.mjs --doctor                  (check the key, the channel and one real read)
 *   TAVONEL_CONSUMER_CONTEXT='{...}'               (optional; needs consumer-context.mjs beside this file)
 *   TAVONEL_CONSUMER_CONTEXT_REQUIRED=true         (every tool call fails closed without a usable context)
 *
 * Consumer-context enforcement is local synthetic evidence only, not production API support: the
 * production API does not acknowledge the context headers. With no context and the required flag
 * unset, blank or false, consumer-context.mjs is not loaded and nothing about this server changes.
 *
 * Transport is stdio with newline-delimited JSON-RPC 2.0, which is what the MCP stdio transport
 * specifies, so this needs no dependency and no build step. It is a file you can read before
 * pointing an agent at your own knowledge.
 *
 * `list_worlds` arrived in this release. It was absent for a real reason -- the API had no
 * endpoint that listed a workspace's collections, and a tool that guessed at ids would be a tool
 * that lies when it is wrong -- and it is present now because that endpoint exists
 * (GET /api/v1/collections). It lists only ACTIVE Worlds: a candidate nobody promoted is not
 * organizational truth, and a discovery list that mixed the two would hand an agent a set in
 * which some entries are authoritative and some are not.
 *
 * What it deliberately does not offer:
 *
 *   download_package returns a descriptor -- url, size, manifest digest, signing key id -- and
 *   not the archive. Base64ing up to 64 MiB through a pipe to hand back bytes the caller must
 *   verify anyway is worse than telling them exactly what to fetch and what it should hash to.
 *
 * No file is written, no shell is run, and the only network destination is the configured API
 * base. A document is hostile data; so is a tool argument.
 */

import { createHash } from "node:crypto";

/**
 * Kept equal to `lib/api-version.ts` by `lib/mcp-server.test.ts`.
 *
 * The server reports the contract version it speaks, and this file cannot import a TypeScript
 * constant, so the test is what stops the two from drifting.
 */
export const SERVER_VERSION = "2026-09-02.1";
export const PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_BASE_URL = "https://tavonel.com";

/**
 * The published distribution version, pinned by sha256 in `channel.json`.
 *
 * Separate from `SERVER_VERSION`, which is the API contract this speaks. A rebuild that changes
 * these bytes changes this; a change to what the API answers changes that.
 */
export const DISTRIBUTION_VERSION = "2026.10.2.1";
export const API_VERSION_HEADER = "1";

const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const STABLE_ID = /^[a-z-]+-[a-f0-9]{32}$/;
const MAX_QUERY = 500;
const SEARCH_LIMIT_MAX = 25;
const PAGE_LIMIT_MAX = 50;

const collectionProperty = {
  type: "string",
  pattern: "^collection-[a-f0-9]{32}$",
  description: "The Compiled World to read. Collection ids are content-derived and stable.",
};

/**
 * One pagination idiom for the whole surface.
 *
 * `search_world` follows the API retrieval bound of 1 to 25. Lens and discovery pagination use
 * 1 to 50, and the lens tools previously had no bound at all:
 * they fetched an entire World's objects, relations or evidence in one response and filtered
 * client-side. Reusing these two properties -- rather than inventing a second convention for the
 * lenses -- is what keeps "how do I page this" a question with one answer (audit X06).
 *
 * Omitting `limit` still returns the whole lens, because defaulting to a page would silently
 * truncate a by-id lookup into NOT_FOUND for anything past the first page.
 */
const limitProperty = { type: "integer", minimum: 1, maximum: PAGE_LIMIT_MAX };
const cursorProperty = {
  type: "string",
  description: "The last id from the previous page. Requires limit. Keyset, not an offset.",
};

/** Adds the page parameters to a lens GET only when the caller actually asked for a page. */
function lensPath(collectionId, lens, input) {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  const suffix = query.size > 0 ? `?${query}` : "";
  return `/api/v1/world/${collectionId}/${lens}${suffix}`;
}

/* ------------------------------------------------------------- delivery format */

/**
 * The compiled context in a form a consumer AI can read in full.
 *
 * The machine format is JSON, and it stays JSON. What an agent *reads* is a different question,
 * and the GDP.pdf v3 diagnosis answered it with a measurement: the packet was one line of JSON,
 * the subject's Read tool returns at most 25,000 tokens and cannot page a single line, so the
 * agent saw the first ~50,000 characters -- 1,666 of 4,851 items (34.3%) -- and about half of
 * what it saw was ids and keys rather than text (hard-proof-20261027
 * research/beat-baseline/DIAGNOSIS.md §0.2-0.3). This is the product copy of the v4 research arm
 * `compiled_v4_delivery` (research/gdp_pdf_v4_20261027/render.py, PROTOCOL-v4.md §3-4):
 *
 *   - items in page order (source, page, top edge, left edge, packet position), never rank order;
 *   - one item per line, `[p<page>.u<n> ev=<evidence ids>] <text>`, the item's own line breaks
 *     written as ` ⏎ `, so every line of a part starts with a header the source text cannot forge;
 *   - the evidence ids stay in the header: they are what an answer cites and what get_evidence
 *     resolves to a source version, page and region, so provenance survives the rendering;
 *   - lines are packed into numbered parts whose conservative token estimate stays under a budget
 *     derived from the measured Read ceiling, an item is never split, and a manifest names every
 *     part with its sha256 and item range.
 *
 * Nothing is truncated. An item that alone exceeds the budget, an id that would break a header, or
 * a text that already contains the line-break marker is refused with a DELIVERY_* error: a packet
 * that cannot be delivered whole is not delivered at all. The v4 arm itself was NOT_SUPPORTED as a
 * quality claim (REPORT-v4.md). This exists because a reader that sees a third of its context is a
 * delivery defect whatever a benchmark says, not because a benchmark said it wins.
 */

/** The subject CLI's Read cap, measured on Claude Code 2.1.311 with synthetic files (PROTOCOL-v4.md §3). */
export const DELIVERY_READ_CEILING_TOKENS = 25_000;
/**
 * The per-part budget, in `estimateTokens` units. On the three calibration files the estimate was
 * 1.118x to 1.400x the tool's own count, so 22,000 is at most ~19,680 tool tokens; the worst-case
 * density file at this size (est 21,839) came back whole in one Read.
 */
export const DELIVERY_PART_BUDGET_TOKENS = 22_000;
export const DELIVERY_FORMAT = "tavonel.context_delivery.v1";
const DELIVERY_MARKER = "\u23ce";
const DELIVERY_LINE_BREAK = ` ${DELIVERY_MARKER} `;
// An evidence id sits inside the item header, so it may not carry a space, a comma or a bracket;
// a source version id has a line of its own and only has to stay one token on one line.
const DELIVERY_EVIDENCE_ID = /^[^\s,\[\]]{1,200}$/u;
const DELIVERY_SOURCE_ID = /^[^\s]{1,500}$/u;
// Every line boundary Python's str.splitlines() honours, so a consumer that splits a part that
// way cannot see a header at the start of a line either (\x1c-\x1e are the file, group and
// record separators).
const DELIVERY_SPLIT = /\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/;
const DELIVERY_EST = /\s+|[A-Za-z]+|[0-9]|[^\sA-Za-z0-9]/gu;
const DELIVERY_ANCHOR = /^\[p([0-9]+|\?)\.u([0-9]+) ev=[^\]\s]+\] /;
const DELIVERY_ENCODER = new TextEncoder();

export class DeliveryError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "DeliveryError";
    this.code = code;
  }
}

/**
 * Conservative token estimate (render.py `est_tokens`): an ASCII letter run costs one per three
 * letters, every digit and ASCII symbol one, a whitespace run one unless a letter follows. A
 * non-ASCII character costs its UTF-8 byte length -- stricter than the v4 arm, whose calibration
 * files were ASCII only, and an upper bound for a byte-level tokenizer.
 */
export function estimateTokens(text) {
  let total = 0;
  for (const match of text.matchAll(DELIVERY_EST)) {
    const run = match[0];
    if (/^\s/u.test(run)) {
      total += /[A-Za-z]/.test(text.charAt(match.index + run.length)) ? 0 : 1;
    } else if (/^[A-Za-z]+$/.test(run)) {
      total += Math.ceil(run.length / 3);
    } else {
      total += run.codePointAt(0) < 0x80 ? 1 : DELIVERY_ENCODER.encode(run).length;
    }
  }
  return total;
}

function deliverySha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function deliveryOneLine(text) {
  if (text.includes(DELIVERY_MARKER)) {
    throw new DeliveryError("DELIVERY_TEXT_HAS_MARKER", "a text already contains the line-break marker U+23CE");
  }
  return text.split(DELIVERY_SPLIT).map((line) => line.trim()).filter(Boolean).join(DELIVERY_LINE_BREAK);
}

function deliveryUnit(value, index) {
  const unit = object(value) ? value : {};
  const evidenceIds = Array.isArray(unit.evidenceIds) ? unit.evidenceIds : null;
  const page = unit.pageNumber1 ?? null;
  const bbox = unit.bbox1000 ?? null;
  if (
    typeof unit.unitId !== "string" || typeof unit.text !== "string" ||
    typeof unit.sourceVersionId !== "string" || !DELIVERY_SOURCE_ID.test(unit.sourceVersionId) ||
    !evidenceIds || evidenceIds.length === 0 ||
    !evidenceIds.every((id) => typeof id === "string" && DELIVERY_EVIDENCE_ID.test(id)) ||
    !(page === null || (Number.isInteger(page) && page >= 1)) ||
    !(bbox === null || (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)))
  ) {
    throw new DeliveryError(
      "DELIVERY_ITEM_INVALID",
      `item ${index + 1} has no usable text, source version, evidence id, page or region`,
    );
  }
  return { index, text: unit.text, sourceVersionId: unit.sourceVersionId, evidenceIds, page, bbox };
}

/** Source in order of first appearance, then page (unknown last), top edge, left edge, input position. */
function deliveryOrder(units) {
  const sourceRank = new Map();
  for (const unit of units) if (!sourceRank.has(unit.sourceVersionId)) sourceRank.set(unit.sourceVersionId, sourceRank.size);
  const key = (unit) => [
    sourceRank.get(unit.sourceVersionId),
    unit.page ?? Number.MAX_SAFE_INTEGER,
    unit.bbox ? unit.bbox[1] : Number.MAX_SAFE_INTEGER,
    unit.bbox ? unit.bbox[0] : Number.MAX_SAFE_INTEGER,
    unit.index,
  ];
  return [...units].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
}

/**
 * Render evidence-bound units into a manifest and numbered parts.
 *
 * `units` are ContextPacket items or package chunks: `{ unitId, text, sourceVersionId,
 * evidenceIds, pageNumber1, bbox1000 }`. `heading` lines open the manifest (world, question);
 * `notices` are lines it must carry rather than drop (held conflicts, abstention reasons).
 * Returns `{ format, itemCount, manifest, parts }`, plus `indexes` when the part list does not fit
 * the manifest; every file is `{ name, text, sha256, estTokens }`.
 *
 * @param {unknown[]} units
 * @param {{ heading?: string[], notices?: string[], machineFormat?: string, budget?: number }} [options]
 */
export function renderDelivery(units, {
  heading = [],
  notices = [],
  machineFormat = "the JSON response",
  budget = DELIVERY_PART_BUDGET_TOKENS,
} = {}) {
  if (!Array.isArray(units)) throw new DeliveryError("DELIVERY_PACKET_INVALID", "the packet has no item list");
  const ordered = deliveryOrder(units.map(deliveryUnit));
  const sourceLabel = new Map();
  for (const unit of ordered) {
    if (!sourceLabel.has(unit.sourceVersionId)) sourceLabel.set(unit.sourceVersionId, `s${sourceLabel.size + 1}`);
  }
  const lines = ordered.map((unit, k) => {
    const page = unit.page === null ? "?" : String(unit.page);
    const text = `[p${page}.u${k + 1} ev=${unit.evidenceIds.join(",")}] ${deliveryOneLine(unit.text)}`;
    return { source: unit.sourceVersionId, page, k: k + 1, text };
  });

  const groups = [];
  let current = null;
  for (const line of lines) {
    const sourceLine = `## ${sourceLabel.get(line.source)} source ${line.source}`;
    const alone = estimateTokens(`${sourceLine}\n${line.text}\n`);
    if (alone > budget) {
      throw new DeliveryError(
        "DELIVERY_ITEM_OVER_PART_BUDGET",
        `u${line.k} alone is ${alone} estimated tokens, over the ${budget} part budget; an item is never split`,
      );
    }
    const cost = estimateTokens(`${line.text}\n`) + (current?.source === line.source ? 0 : estimateTokens(`${sourceLine}\n`));
    if (!current || current.used + cost > budget) {
      current = { lines: [], used: 0, source: null, first: line, last: line };
      groups.push(current);
    }
    if (current.source !== line.source) {
      current.lines.push(sourceLine);
      current.used += estimateTokens(`${sourceLine}\n`);
      current.source = line.source;
    }
    current.lines.push(line.text);
    current.used += estimateTokens(`${line.text}\n`);
    current.last = line;
  }

  const width = Math.max(3, String(groups.length).length);
  const parts = groups.map((group, i) => {
    const name = `part-${String(i + 1).padStart(width, "0")}.txt`;
    const text = `${group.lines.join("\n")}\n`;
    const estTokens = estimateTokens(text);
    // The packing above already keeps this true; the file actually written is what is checked.
    if (estTokens > budget) throw new DeliveryError("DELIVERY_PART_OVER_BUDGET", `${name} is ${estTokens} estimated tokens`);
    const items = group.lines.filter((line) => DELIVERY_ANCHOR.test(line)).length;
    return { name, text, sha256: deliverySha256(text), estTokens, items, first: group.first, last: group.last };
  });
  const delivered = parts.reduce((sum, part) => sum + part.items, 0);
  if (delivered !== units.length) {
    throw new DeliveryError("DELIVERY_ITEM_COUNT_MISMATCH", `${delivered} of ${units.length} items reached a part`);
  }

  const head = [
    `TAVONEL compiled context, delivery format ${DELIVERY_FORMAT}.`,
    ...heading.map((line) => deliveryOneLine(String(line))),
    `${units.length} item(s) in ${parts.length} part(s), in page order. Read every part; each one fits in a single read.`,
    `One item per line: [p<page>.u<item> ev=<evidence ids>] text. ${DELIVERY_MARKER} is a line break inside the item; p? means the item has no page.`,
    "Cite the evidence ids in the header: each resolves to a source version, page and region. A '## sN source <id>' line names the source of the lines under it.",
    `The machine-readable form of the same items is ${machineFormat}.`,
    ...notices.map((line) => deliveryOneLine(String(line))),
  ];
  const partLines = parts.map((part) =>
    `${part.name}  items u${part.first.k}-u${part.last.k}  pages ${part.first.page}-${part.last.page}  ` +
    `${part.items} item(s)  est_tokens ${part.estTokens}  ${part.sha256}`);
  let manifestText = `${[...head, ...partLines].join("\n")}\n`;
  /*
    A manifest that names every part stops fitting one read at roughly 270 parts (about 6 M
    estimated tokens of text: an 18 MB English World, or a 6 MB Korean one). Past that the part
    list moves into numbered index files, each within the part budget and each named here with
    its sha256, so every part is still reachable from the manifest by digest. Below it the output
    is byte-identical to what it always was.
  */
  const indexes = [];
  if (estimateTokens(manifestText) > budget) {
    let lines = [];
    let used = 0;
    let first = 1;
    const flush = (last) => {
      const text = `${lines.join("\n")}\n`;
      indexes.push({ name: "", text, sha256: deliverySha256(text), estTokens: estimateTokens(text), first, last });
      lines = []; used = 0; first = last + 1;
    };
    partLines.forEach((line, i) => {
      const cost = estimateTokens(`${line}\n`);
      if (lines.length && used + cost > budget) flush(i);
      lines.push(line); used += cost;
    });
    flush(partLines.length);
    const indexWidth = Math.max(3, String(indexes.length).length);
    indexes.forEach((index, i) => { index.name = `index-${String(i + 1).padStart(indexWidth, "0")}.txt`; });
    manifestText = `${[...head,
      `The ${parts.length} parts are listed in ${indexes.length} index file(s), with each part's sha256. Read every index, then every part it names.`,
      ...indexes.map((index) => `${index.name}  parts ${index.first}-${index.last}  est_tokens ${index.estTokens}  ${index.sha256}`),
    ].join("\n")}\n`;
  }
  const manifestTokens = estimateTokens(manifestText);
  if (manifestTokens > budget) {
    throw new DeliveryError("DELIVERY_MANIFEST_OVER_BUDGET", `the manifest is ${manifestTokens} estimated tokens`);
  }
  return {
    format: DELIVERY_FORMAT,
    itemCount: units.length,
    manifest: { name: "manifest.txt", text: manifestText, sha256: deliverySha256(manifestText), estTokens: manifestTokens },
    parts: parts.map(({ name, text, sha256, estTokens, items }) => ({ name, text, sha256, estTokens, items })),
    ...(indexes.length ? { indexes: indexes.map(({ name, text, sha256, estTokens }) => ({ name, text, sha256, estTokens })) } : {}),
  };
}

/** The delivery rendering of a ContextPacket -- the `contextPacket` that /search returns. */
export function renderContextPacketDelivery(packet, options = {}) {
  if (!object(packet)) throw new DeliveryError("DELIVERY_PACKET_INVALID", "the response carries no context packet");
  const held = Array.isArray(packet.heldConflicts) ? packet.heldConflicts : [];
  const abstained = Array.isArray(packet.abstentionReasons) ? packet.abstentionReasons : [];
  return renderDelivery(packet.items, {
    heading: [
      `World ${String(packet.worldId)} version ${String(packet.worldVersion)}, retrieval profile ${String(packet.retrievalProfile)}.`,
      `Question: ${String(packet.question)}`,
    ],
    notices: [
      ...held.map((conflict) =>
        `Held conflict, not resolved: claims ${(Array.isArray(conflict?.claimIds) ? conflict.claimIds : []).join(", ")} -- ${String(conflict?.reason ?? "")}`),
      ...abstained.map((reason) => `Abstention reason: ${String(reason)}`),
    ],
    ...options,
  });
}

/**
 * Every tool, and the exact request it makes.
 *
 * The request lives in the table rather than inside each handler so that "does this server
 * write?" is a question about data, answerable by reading twenty lines, instead of a question
 * about control flow.
 */
export const TOOLS = [
  {
    name: "list_sources",
    description: "The documents in the workspace, with their processing state and version key.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    request: () => ({ method: "GET", path: "/api/v1/documents" }),
  },
  {
    name: "list_worlds",
    description:
      "The workspace's active Compiled Worlds, newest promotions included, with each one's " +
      "manifest digest and revision. Start here when you do not already hold a collection id. " +
      "Candidates nobody promoted are not listed: they are not what this workspace answers from.",
    inputSchema: {
      type: "object",
      properties: { limit: limitProperty, cursor: cursorProperty },
      additionalProperties: false,
    },
    request: (input) => {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set("limit", String(input.limit));
      if (input.cursor !== undefined) query.set("cursor", input.cursor);
      return { method: "GET", path: `/api/v1/collections${query.size > 0 ? `?${query}` : ""}` };
    },
  },
  {
    name: "get_world",
    description:
      "One Compiled World: its status, contract, freshness, objects, relations, evidence and " +
      "history. Use list_worlds first if you do not have a collection id.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/api/v1/world/${input.collectionId}` }),
  },
  {
    name: "search_world",
    description:
      "Retrieved regions with their provenance and ranks, and no generated prose. Use this when " +
      "the agent will decide for itself; use ask_world when it wants an answer. The text result " +
      "is the delivery format: a manifest, then every region in page order, one per line, each " +
      "headed by its page and evidence ids. The full JSON response is the structured content.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        query: { type: "string", minLength: 3, maxLength: MAX_QUERY },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX },
      },
      required: ["collectionId", "query"],
      additionalProperties: false,
    },
    request: (input) => ({
      method: "POST",
      path: `/api/v1/collections/${input.collectionId}/search`,
      body: input.limit === undefined ? { query: input.query } : { query: input.query, limit: input.limit },
    }),
    deliver: (payload) => renderContextPacketDelivery(payload.contextPacket, {
      machineFormat: "this tool result's structured content (contextPacket)",
    }),
  },
  {
    name: "ask_world",
    description:
      "A grounded answer with its citations, or an abstention. The World abstains rather than " +
      "answering from outside its sources, and the abstention is the useful reply.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        question: { type: "string", minLength: 3, maxLength: MAX_QUERY },
      },
      required: ["collectionId", "question"],
      additionalProperties: false,
    },
    request: (input) => ({
      method: "POST",
      path: `/api/v1/collections/${input.collectionId}/ask`,
      body: { question: input.question },
    }),
  },
  {
    name: "get_object",
    description:
      "The objects lens. Pass objectId to return one object, or limit and cursor to walk a " +
      "large World a page at a time instead of fetching every object at once.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        objectId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "objects", input) }),
    select: (payload, input) => selectById(payload, "objects", input.objectId),
  },
  {
    name: "get_relation",
    description:
      "The relations lens. Pass relationId to return one relation, or limit and cursor to walk " +
      "the graph a page at a time.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        relationId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "relations", input) }),
    select: (payload, input) => selectById(payload, "relations", input.relationId),
  },
  {
    name: "get_evidence",
    description:
      "The evidence lens: every region with its source version, page and bbox in the 0-1000 " +
      "page frame. Pass evidenceId to return one region, or limit and cursor to page.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: collectionProperty,
        evidenceId: { type: "string", pattern: STABLE_ID.source },
        limit: limitProperty,
        cursor: cursorProperty,
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: lensPath(input.collectionId, "evidence", input) }),
    select: (payload, input) => selectById(payload, "evidence", input.evidenceId),
  },
  {
    name: "download_package",
    description:
      "Where the signed Compiled World Package is, how large it is, and what its signed manifest " +
      "hashes to. The archive itself is fetched over HTTP with the same key and checked with " +
      "tavonel-verify-export.mjs; the bytes do not travel through this transport.",
    inputSchema: {
      type: "object",
      properties: { collectionId: collectionProperty },
      required: ["collectionId"],
      additionalProperties: false,
    },
    request: (input) => ({ method: "GET", path: `/api/v1/collections/${input.collectionId}/download`, headersOnly: true }),
  },
];

/**
 * The gate that keeps 22.2's constraint true as the file grows.
 *
 * A GET is a read. A POST is a read only where the endpoint's own contract says so -- /search and
 * /ask take a body because a question does not fit in a URL, not because they change anything.
 * Any other write, and the server refuses to start rather than exposing it.
 */
const READ_ONLY_POSTS = new Set(["search", "ask"]);

export function assertReadOnly(tools = TOOLS) {
  const sample = { collectionId: `collection-${"0".repeat(32)}`, query: "sample query", question: "sample question" };
  for (const tool of tools) {
    const request = tool.request(sample);
    if (request.method === "GET") continue;
    const tail = request.path.split("/").pop();
    if (request.method === "POST" && READ_ONLY_POSTS.has(tail)) continue;
    throw new Error(`MCP_WRITE_TOOL_REFUSED: ${tool.name} makes a ${request.method} to ${request.path}`);
  }
  return true;
}

function selectById(payload, key, id) {
  if (!id) return payload;
  const items = Array.isArray(payload?.[key]) ? payload[key] : [];
  const found = items.find((item) => item?.id === id);
  if (!found) throw new Error(`NOT_FOUND: no ${key.replace(/s$/, "")} ${id} in this World`);
  return { ...payload, [key]: [found] };
}

/** Argument validation, before anything reaches the network. */
export function validateInput(tool, input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const schema = tool.inputSchema;
  for (const key of Object.keys(value)) {
    if (!schema.properties[key]) throw new Error(`INPUT_INVALID: ${tool.name} has no argument "${key}"`);
  }
  for (const key of schema.required ?? []) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`INPUT_INVALID: ${tool.name} requires ${key}`);
    }
  }
  if (typeof value.collectionId === "string" && !COLLECTION_ID.test(value.collectionId)) {
    // The id goes into a path. A value that is not a collection id has no business being there,
    // whoever put it in the argument.
    throw new Error("INPUT_INVALID: collectionId is not a collection id");
  }
  for (const key of ["objectId", "relationId", "evidenceId"]) {
    if (value[key] !== undefined && !STABLE_ID.test(String(value[key]))) {
      throw new Error(`INPUT_INVALID: ${key} is not a stable id`);
    }
  }
  for (const key of ["query", "question"]) {
    const text = value[key];
    if (text === undefined) continue;
    const normalized = String(text).normalize("NFKC").replace(/\s+/g, " ").trim();
    if (normalized.length < 3 || String(text).length > MAX_QUERY) {
      throw new Error(`INPUT_INVALID: ${key} must be 3 to ${MAX_QUERY} characters`);
    }
  }
  const limitMax = tool.name === "search_world" ? SEARCH_LIMIT_MAX : PAGE_LIMIT_MAX;
  if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > limitMax)) {
    throw new Error(`INPUT_INVALID: limit must be an integer from 1 to ${limitMax}`);
  }
  if (value.cursor !== undefined) {
    // A cursor is an id the previous page handed back, and it goes into a query string. The
    // pattern is what an id can be -- an evidence cursor is `<evidenceId>:<blockId>` -- and
    // nothing that could carry another parameter or a path segment into the request.
    if (typeof value.cursor !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.cursor)) {
      throw new Error("INPUT_INVALID: cursor is not a page cursor");
    }
    if (value.limit === undefined) throw new Error("INPUT_INVALID: cursor requires limit");
  }
  for (const key of ["objectId", "relationId", "evidenceId"]) {
    // Selecting one item happens after the response arrives, so a paged request plus an id
    // would report NOT_FOUND for an item sitting on a later page. Refused rather than answered
    // wrongly: ask for the id, or walk the pages, not both.
    if (value[key] !== undefined && (value.limit !== undefined || value.cursor !== undefined)) {
      throw new Error(`INPUT_INVALID: ${key} cannot be combined with limit or cursor`);
    }
  }
  return value;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the stable success envelope before an agent can treat a 2xx body as product data.
 * Additive fields remain allowed; these are the required fields published in OpenAPI.
 */
export function validateSuccess(tool, payload) {
  const name = tool.name;
  const valid = object(payload) && (
    (name === "list_sources" && Array.isArray(payload.documents)) ||
    (name === "list_worlds" && payload.code === "COLLECTIONS_LISTED" && Array.isArray(payload.collections)) ||
    (name === "get_world" && payload.code === "OK" && object(payload.model)) ||
    (name === "search_world" && ["SEARCH_RESULTS", "SEARCH_EMPTY"].includes(payload.code) && payload.retrievalPath === "compiled-retrieval-v1" && object(payload.contextPacket) && Array.isArray(payload.degradations) && object(payload.activeWorld)) ||
    (name === "ask_world" && ["GROUNDED_ANSWER", "ANSWER_ABSTAINED"].includes(payload.code) && typeof payload.answer === "string" && Array.isArray(payload.citations) && typeof payload.retrievalPath === "string" && object(payload.activeWorld)) ||
    (name === "get_object" && payload.code === "OK" && Array.isArray(payload.objects)) ||
    (name === "get_relation" && payload.code === "OK" && Array.isArray(payload.relations)) ||
    (name === "get_evidence" && payload.code === "OK" && Array.isArray(payload.evidence)) ||
    name === "download_package"
  );
  if (!valid) throw new Error(`API_SUCCESS_SCHEMA_INVALID: ${name}`);
  return payload;
}

/**
 * The consumer-context binding from `consumer-context.mjs`, or null when none is configured.
 *
 * Imported only for a nonblank context or a required flag that is neither blank nor false (trimmed,
 * any case) -- the module's own rule, so an invalid flag still loads it to be refused -- and the
 * legacy server stays a single file. A configured context that cannot be loaded becomes a binding
 * that refuses every call -- the operator asked for a boundary, and answering without it would be
 * the wrong failure.
 */
export async function loadConsumerContext(env = process.env) {
  const flag = String(env.TAVONEL_CONSUMER_CONTEXT_REQUIRED ?? "").trim().toLowerCase();
  const configured = String(env.TAVONEL_CONSUMER_CONTEXT ?? "").trim() !== "" || (flag !== "" && flag !== "false");
  if (!configured) return null;
  try {
    const module = await import(new URL("./consumer-context.mjs", import.meta.url).href);
    return module.createConsumerContextBinding({ env });
  } catch {
    const refusal = new Error("CONSUMER_CONTEXT_MODULE_UNAVAILABLE: consumer-context.mjs must sit beside tavonel-mcp.mjs");
    const refuse = () => { throw refusal; };
    return Object.freeze({ required: true, context: null, error: refusal, identity: null, prepare: refuse, verify: refuse });
  }
}

export function createClient({ baseUrl, apiKey, fetcher = fetch, context = null }) {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return async function call(request) {
    /*
      The key is checked here rather than at startup. An MCP client initializes and lists tools
      before a person has finished configuring it, and a server that refuses to start without a
      credential looks broken at exactly the moment someone is setting it up.
    */
    if (!apiKey) throw new Error("API_KEY_MISSING: set TAVONEL_API_KEY to a key from your workspace");
    // The same rule for a required consumer context: checked per call, refused before the network.
    const contextHeaders = context ? context.prepare(request) : {};
    const response = await fetcher(`${base}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        // The published media type. The API answers a version, and a mismatch is caught below.
        accept: "application/vnd.tavonel.v1+json",
        ...(request.body ? { "content-type": "application/json" } : {}),
        ...contextHeaders,
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    if (request.headersOnly) {
      // A package can be tens of megabytes. Read what identifies it and drop the stream.
      const descriptor = {
        url: `${base}${request.path}`,
        status: response.status,
        sizeBytes: Number(response.headers.get("content-length") ?? "0"),
        manifestSha256: response.headers.get("x-tavonel-export-manifest-sha256"),
        signingKeyId: response.headers.get("x-tavonel-export-key-id"),
        candidatePromotion: response.headers.get("x-tavonel-candidate-promotion"),
        verifyWith: "node tavonel-verify-export.mjs --archive <file> --trusted-fingerprint sha256:<64 hex>",
      };
      await response.body?.cancel?.();
      if (!response.ok) throw new Error(`API_ERROR_${response.status}`);
      if (context) context.verify(request, response);
      return descriptor;
    }
    const text = await response.text();
    let payload;
    try {
      payload = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      throw new Error(`API_RESPONSE_UNREADABLE_${response.status}`);
    }
    if (!response.ok) {
      // The API's own code, not a paraphrase: the agent's next decision depends on which one.
      throw new Error(`API_ERROR_${response.status}: ${payload.code ?? "UNKNOWN"}`);
    }
    const served = response.headers.get("x-tavonel-api-version");
    if (served && served !== API_VERSION_HEADER) {
      // A newer contract may have moved a field this client reads. Stopping is the safe answer.
      throw new Error(`API_VERSION_UNSUPPORTED: served v${served}, this client speaks v${API_VERSION_HEADER}`);
    }
    if (context) context.verify(request, response);
    return payload;
  };
}

export function createServer({ call }) {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  async function callTool(name, input) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`TOOL_NOT_FOUND: ${name}`);
    const value = validateInput(tool, input);
    const payload = validateSuccess(tool, await call(tool.request(value)));
    return { tool, result: tool.select ? tool.select(payload, value) : payload };
  }

  /*
    What the agent reads. For a tool with a delivery rendering that is the manifest and every part,
    one text block each, and the JSON goes in structuredContent for a client that parses it. A tool
    result is read in one piece, so the whole delivery has to fit one part budget; a result that
    does not is refused with the reason rather than cut (lower `limit`).
  */
  function toolContent(tool, result) {
    if (!tool.deliver) return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    const delivery = tool.deliver(result);
    const files = [delivery.manifest, ...(delivery.indexes ?? []), ...delivery.parts];
    const total = files.reduce((sum, file) => sum + file.estTokens, 0);
    if (total > DELIVERY_PART_BUDGET_TOKENS) {
      throw new DeliveryError(
        "DELIVERY_OVER_TOOL_RESULT_BUDGET",
        `${delivery.itemCount} items are ${total} estimated tokens, over the ${DELIVERY_PART_BUDGET_TOKENS} a single tool result is held to; retry with a lower limit`,
      );
    }
    return { content: files.map((file) => ({ type: "text", text: file.text })), structuredContent: result };
  }

  return async function handle(message) {
    const { id, method, params } = message ?? {};
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "tavonel-readonly", title: "TAVONEL Compiled World", version: DISTRIBUTION_VERSION },
          instructions:
            "Read-only access to a Compiled World. Every answer is bound to a source version, a " +
            "page and a region; an ungrounded question is abstained from rather than answered. " +
            "No tool can upload, compile, promote, roll back, change billing or mutate " +
            "connectors: promotion is the moment a candidate becomes the World an organisation " +
            "answers from, and it stays with a person in a browser.",
        });
      case "notifications/initialized":
        return null;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
          })),
        });
      case "tools/call": {
        try {
          const { tool, result } = await callTool(params?.name, params?.arguments);
          return reply({ ...toolContent(tool, result), isError: false });
        } catch (error) {
          /*
            A failed tool is a result, not a protocol error: the agent has to see what went wrong
            to choose its next step, and a JSON-RPC error would take the message away from it.
          */
          return reply({
            content: [{ type: "text", text: error instanceof Error ? error.message : "TOOL_FAILED" }],
            isError: true,
          });
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
    }
  };
}

/* -------------------------------------------------------------------- doctor */

/**
 * `--doctor`: from "I downloaded the file" to "it reads my knowledge", checked (audit U07).
 *
 * Four checks, in the order they fail in real life: is a key set, does this build match the
 * published channel, does the key authenticate against a real read, and does the workspace
 * actually have an active World to read. Each line is pass or fail plus what to do about it --
 * a diagnostic that prints a stack trace has told the operator nothing.
 *
 * It performs reads only, through the same `TOOLS` table and the same `assertReadOnly` gate the
 * server starts behind, so the doctor cannot reach an endpoint the server itself may not. The
 * authenticated read goes through the same consumer-context binding as a tool call, so a context
 * that would refuse every tool call refuses the doctor's read too, before the network.
 */
export async function runDoctor({ baseUrl = DEFAULT_BASE_URL, apiKey = "", fetcher = fetch, now = () => new Date(), context = null } = {}) {
  assertReadOnly();
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const checks = [];
  const record = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok; };

  if (!record("api_key", Boolean(apiKey), apiKey
    ? "TAVONEL_API_KEY is set"
    : "set TAVONEL_API_KEY to a key from Workspace > Developers")) {
    return { ok: false, checkedAt: now().toISOString(), baseUrl: base, distribution: DISTRIBUTION_VERSION, checks };
  }

  try {
    const response = await fetcher(`${base}/developer/channel.json`, { method: "GET" });
    const channel = response.ok ? await response.json() : null;
    const published = channel?.version ?? null;
    record("distribution_version", published === DISTRIBUTION_VERSION, published === null
      ? `could not read ${base}/developer/channel.json; this build is ${DISTRIBUTION_VERSION}`
      : published === DISTRIBUTION_VERSION
        ? `this build ${DISTRIBUTION_VERSION} matches the published channel`
        : `this build is ${DISTRIBUTION_VERSION}; the channel publishes ${published}. Download the new file and verify its sha256 before replacing this one -- nothing updates itself.`);
  } catch {
    record("distribution_version", false, `could not reach ${base}/developer/channel.json`);
  }

  const call = createClient({ baseUrl: base, apiKey, fetcher, context });
  const listWorlds = TOOLS.find((tool) => tool.name === "list_worlds");
  try {
    const payload = await call(listWorlds.request({ limit: 5 }));
    const collections = Array.isArray(payload?.collections) ? payload.collections : [];
    record("authenticated_read", true, "the key authenticated against GET /api/v1/collections");
    record("active_world", collections.length > 0, collections.length > 0
      ? `${collections.length} active World(s); first is ${collections[0].collectionId}`
      : "no active World in this workspace yet. Compile a collection and have a person promote it -- an API key cannot promote.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const rejected = message.includes("API_ERROR_401") || message.includes("API_ERROR_403");
    // A 404 here is not a bad key: it is a deployment that predates GET /api/v1/collections.
    // Saying "the key was rejected" would send the operator to rotate a credential that works.
    const absent = message.includes("404");
    record("authenticated_read", false,
      rejected
        ? `${message} -- the key was rejected. Check it is not revoked and that it holds the collections:read scope.`
        : absent
          ? `${message} -- ${base} has no /api/v1/collections endpoint. That deployment predates world discovery; the key is not the problem.`
          : message);
    record("active_world", false, "not checked: the authenticated read did not succeed");
  }

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: now().toISOString(),
    baseUrl: base,
    distribution: DISTRIBUTION_VERSION,
    checks,
  };
}

export function formatDoctor(report) {
  const lines = report.checks.map((check) => `${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  return [
    `tavonel-mcp ${report.distribution} doctor  ->  ${report.baseUrl}`,
    ...lines,
    report.ok ? "All checks passed. Register this file as a stdio MCP server." : "At least one check failed. Fix the first FAIL above and run --doctor again.",
  ].join("\n");
}

/* ------------------------------------------------------------------- process */

async function main() {
  assertReadOnly();
  const context = await loadConsumerContext(process.env);
  const handle = createServer({
    call: createClient({ baseUrl: process.env.TAVONEL_BASE_URL, apiKey: process.env.TAVONEL_API_KEY, context }),
  });

  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        continue;
      }
      const response = await handle(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

if (process.argv.includes("--version")) {
  // Recorded before registration, so a support conversation can start from the exact build.
  process.stdout.write(`tavonel-mcp ${DISTRIBUTION_VERSION} (api v${API_VERSION_HEADER}, contract ${SERVER_VERSION})\n`);
} else if (process.argv.includes("--doctor")) {
  const context = await loadConsumerContext(process.env);
  const report = await runDoctor({ baseUrl: process.env.TAVONEL_BASE_URL, apiKey: process.env.TAVONEL_API_KEY, context });
  process.stdout.write(`${formatDoctor(report)}\n`);
  // A non-zero exit so a setup script, a CI job or a support runbook can branch on it instead
  // of grepping the text.
  process.exitCode = report.ok ? 0 : 1;
} else if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "tavonel-mcp.mjs") {
  await main();
}
