import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContextPacket, type RankedRetrievalUnit } from "./context-packet";
import { answerFromContextPacket, answerGroundedQuestion, EVIDENCE_EXCEEDS_ANSWER_LIMIT as ANSWER_REASON } from "./grounded-ask";
import type { WorldEvidence } from "./world-read-model";
import { askAbstentionCopy, askSourceCopy, EVIDENCE_EXCEEDS_ANSWER_LIMIT, qualifyAskWorldModel, resolveCitationRegion, type AskCitationSource } from "./workspace-ask-copy";

const helper = readFileSync(new URL("./workspace-ask-copy.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

const NO_EVIDENCE_NOTICE = "The active world abstained because no region-bound evidence matched the question.";
const NO_EVIDENCE_RESULT = "No region-bound evidence matched this question.";

function overflowingArtifact() {
  const row = {
    chunkId: "chunk-a",
    logicalId: "logical-a",
    text: `Renewal clause ${"-".repeat(2000)}`,
    sourceId: "source-a",
    sourceVersionId: "version-a",
    evidenceId: "evidence-a",
    pageNumber1: 4,
    bbox1000: [10, 20, 900, 800],
    authority: "official",
  };
  return {
    collectionId: `collection-${"a".repeat(32)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    package: { files: [{ path: "rag/chunks.jsonl", content: `${JSON.stringify(row)}\n` }] },
  };
}

describe("workspace Ask abstention copy", () => {
  it("shares the overflow reason code with the answer builders without importing them", () => {
    expect(EVIDENCE_EXCEEDS_ANSWER_LIMIT).toBe(ANSWER_REASON);
    // grounded-ask.ts pulls in node:crypto; the client copy must not.
    expect(helper).not.toMatch(/from\s+["'][^"']*grounded-ask/);
    expect(helper).not.toMatch(/from\s+["']node:/);
  });

  it("says in English that evidence exists but is too long, shows no partial answer, and points at sources or a narrower question", () => {
    for (const languages of [[], ["en-US"], ["fr-FR", "ko-KR"]]) {
      const copy = askAbstentionCopy(EVIDENCE_EXCEEDS_ANSWER_LIMIT, languages);
      for (const text of [copy.notice, copy.result]) {
        expect(text).toContain("too long");
        expect(text).toContain("no partial answer is shown");
        expect(text).toContain("source region");
        expect(text).toContain("narrower question");
        expect(text).not.toContain("no region-bound evidence");
        expect(text).not.toMatch(/add the source|correct answer|benchmark/i);
        // Not every cited region can be opened; the copy must not promise it.
        expect(text).not.toMatch(/open the verified source regions|every cited|all cited/i);
      }
      expect(copy.notice).toContain("marked unavailable");
      expect(copy.result).toContain("where one is available");
      expect(copy.action).toBe("Ask a narrower question");
    }
  });

  it("says the same in Korean when the browser prefers Korean", () => {
    for (const languages of [["ko"], ["ko-KR", "en-US"], ["KO-kr"]]) {
      const copy = askAbstentionCopy(EVIDENCE_EXCEEDS_ANSWER_LIMIT, languages);
      for (const text of [copy.notice, copy.result]) {
        expect(text).toContain("너무 길어");
        expect(text).toContain("일부만 잘라낸 답변은 표시하지 않습니다");
        expect(text).toContain("원문 영역");
        expect(text).toContain("더 좁은 질문");
        expect(text).not.toMatch(/소스를 추가|정답|벤치마크/);
        expect(text).not.toContain("검증된 원문 영역을 열어");
      }
      expect(copy.notice).toContain("열 수 없음으로 표시됩니다");
      expect(copy.result).toContain("열 수 있는 인용 원문 영역이 있으면");
      expect(copy.action).toBe("더 좁은 질문하기");
    }
  });

  it("leaves every other abstention on its existing English copy, in any browser language", () => {
    for (const reason of [null, "NO_REGION_BOUND_EVIDENCE_MATCH", "CITED_EVIDENCE_NOT_IN_PACKET", "every candidate was rejected by the World Gate"])
      for (const languages of [[], ["ko-KR"]])
        expect(askAbstentionCopy(reason, languages)).toEqual({ notice: NO_EVIDENCE_NOTICE, result: NO_EVIDENCE_RESULT, action: null });
  });

  it("matches what the fallback builder returns on overflow, citations included", () => {
    const result = answerGroundedQuestion(overflowingArtifact(), "renewal clause");
    expect(result).toMatchObject({ status: "abstained", answer: "", reason: EVIDENCE_EXCEEDS_ANSWER_LIMIT });
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]).toMatchObject({ evidenceId: "evidence-a", sourceId: "source-a", pageNumber1: 4 });
    expect(askAbstentionCopy(result!.reason, ["ko-KR"]).action).toBe("더 좁은 질문하기");
  });

  /*
    Static source facts, not a render: the page is not mounted here, and none of this qualifies
    ACL or a full browser flow. It pins the wiring the overflow branch relies on -- the copy is
    reason-aware in the notice and the result, the no-evidence actions are unchanged, and the
    source buttons are drawn from citations whatever the status.
  */
  it("wires the copy into the workspace without moving the source buttons under a status check", () => {
    expect(workspace).toContain('from "@/lib/workspace-ask-copy"');
    expect(workspace).not.toContain('from "@/lib/grounded-ask"');
    expect(workspace).toContain("askAbstentionCopy(json.reason, navigator.languages).notice");
    expect(workspace).toContain("askAbstentionCopy(askResult.reason, navigator.languages).result");
    expect(workspace).toContain('askResult.reason === EVIDENCE_EXCEEDS_ANSWER_LIMIT');
    expect(workspace).toContain("Add the source that would answer this");
    expect(workspace).toContain("Check what is waiting for review");

    const list = workspace.indexOf("{askResult.citations.length > 0 ? (");
    const button = workspace.indexOf(">Open source region</button>", list);
    const actions = workspace.indexOf('askResult.status === "abstained"', list);
    expect(list).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(list);
    expect(actions).toBeGreaterThan(button);
    const sourceList = workspace.slice(list, button);
    expect(sourceList).not.toContain("status ===");

    // One strict resolver, against the answering World's qualified read model, feeds both availability and the click.
    expect(workspace).toContain('qualifyAskWorldModel, resolveCitationRegion } from "@/lib/workspace-ask-copy"');
    expect(workspace.split("resolveCitationRegion(")).toHaveLength(2);
    expect(sourceList).toContain("const regionId = resolveCitationRegion(citation, askWorldModel?.evidence);");
    expect(sourceList).not.toContain("worldReadModel");
    expect(sourceList).toContain("onClick={() => { if (regionId !== null) setAskEvidenceId(regionId); }}");
    expect(sourceList).toContain("disabled={regionId === null}");
    // The legacy authorities are gone: bare evidence id, sourceId+page, prefix matching.
    expect(sourceList).not.toContain("worldReadModel?.evidence.some(");
    expect(sourceList).not.toContain("worldReadModel?.evidence.find(");
    expect(sourceList).not.toContain("item.sourceId === citation.sourceId");
    expect(sourceList).not.toContain("item.page === citation.pageNumber1");
    expect(sourceList).not.toContain("startsWith(");
    // Null page/box render a marker instead of crashing; relevance is shown only when sent.
    expect(sourceList).toContain("Page {citation.pageNumber1 ?? sourceCopy.missing}");
    expect(sourceList).toContain("citation.bbox1000 ? `[${citation.bbox1000.join(\", \")}]` : sourceCopy.missing");
    expect(workspace).not.toContain("[{citation.bbox1000.join(");
    expect(sourceList).toContain("citation.relevanceBreakdown && citation.relevance !== undefined");
    // An unresolved citation says so, in the browser language, right under its disabled button.
    // Same-World refusal keeps its region copy; an unqualified World says identity, not absence.
    const unavailable = workspace.indexOf("{regionId === null ? <small>{askWorldModel ? sourceCopy.unavailable : sourceCopy.unverified}</small> : null}", button);
    expect(unavailable).toBeGreaterThan(button);
    expect(actions).toBeGreaterThan(unavailable);
    expect(sourceList).toContain("const sourceCopy = askSourceCopy(navigator.languages);");
  });
});

/*
  The resolver, fed the builders' real output: an actual answerFromContextPacket overflow result
  and actual answerGroundedQuestion results, never hand-written citations. Active evidence is
  synthetic but built the way world-read-model.ts builds it: id `${evidenceId}:${chunkId}` and
  blockId = chunkId.
*/
const BOX: [number, number, number, number] = [10, 20, 900, 800];
const OTHER_BOX: [number, number, number, number] = [10, 820, 900, 990];

function region(evidenceId: string, blockId: string, overrides: Partial<WorldEvidence> = {}): WorldEvidence {
  return {
    id: `${evidenceId}:${blockId}`,
    sourceId: "source-a",
    sourceVersionId: "version-a",
    page: 4,
    bbox: [...BOX],
    blockId,
    excerpt: "Renewal clause",
    authority: "official",
    digest: `sha256:${"c".repeat(64)}`,
    ...overrides,
  };
}

function packetUnit(overrides: Partial<RankedRetrievalUnit> & { unitId: string }): RankedRetrievalUnit {
  return {
    text: `Renewal clause ${"-".repeat(5000)}`,
    claimIds: ["claim-a"],
    entityIds: ["entity-a"],
    sourceVersionId: "version-a",
    evidenceIds: ["evidence-a"],
    pageNumber1: 4,
    bbox1000: [...BOX],
    authority: "official",
    lexicalRank: 1,
    ...overrides,
  };
}

function compiledOverflow(units: RankedRetrievalUnit[]) {
  const packet = buildContextPacket(units, {
    worldId: `collection-${"a".repeat(32)}`,
    worldVersion: `sha256:${"b".repeat(64)}`,
    retrievalProfile: "bge-m3-v1",
    question: "renewal clause",
  });
  const answer = answerFromContextPacket(packet, { collectionId: packet.worldId, manifestDigest: packet.worldVersion });
  expect(answer).toMatchObject({ status: "abstained", answer: "", reason: EVIDENCE_EXCEEDS_ANSWER_LIMIT });
  expect(answer.citations).toHaveLength(units.length);
  return answer;
}

function groundedArtifact(rows: Array<Record<string, unknown>>) {
  return {
    collectionId: `collection-${"a".repeat(32)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    package: { files: [{ path: "rag/chunks.jsonl", content: rows.map((row) => JSON.stringify(row)).join("\n") }] },
  };
}

const ROW = {
  chunkId: "chunk-a",
  logicalId: "logical-a",
  text: "Renewal clause: the agreement renews every March.",
  sourceId: "source-a",
  sourceVersionId: "version-a",
  evidenceId: "evidence-a",
  pageNumber1: 4,
  bbox1000: BOX,
  authority: "official",
};

describe("resolving a cited source region against the active read model", () => {
  it("opens a sourceId-less compiled overflow citation only through its exact composite region", () => {
    // Two evidence ids on the unit: only the primary one is a binding, never the second.
    const answer = compiledOverflow([packetUnit({ unitId: "u1", evidenceIds: ["evidence-a", "evidence-b"] })]);
    const [citation] = answer.citations;
    expect(citation).not.toHaveProperty("sourceId");
    expect(citation).not.toHaveProperty("relevance");
    const before = structuredClone(answer);
    const evidence = [
      region("evidence-b", "chunk-b"), // same version/page/box, wrong evidence id
      region("evidence-a", "chunk-z", { page: 5 }), // right evidence, other page
      region("evidence-a", "chunk-a", { sourceId: "product-doc-1" }), // compiled carries no sourceId to compare
    ];
    expect(resolveCitationRegion(citation!, evidence)).toBe("evidence-a:chunk-a");
    // The bare evidence id is not a read-model id, and nothing about it opens anything.
    expect(evidence.some((item) => item.id === citation!.evidenceId)).toBe(false);
    expect(answer).toEqual(before);
  });

  it("keeps geometry-less compiled citations listed, in order, but never openable", () => {
    const answer = compiledOverflow([
      packetUnit({ unitId: "u1", evidenceIds: ["evidence-a"], bbox1000: null }),
      packetUnit({ unitId: "u2", evidenceIds: ["evidence-b"], pageNumber1: null }),
      packetUnit({ unitId: "u3", evidenceIds: ["evidence-c"] }),
    ]);
    expect(answer.citations.map((citation) => citation.unitId)).toEqual(["u1", "u2", "u3"]);
    expect(answer.citations[0]).toMatchObject({ evidenceId: "evidence-a", bbox1000: null, pageNumber1: 4, claimIds: ["claim-a"] });
    expect(answer.citations[1]).toMatchObject({ evidenceId: "evidence-b", bbox1000: BOX, pageNumber1: null });
    const evidence = [region("evidence-a", "chunk-a"), region("evidence-b", "chunk-b"), region("evidence-c", "chunk-c")];
    expect(answer.citations.map((citation) => resolveCitationRegion(citation, evidence))).toEqual([null, null, "evidence-c:chunk-c"]);
  });

  it("opens fallback citations, overflow or grounded, and checks the sourceId they carry", () => {
    const overflow = answerGroundedQuestion(overflowingArtifact(), "renewal clause");
    expect(overflow?.reason).toBe(EVIDENCE_EXCEEDS_ANSWER_LIMIT);
    expect(resolveCitationRegion(overflow!.citations[0]!, [region("evidence-a", "chunk-a")])).toBe("evidence-a:chunk-a");

    const grounded = answerGroundedQuestion(groundedArtifact([ROW]), "renewal clause");
    expect(grounded).toMatchObject({ status: "grounded", reason: null });
    const [citation] = grounded!.citations;
    expect(citation).toMatchObject({ evidenceId: "evidence-a", sourceId: "source-a", sourceVersionId: "version-a", pageNumber1: 4, bbox1000: BOX });
    expect(resolveCitationRegion(citation!, [region("evidence-a", "chunk-a")])).toBe("evidence-a:chunk-a");
    // A supplied sourceId is binding: the same evidence/version/page/box under another source is refused.
    expect(resolveCitationRegion(citation!, [region("evidence-a", "chunk-a", { sourceId: "source-other" })])).toBeNull();
  });

  it("refuses wrong or missing version, page, geometry, evidence and read model", () => {
    const [citation] = compiledOverflow([packetUnit({ unitId: "u1" })]).citations;
    const good = [region("evidence-a", "chunk-a")];
    expect(resolveCitationRegion(citation!, good)).toBe("evidence-a:chunk-a");
    const refused = (overrides: Record<string, unknown>, evidence: WorldEvidence[] = good) =>
      expect(resolveCitationRegion({ ...citation!, ...overrides } as unknown as AskCitationSource, evidence)).toBeNull();

    refused({ sourceVersionId: "version-b" });
    refused({ sourceVersionId: "" });
    refused({ sourceVersionId: undefined });
    refused({ pageNumber1: null });
    refused({ pageNumber1: 5 });
    refused({ pageNumber1: 0 });
    refused({ pageNumber1: 4.5 });
    refused({ pageNumber1: undefined });
    refused({ bbox1000: null });
    refused({ bbox1000: undefined });
    refused({ bbox1000: OTHER_BOX }); // valid but not this region's box
    refused({ bbox1000: [11, 20, 900, 800] }); // one coordinate off
    refused({ evidenceId: "evidence-unknown" });
    refused({ evidenceId: "" });
    refused({ evidenceId: "evidence" }); // a prefix of the real id
    refused({ evidenceId: "evidence-a:chunk-a" }); // the region id itself is not an evidence id
    refused({ sourceId: "source-other" });
    refused({ sourceId: "" });
    refused({ sourceId: null });
    expect(resolveCitationRegion(citation!, null)).toBeNull();
    expect(resolveCitationRegion(citation!, undefined)).toBeNull();
    expect(resolveCitationRegion(citation!, [])).toBeNull();
    // A region that differs only in version (a Core id beside a product id) is not mapped across.
    refused({}, [region("evidence-a", "chunk-a", { sourceVersionId: "dv_version-a" })]);
    refused({}, [region("evidence-a", "chunk-a", { bbox: [...OTHER_BOX] })]);
  });

  it("refuses malformed boxes on either side", () => {
    const [citation] = compiledOverflow([packetUnit({ unitId: "u1" })]).citations;
    const good = [region("evidence-a", "chunk-a")];
    for (const bbox1000 of [
      [10, 20, 900], [10, 20, 900, 800, 0], [-1, 20, 900, 800], [10, 20, 1001, 800], [10.5, 20, 900, 800],
      [Number.NaN, 20, 900, 800], [10, 20, Infinity, 800], ["10", 20, 900, 800], [900, 20, 10, 800], [10, 800, 900, 20],
      [10, 20, 10, 800], "10,20,900,800",
    ]) {
      expect(resolveCitationRegion({ ...citation!, bbox1000 } as unknown as AskCitationSource, good)).toBeNull();
    }
    for (const bbox of [[10, 20, 900], [10, 20, 900, 800, 0], null]) {
      expect(resolveCitationRegion(citation!, [region("evidence-a", "chunk-a", { bbox } as unknown as Partial<WorldEvidence>)])).toBeNull();
    }
  });

  it("selects the right region of two on the same page by exact box, and refuses ambiguous ones", () => {
    const answer = compiledOverflow([
      packetUnit({ unitId: "u1", bbox1000: [...BOX] }),
      packetUnit({ unitId: "u2", bbox1000: [...OTHER_BOX] }),
    ]);
    const samePage = [region("evidence-a", "chunk-top"), region("evidence-a", "chunk-bottom", { bbox: [...OTHER_BOX] })];
    expect(answer.citations.map((citation) => resolveCitationRegion(citation, samePage))).toEqual(["evidence-a:chunk-top", "evidence-a:chunk-bottom"]);

    // Two regions match every field: neither is chosen.
    const twins = [region("evidence-a", "chunk-1"), region("evidence-a", "chunk-2")];
    expect(resolveCitationRegion(answer.citations[0]!, twins)).toBeNull();
    // A matching region whose id another region also carries cannot be opened unambiguously either.
    const sharedId = [region("evidence-a", "chunk-a"), { ...region("evidence-z", "chunk-q"), id: "evidence-a:chunk-a" }];
    expect(resolveCitationRegion(answer.citations[0]!, sharedId)).toBeNull();
  });

  it("binds by full composite equality, never by prefix, a first-colon split or sourceId+page", () => {
    const [citation] = compiledOverflow([packetUnit({ unitId: "u1", evidenceIds: ["ev:1"] })]).citations;
    // Colons are legal in ids; the full string decides.
    expect(resolveCitationRegion(citation!, [region("ev:1", "c")])).toBe("ev:1:c");
    expect(resolveCitationRegion(citation!, [region("ev", "1:c")])).toBeNull();
    // An id that starts with the evidence id but was not built from this blockId is not a match.
    expect(resolveCitationRegion(citation!, [{ ...region("ev:1", "c"), blockId: "d" }])).toBeNull();
    expect(resolveCitationRegion(citation!, [{ ...region("ev:1", "c"), blockId: "", id: "ev:1:" }])).toBeNull();
    // Same source, version, page and box under a different evidence id: the old sourceId+page lookup's hit.
    const [fallback] = answerGroundedQuestion(groundedArtifact([ROW]), "renewal clause")!.citations;
    expect(resolveCitationRegion(fallback!, [region("evidence-other", "chunk-a")])).toBeNull();
  });

  it("never throws on, or resolves to, a null, non-object or sourceId-less read-model row", () => {
    const [citation] = compiledOverflow([packetUnit({ unitId: "u1" })]).citations;
    expect(citation).not.toHaveProperty("sourceId");
    const resolve = (rows: unknown[]) => {
      let result: string | null | undefined;
      expect(() => { result = resolveCitationRegion(citation!, rows as WorldEvidence[]); }).not.toThrow();
      return result;
    };
    const valid = region("evidence-a", "chunk-a");
    const { sourceId: _omitted, ...withoutSourceId } = region("evidence-a", "chunk-a");

    // Junk members are skipped; they neither throw nor block the one valid row.
    const junk = [null, undefined, 42, "evidence-a:chunk-a", true, [], () => "evidence-a:chunk-a"];
    expect(resolve([...junk, valid])).toBe("evidence-a:chunk-a");
    expect(resolve([valid, ...junk])).toBe("evidence-a:chunk-a");
    for (const member of junk) expect(resolve([member])).toBeNull();
    expect(resolve(junk)).toBeNull();

    // A row matching identity, version, page and box but with no usable sourceId of its own is refused,
    // even though the compiled citation carries no sourceId to compare.
    expect(resolve([withoutSourceId])).toBeNull();
    expect(resolve([region("evidence-a", "chunk-a", { sourceId: null } as unknown as Partial<WorldEvidence>)])).toBeNull();
    expect(resolve([region("evidence-a", "chunk-a", { sourceId: "" })])).toBeNull();
    expect(resolve([region("evidence-a", "chunk-a", { sourceId: 7 } as unknown as Partial<WorldEvidence>)])).toBeNull();
    expect(resolve([null, withoutSourceId, undefined])).toBeNull();

    // Another row sharing the resolved id still refuses the open, even when it is itself invalid
    // or differs in every other field.
    expect(resolve([valid, withoutSourceId])).toBeNull();
    expect(resolve([valid, null, { id: "evidence-a:chunk-a" }])).toBeNull();
    expect(resolve([valid, { ...region("evidence-z", "chunk-q", { page: 9, bbox: [...OTHER_BOX], sourceVersionId: "version-z" }), id: "evidence-a:chunk-a" }])).toBeNull();
    // ...while a junk primitive equal to the id string is not a row and does not.
    expect(resolve([valid, "evidence-a:chunk-a"])).toBe("evidence-a:chunk-a");
  });

  it("marks an unopenable source in English or Korean without promising a location", () => {
    for (const languages of [[], ["en-US"], ["fr-FR", "ko-KR"]]) {
      const copy = askSourceCopy(languages);
      expect(copy.unavailable).toContain("cannot be opened");
      expect(copy.unavailable).toContain("no location is guessed");
      expect(copy.missing).toBe("unavailable");
    }
    for (const languages of [["ko"], ["ko-KR", "en-US"], ["KO-kr"]]) {
      const copy = askSourceCopy(languages);
      expect(copy.unavailable).toContain("열 수 없습니다");
      expect(copy.unavailable).toContain("위치를 추측하지 않습니다");
      expect(copy.missing).toBe("정보 없음");
    }
    for (const copy of [askSourceCopy(["en"]), askSourceCopy(["ko"])])
      expect(copy.unavailable).not.toMatch(/correct answer|benchmark|정답|벤치마크/i);
  });

  it("says an unverified World is unverified, not that the region is absent, in English or Korean", () => {
    for (const languages of [[], ["en-US"], ["fr-FR", "ko-KR"]]) {
      const { unverified, unavailable } = askSourceCopy(languages);
      expect(unverified).toContain("cannot be opened here");
      expect(unverified).toContain("not confirmed as the same collection and revision that answered");
      expect(unverified).toContain("still loading");
      expect(unverified).toContain("no location is guessed");
      expect(unverified).not.toMatch(/no single region|has no region|not found|absent/i);
      expect(unverified).not.toBe(unavailable);
    }
    for (const languages of [["ko"], ["ko-KR", "en-US"], ["KO-kr"]]) {
      const { unverified, unavailable } = askSourceCopy(languages);
      expect(unverified).toContain("여기서 열 수 없습니다");
      expect(unverified).toContain("같은 컬렉션·리비전으로 확인되지 않았거나");
      expect(unverified).toContain("아직 불러오는 중");
      expect(unverified).toContain("위치를 추측하지 않습니다");
      expect(unverified).not.toContain("하나로 확인되지 않습니다");
      expect(unverified).not.toBe(unavailable);
    }
    // Equality of identity fields is not authenticity: the copy claims neither a signature nor a forgery.
    for (const copy of [askSourceCopy(["en"]), askSourceCopy(["ko"])])
      expect(copy.unverified).not.toMatch(/signature|tamper|forg|authentic|서명|위조|변조/i);
  });
});

/*
  The World identity boundary in front of the resolver. Ask answers the active World; the
  workspace loads the read model of the selected collection and manifest, which may be a
  candidate. The receipts here are the builders' real ones.
*/
const COLLECTION = `collection-${"a".repeat(32)}`;
const OTHER_COLLECTION = `collection-${"e".repeat(32)}`;
const ACTIVE = `sha256:${"b".repeat(64)}`;
const CANDIDATE = `sha256:${"d".repeat(64)}`;

function worldModel(id: string, manifestDigest: string, evidence: WorldEvidence[] = [region("evidence-a", "chunk-a")]) {
  return {
    schemaVersion: "tavonel.world_read_model.v1" as const,
    world: { id, manifestDigest, status: "active" as const, revision: { state: "read" as const, value: 3 } },
    objects: [],
    relations: [],
    evidence,
    signature: { state: "read" as const, value: "verified" as const },
  };
}

describe("qualifying the loaded World against the answer that cites it", () => {
  const selectedActive = { collectionId: COLLECTION, manifestDigest: ACTIVE };

  it("returns the original, complete model when model, selection and receipt name one World", () => {
    const answer = compiledOverflow([packetUnit({ unitId: "u1" })]);
    expect(answer.receipt).toMatchObject({ collectionId: COLLECTION, manifestDigest: ACTIVE });
    const model = worldModel(COLLECTION, ACTIVE);
    const before = structuredClone(model);
    const qualified = qualifyAskWorldModel(model, selectedActive, answer.receipt);
    expect(qualified).toBe(model);
    expect(qualified).toEqual(before);
    expect(resolveCitationRegion(answer.citations[0]!, qualified?.evidence)).toBe("evidence-a:chunk-a");

    // The fallback builder's real receipt binds the same way.
    const grounded = answerGroundedQuestion(groundedArtifact([ROW]), "renewal clause")!;
    expect(grounded.receipt).toMatchObject({ collectionId: COLLECTION, manifestDigest: ACTIVE });
    expect(qualifyAskWorldModel(model, selectedActive, grounded.receipt)).toBe(model);
    expect(resolveCitationRegion(grounded.citations[0]!, qualifyAskWorldModel(model, selectedActive, grounded.receipt)?.evidence)).toBe("evidence-a:chunk-a");
  });

  it("refuses a selected candidate beside the answering active World, even with an identical source region", () => {
    const answer = compiledOverflow([packetUnit({ unitId: "u1" })]);
    const candidate = worldModel(COLLECTION, CANDIDATE);
    const selectedCandidate = { collectionId: COLLECTION, manifestDigest: CANDIDATE };
    // The region alone would match: identity, not region absence, is what refuses.
    expect(resolveCitationRegion(answer.citations[0]!, candidate.evidence)).toBe("evidence-a:chunk-a");
    expect(qualifyAskWorldModel(candidate, selectedCandidate, answer.receipt)).toBeNull();
    expect(resolveCitationRegion(answer.citations[0]!, qualifyAskWorldModel(candidate, selectedCandidate, answer.receipt)?.evidence)).toBeNull();
    // Any one side disagreeing refuses: old active model while the selection moved to the candidate,
    // candidate model still loaded after the selection returned to active.
    expect(qualifyAskWorldModel(worldModel(COLLECTION, ACTIVE), selectedCandidate, answer.receipt)).toBeNull();
    expect(qualifyAskWorldModel(candidate, selectedActive, answer.receipt)).toBeNull();
    expect(qualifyAskWorldModel(worldModel(COLLECTION, ACTIVE), selectedActive, { ...answer.receipt, manifestDigest: CANDIDATE })).toBeNull();
  });

  it("refuses a wrong collection on any side", () => {
    const { receipt } = compiledOverflow([packetUnit({ unitId: "u1" })]);
    expect(qualifyAskWorldModel(worldModel(OTHER_COLLECTION, ACTIVE), selectedActive, receipt)).toBeNull();
    expect(qualifyAskWorldModel(worldModel(COLLECTION, ACTIVE), { ...selectedActive, collectionId: OTHER_COLLECTION }, receipt)).toBeNull();
    expect(qualifyAskWorldModel(worldModel(COLLECTION, ACTIVE), selectedActive, { ...receipt, collectionId: OTHER_COLLECTION })).toBeNull();
  });

  it("refuses absent, null or malformed identities, identical malformed strings included", () => {
    const { receipt } = compiledOverflow([packetUnit({ unitId: "u1" })]);
    const model = worldModel(COLLECTION, ACTIVE);
    expect(qualifyAskWorldModel(model, selectedActive, receipt)).toBe(model);

    for (const [id, digest] of [
      ["", ACTIVE], [COLLECTION, ""], ["collection-abc", ACTIVE], [COLLECTION.toUpperCase(), ACTIVE],
      [`${COLLECTION} `, ACTIVE], [COLLECTION, `sha256:${"b".repeat(63)}`], [COLLECTION, "b".repeat(64)],
      [COLLECTION, ACTIVE.toUpperCase()], [COLLECTION, `sha256:${"g".repeat(64)}`],
    ] as const) {
      // The same malformed pair everywhere is still not an identity.
      expect(qualifyAskWorldModel(worldModel(id, digest), { collectionId: id, manifestDigest: digest }, { collectionId: id, manifestDigest: digest })).toBeNull();
    }

    // A receipt without collectionId -- the shape the page's old local type described -- binds nothing.
    const { collectionId: _dropped, ...receiptWithoutCollection } = receipt;
    expect(qualifyAskWorldModel(model, selectedActive, receiptWithoutCollection)).toBeNull();
    // Per field: missing, null, non-string, empty, the other field's value, a case variant, and a
    // well-formed value naming another World. None is this World's identity for that field.
    for (const side of [undefined, null, 7, "", ACTIVE, COLLECTION.toUpperCase(), OTHER_COLLECTION]) {
      expect(qualifyAskWorldModel(model, selectedActive, { ...receipt, collectionId: side })).toBeNull();
      expect(qualifyAskWorldModel(model, { ...selectedActive, collectionId: side }, receipt)).toBeNull();
    }
    for (const side of [undefined, null, 7, "", COLLECTION, ACTIVE.toUpperCase(), CANDIDATE]) {
      expect(qualifyAskWorldModel(model, selectedActive, { ...receipt, manifestDigest: side })).toBeNull();
      expect(qualifyAskWorldModel(model, { ...selectedActive, manifestDigest: side }, receipt)).toBeNull();
    }
    const malformedModels: unknown[] = [
      { evidence: model.evidence },
      { world: null, evidence: model.evidence },
      { world: "collection", evidence: model.evidence },
      { world: { id: COLLECTION }, evidence: model.evidence },
      { world: { manifestDigest: ACTIVE }, evidence: model.evidence },
      { world: { id: 7, manifestDigest: ACTIVE }, evidence: model.evidence },
    ];
    for (const malformed of malformedModels)
      expect(qualifyAskWorldModel(malformed as typeof model, selectedActive, receipt)).toBeNull();
    for (const notAnObject of [7, "model", true])
      expect(qualifyAskWorldModel(notAnObject as unknown as typeof model, selectedActive, receipt)).toBeNull();
    for (const notAnObject of [7, "receipt", true]) {
      expect(qualifyAskWorldModel(model, selectedActive, notAnObject as unknown as typeof receipt)).toBeNull();
      expect(qualifyAskWorldModel(model, notAnObject as unknown as typeof selectedActive, receipt)).toBeNull();
    }
  });

  it("refuses while the model is loading or absent, with no selection, and once the answer clears", () => {
    const { receipt } = compiledOverflow([packetUnit({ unitId: "u1" })]);
    const model = worldModel(COLLECTION, ACTIVE);
    expect(qualifyAskWorldModel(null, selectedActive, receipt)).toBeNull();
    expect(qualifyAskWorldModel(undefined, selectedActive, receipt)).toBeNull();
    expect(qualifyAskWorldModel(model, null, receipt)).toBeNull();
    expect(qualifyAskWorldModel(model, undefined, receipt)).toBeNull();
    // `askResult?.receipt` after the answer clears.
    expect(qualifyAskWorldModel(model, selectedActive, null)).toBeNull();
    expect(qualifyAskWorldModel(model, selectedActive, undefined)).toBeNull();
  });

  /*
    Static source facts, not a render or a browser qualification: one qualified model, derived
    from the current model, selection and receipt, feeds both the resolver and the Ask inspector,
    and the inspector mounts only while that model exists -- not on a remembered evidence id alone.
  */
  it("wires one qualified model into the resolver and directly gates the Ask inspector on it", () => {
    expect(workspace).toContain("receipt: { collectionId: string; manifestDigest: string; retrieval: string; outputSha256: string };");
    expect(workspace).toContain("const askWorldModel = qualifyAskWorldModel(worldReadModel, collectionResult, askResult?.receipt);");
    expect(workspace.split("qualifyAskWorldModel(")).toHaveLength(2);
    expect(workspace).toContain("resolveCitationRegion(citation, askWorldModel?.evidence)");
    expect(workspace).toContain('{askWorldModel && askEvidenceId !== undefined ? (\n                  <WorldStudioUltimate model={askWorldModel} initialLens="evidence" selectedEvidenceId={askEvidenceId}');
    expect(workspace).not.toContain("{askEvidenceId !== undefined ? (");
    expect(workspace).not.toContain('<WorldStudioUltimate model={worldReadModel} initialLens="evidence"');
    // A new question also forgets the previously opened region before any answer arrives.
    const ask = workspace.slice(workspace.indexOf("const askActiveWorld = async"), workspace.indexOf("const token = await getAuthToken();", workspace.indexOf("const askActiveWorld = async")));
    expect(ask).toContain("setAskResult(null);\n    setAskEvidenceId(undefined);");
    // The selected read-model load still accepts only the selected identities; no new request flow.
    expect(workspace).toContain("body?.model?.world.id === collectionId && body.model.world.manifestDigest === manifest ? body.model : null");
  });
});
