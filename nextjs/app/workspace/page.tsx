"use client";

import Link from "next/link";
import Logomark from "@/components/logomark";
import WorldExplorer from "@/components/world-explorer";
import { Download, FileText, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { activationPolicy, type ActivationCapability } from "@/lib/activation-policy";
import type { DocumentListItem } from "@/lib/immutable-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useCheckout } from "@/lib/use-checkout";
import { formatCount, formatTimestamp } from "@/lib/format";
import { readOfferParam, takeCheckoutIntent } from "@/lib/checkout-intent";
import { putWithProgress } from "@/lib/upload-transfer";
import {
  estimateBillablePages,
  formatUsd,
  pageCountLabel,
  quoteCompilePages,
  weakestConfidence,
  type PageEstimateConfidence,
} from "@/lib/usage-pricing";
import { collectDroppedWorkspaceFiles, prepareWorkspaceSelection, type WorkspaceSelection, type WorkspaceUploadFile } from "@/lib/workspace-intake";
import { sourceFamilyChips, uploadAcceptAttribute } from "@/lib/qualified-input";
import { runBounded } from "@/lib/concurrent";
import { buildPipeline, type LocalUpload } from "@/lib/pipeline";
import { qualifyProgress, type OcrProgress } from "@/lib/ocr-progress";
import { advanceProgressPoll, type ProgressPollState } from "@/lib/progress-poll";
import PipelineBoard from "@/components/pipeline-board";
import CompileStage from "@/components/compile-stage";
import { displayName, recallDocumentNames, rememberDocumentName, type DocumentNames } from "@/lib/document-names";
import { trackFunnel } from "@/lib/funnel-events";
import ConnectionsPanel from "@/components/connections-panel";
import DeveloperPanel from "@/components/developer-panel";
import WorkspaceUltimateShell, { type WorkspaceSurface } from "@/components/workspace-ultimate-shell";
import WorldStudioUltimate from "@/components/world-studio-ultimate";
import ChangeInbox from "@/components/change-inbox";
import OperationsUltimate from "@/components/operations-ultimate";
import type { WorldReadModel } from "@/lib/world-read-model";
import { compileLimitsNotice, judgeCompileSet } from "@/lib/compile-limits";
import { describeCorpusStart, judgeCorpusSet, type CorpusProgress } from "@/lib/corpus-batching";
import { CompileJobPanel, type CompileJobView } from "@/components/compile-job-panel";
import { observeCompileJob } from "@/lib/compile-job-client";
import { measureSelection, type PageCountResult } from "@/lib/page-count";
import { type ArchiveExpander, createArchiveExpander } from "@/lib/archive-client";
import { ARCHIVE_LIMITS } from "@/lib/archive-expand";
import type { BlockerResolution } from "@/lib/compile-job-store";

/** What this panel prints when it has no value. Not "0", and not a spinner that never resolves. */
const UNKNOWN = "not read yet";

/* Transfers in flight at once. A browser allows about six connections per host, and the capability
   calls and the document poll need slots of their own; past this the extra PUTs queue where nobody
   can see them, which looks exactly like the serial upload this replaced. */
const UPLOAD_CEILING = 3;

const FOUNDATION_PROOF_PDF_URL = "/api/proof-pdf";
const FOUNDATION_PROOF_PDF_SHA256 = "3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4";
const FOUNDATION_COLLECTION_PROOF = [
  { url: "/proof-collection/dart-jtc-page-1.pdf", filename: "dart-jtc-page-1.pdf", sha256: "bbc9bcd5c5c3efce74755e451e04f62ca1ca97402a10908d309ba5645d63751a" },
  { url: "/proof-collection/dart-jtc-page-2.pdf", filename: "dart-jtc-page-2.pdf", sha256: "cbcd0747921a49fc88420521e6d655ddfa0ee7febdc8895f204e61625c933ee6" },
  { url: "/proof-collection/dart-jtc-page-3.pdf", filename: "dart-jtc-page-3.pdf", sha256: "2224c8c1ca8a0057992e1dba2605a7e5184edb22af820ab976ff6d900374ee53" },
] as const;

type CollectionResult = {
  collectionId: string;
  artifactKey: string;
  manifestDigest: string;
  lifecycle: "candidate" | "review_required";
  candidatePromotion: false;
  reviewReasons?: string[];
  sourceDocuments: Array<{ documentId: string }>;
  coreExecution?: {
    status: "completed" | "review_required";
    runtime: string;
    worldStateId?: string;
    receipt: { requestId: string; outputSha256: string; candidatePromotion: false };
  };
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  validation: {
    status: "passed" | "review_required";
    counts: { documents: number; topics: number; entities: number; claims: number; evidence: number; relations: number; packageFiles: number };
  };
};

type ActiveWorld = {
  collectionId: string;
  manifestDigest: string;
  revision: number;
  updatedAt: string;
  candidateObjectKey: string;
  worldStateId: string;
  coreOutputSha256: string;
};

type WorldVersion = {
  manifest_digest: string;
  world_state_id: string;
  lifecycle_status: "active" | "superseded";
  first_promoted_at: string;
  last_activated_at: string;
  activation_count: number;
};

type GroundedAnswer = {
  status: "grounded" | "abstained";
  answer: string;
  reason: string | null;
  citations: Array<{
    evidenceId: string;
    sourceId: string;
    sourceVersionId: string;
    pageNumber1: number;
    bbox1000: [number, number, number, number];
    authority: string;
    authorityTier?: string;
    relevance: number;
    claimIds?: string[];
    entityIds?: string[];
    relevanceBreakdown?: {
      lexical: number;
      graph: number;
      temporal: number;
      authority: number;
    };
    excerpt: string;
  }>;
  receipt: { manifestDigest: string; retrieval: string; outputSha256: string };
};

/*
  One vocabulary with /integrations, which renamed the level it was overstating (RESOLVED A-4).

  "Enterprise" beside "Beta" reads as a higher tier of the same self-serve thing. There is no
  adapter for any of the last four; they are imported by an agent the customer runs, which is
  why the label now says assisted rather than implying a switch that is waiting on a plan.
*/
const WORKSPACE_SOURCE_CHOICES = [
  { name: "Google Drive", availability: "Beta" },
  { name: "Dropbox", availability: "Beta" },
  { name: "OneDrive", availability: "Beta" },
  { name: "File Server", availability: "Enterprise-assisted" },
  { name: "Amazon S3", availability: "Enterprise-assisted" },
  { name: "Cloudflare R2", availability: "Enterprise-assisted" },
  { name: "MinIO", availability: "Enterprise-assisted" },
] as const;

type BillingAccount = {
  accessPlan: string | null;
  subscriptionStatus: string;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string | null;
};

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Human labels for the activation-policy keys, so no camelCase reaches the screen.
 *
 * Typed against `ActivationCapability` rather than left to the `?? key` fallback below: the
 * fallback is what let a new policy key ship to the screen as the literal `customerData`. A key
 * added to `lib/activation-policy.ts` without a label now fails `tsc`, which is the check that
 * catches it before a page renders it.
 */
const GATE_LABELS: Record<ActivationCapability, string> = {
  customerIntake: "Document intake",
  cdr: "Content disarm",
  ocrGpu: "OCR on scans",
  candidatePromotion: "Promotion to the live world",
  customerData: "Customer-data compilation",
};

type WorkspaceTab = "overview" | "knowledge" | "connections" | "developers" | "billing" | "integrity";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "knowledge", label: "Knowledge" },
  { id: "connections", label: "Connections" },
  { id: "developers", label: "Developers" },
  { id: "billing", label: "Billing & capacity" },
  { id: "integrity", label: "Processing integrity" },
];

const SURFACE_TO_TAB: Record<WorkspaceSurface, WorkspaceTab> = {
  home: "overview",
  sources: "overview",
  runs: "overview",
  review: "knowledge",
  changes: "knowledge",
  world: "knowledge",
  ask: "knowledge",
  connections: "connections",
  developer: "developers",
  activity: "overview",
  settings: "billing",
};

const LEGACY_TAB_TO_SURFACE: Record<WorkspaceTab, WorkspaceSurface> = {
  overview: "home",
  knowledge: "world",
  connections: "connections",
  developers: "developer",
  billing: "settings",
  integrity: "settings",
};

function readWorkspaceLocation(): { surface: WorkspaceSurface; tab: WorkspaceTab } {
  const segment = window.location.pathname.split("/").filter(Boolean)[1];
  const knownSurface = Object.hasOwn(SURFACE_TO_TAB, segment ?? "") ? segment as WorkspaceSurface : null;
  if (knownSurface) {
    const detail = window.location.pathname.split("/").filter(Boolean)[2];
    return { surface: knownSurface, tab: knownSurface === "settings" && detail === "trust" ? "integrity" : SURFACE_TO_TAB[knownSurface] };
  }
  const requested = new URLSearchParams(window.location.search).get("tab");
  const legacy = TABS.some((item) => item.id === requested) ? requested as WorkspaceTab : "overview";
  return { surface: LEGACY_TAB_TO_SURFACE[legacy], tab: legacy };
}

export default function WorkspacePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  /** Distinguishes two uploads of the same file in one session. */
  const uploadSeq = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { start: buy } = useCheckout(setNotice);
  // Read from the URL on mount so a linked or reloaded workspace opens on the same view.
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [surface, setSurface] = useState<WorkspaceSurface>("home");
  useEffect(() => {
    const applyLocation = () => {
      const location = readWorkspaceLocation();
      setTab(location.tab);
      setSurface(location.surface);
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);
  const [busy, setBusy] = useState(false);
  const corpusFollowRef = useRef<AbortController | null>(null);
  const [compileJob, setCompileJob] = useState<CompileJobView | null>(null);
  /*
    A corpus is several compiles, followed as one run.

    Held beside `compileJob` rather than replacing it: the panel still shows one part at a
    time, because a part is where a decision has to be taken, and the corpus row above it says
    which part of how many and what the others are doing.
  */
  const [corpus, setCorpus] = useState<
    (CorpusProgress & { parts: Array<{ jobId: string; batchIndex: number | null; state: CompileJobView["state"] }> }) | null
  >(null);
  /*
    The selection to send again when a corpus was only partly enqueued.

    Held rather than recomputed because the resume has to be the *identical* document set: the
    corpus id and every part's idempotency key are derived from it, so the same list lands in
    the same corpus and fills only the empty slots, while a re-picked list would open a second
    run beside the first.
  */
  const [resumeCorpus, setResumeCorpus] = useState<string[] | null>(null);
  /*
    One observer at a time, and it must be stoppable.

    Aborting this stops *watching* -- it never stops the compile, which is the whole point of
    moving the state machine to the server. Without the ref, following a second job would
    leave the first reader running and the two would fight over the same panel.
  */
  const followRef = useRef<AbortController | null>(null);
  const [stagedSelection, setStagedSelection] = useState<WorkspaceSelection | null>(null);
  /*
    Real page counts for the staged selection, measured before anything is uploaded.

    Null while the measurement is in flight -- and the quote falls back to the byte bound in
    the meantime, which is what it always was. Nothing here can make the preflight worse; it
    can only make it exact.
  */
  const [stagedPageCounts, setStagedPageCounts] = useState<PageCountResult[] | null>(null);
  /*
    Archive expansion, moved off the main thread.

    `unzipSync` cannot be interrupted, so wherever it runs nothing else runs. On this thread
    that is the UI: no repaint, no progress, and a Cancel button that cannot be pressed because
    the event loop is inside the decompressor. The worker is created on first use and torn down
    on unmount, because it holds the archive and its expansion at once.
  */
  const expanderRef = useRef<ArchiveExpander | null>(null);
  const stagingAbortRef = useRef<AbortController | null>(null);
  const [staging, setStaging] = useState<{ archive: string; done: number; total: number } | null>(null);
  /*
    Built on mount rather than on first use, because the dropzone has to state the archive
    ceiling before anyone chooses a file -- and the ceiling is whichever path will actually run.
  */
  const [archiveCeilingMb, setArchiveCeilingMb] = useState(ARCHIVE_LIMITS.maxSyncArchiveMb);
  useEffect(() => {
    expanderRef.current ??= createArchiveExpander();
    setArchiveCeilingMb(expanderRef.current.ceilingBytes / (1024 * 1024));
    return () => { expanderRef.current?.close(); expanderRef.current = null; };
  }, []);
  const compileLimits = compileLimitsNotice(archiveCeilingMb);
  const [dropActive, setDropActive] = useState(false);
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  /**
   * D9 -- the tab keeps counting after you look away.
   *
   * Only a real, already-fetched count goes here -- never a placeholder, never an animation
   * pretending a number is still climbing. That is the same "no manufactured statistic" rule
   * the landing page's fine print states outright; a tab title is not exempt from it just
   * because nobody screenshots it. Restored on unmount so a signed-out tab does not keep a
   * previous session's count.
   */
  useEffect(() => {
    if (!documents) return;
    const previous = document.title;
    document.title = `${documents.length} document${documents.length === 1 ? "" : "s"} — TAVONEL`;
    return () => { document.title = previous; };
  }, [documents]);
  const [proofMode, setProofMode] = useState(false);
  const [collectionResult, setCollectionResult] = useState<CollectionResult | null>(null);
  const [worldReadModel, setWorldReadModel] = useState<WorldReadModel | null>(null);
  useEffect(() => {
    const collectionId = collectionResult?.collectionId;
    if (!collectionId) {
      setWorldReadModel(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) return null;
      const response = await fetch(`/api/v1/world/${encodeURIComponent(collectionId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      return response.ok ? await response.json() as { model?: WorldReadModel } : null;
    })()
      .then((body) => setWorldReadModel(body?.model ?? null))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setWorldReadModel(null);
      });
    return () => controller.abort();
  }, [collectionResult?.collectionId]);
  const [downloading, setDownloading] = useState(false);
  const [billingAccount, setBillingAccount] = useState<BillingAccount | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  /**
   * What this browser knows about files it is sending. The server list cannot see a document
   * until CDR has written an immutable PDF for it, so without this the first stretch of every
   * upload is a blank screen.
   */
  const [uploads, setUploads] = useState<LocalUpload[]>([]);
  /**
   * What this browser calls each document.
   *
   * The server does not return filenames and is not going to: a filename is customer content,
   * and the intake boundary keeps what it stores to the minimum. So the name lives here, in the
   * browser that did the upload, and the workspace reads it back on load -- which is the part
   * that was missing. Without it every document became a UUID the moment the tab was reloaded.
   */
  const [names, setNames] = useState<DocumentNames>({});
  useEffect(() => { setNames(recallDocumentNames()); }, []);
  /**
   * The live read, per document, keyed by document id.
   *
   * Fetched with a short-lived capability this server signs and then steps out of: the object
   * comes from the bucket to the browser directly, the same way the file went the other way.
   * Routing it through /api would put document geometry -- and eventually the document -- on a
   * path this product tells people it never travels.
   */
  const [reading, setReading] = useState<Record<string, OcrProgress>>({});

  /* The board is derived, never stored. Storing it would let it disagree with the objects. */
  const pipelineRows = buildPipeline(
    uploads,
    documents,
    collectionResult?.sourceDocuments.map((item) => item.documentId) ?? [],
  );
  /**
   * Until this resolves the workspace knows nothing, and it must not fill that gap with
   * plausible-looking values. A signed-out visitor previously saw the whole shell -- tabs, a
   * billing panel, even a Sign out control -- and every action failed one toast at a time, which
   * left them unable to tell a signed-out session from a broken product.
   */
  const [session, setSession] = useState<"checking" | "anonymous" | "signed-in">("checking");

  const signOut = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    await client.auth.signOut();
    window.location.replace("/");
  };

  const [activeWorld, setActiveWorld] = useState<ActiveWorld | null>(null);
  const [worldVersions, setWorldVersions] = useState<WorldVersion[]>([]);
  const [worldBusy, setWorldBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewEvidenceId, setReviewEvidenceId] = useState<string | null>(null);
  const [evidenceReviewAction, setEvidenceReviewAction] = useState<"accept" | "edit" | "reject" | null>(null);
  const [evidenceReviewReason, setEvidenceReviewReason] = useState("");
  /*
    The correction itself, which "Edit" never carried.

    `patchObjectId` is the compiled node being corrected and `patchAfter` is what it should
    say. Both empty means the reviewer is filing an opinion, which is still a legitimate
    outcome; both filled means a new candidate artifact comes out the other side.
  */
  const [patchObjectId, setPatchObjectId] = useState<string | null>(null);
  const [patchAfter, setPatchAfter] = useState("");
  const [evidenceReviewBusy, setEvidenceReviewBusy] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<GroundedAnswer | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askEvidenceId, setAskEvidenceId] = useState<string | null>(null);

  const getAuthToken = async () => {
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    return data.session?.access_token ?? null;
  };

  const clearWorldState = () => {
    setActiveWorld(null);
    setWorldVersions([]);
    setAskResult(null);
    setAskEvidenceId(null);
  };

  const loadWorldState = async (collectionId: string, token?: string) => {
    if (!/^collection-[a-f0-9]{32}$/.test(collectionId)) return;
    const accessToken = token ?? await getAuthToken();
    if (!accessToken) return;
    const response = await fetch(`/api/collections/${collectionId}/world`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const json = await response.json() as { code?: string; activeWorld?: ActiveWorld; versions?: WorldVersion[] };
    if (response.status === 404 && json.code === "ACTIVE_WORLD_NOT_FOUND") {
      clearWorldState();
      return;
    }
    if (!response.ok || !json.activeWorld || !Array.isArray(json.versions)) {
      setNotice(`Active world verification failed (${json.code ?? response.status}).`);
      return;
    }
    setActiveWorld(json.activeWorld);
    setWorldVersions(json.versions);
    setAskResult(null);
    setAskEvidenceId(null);
  };

  const loadDocuments = async (): Promise<DocumentListItem[]> => {
    const client = getSupabaseBrowserClient();
    if (!client) return [];
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return [];
    const response = await fetch("/api/documents", { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    const json = (await response.json()) as { documents?: DocumentListItem[] };
    const next = json.documents ?? [];
    setDocuments(next);
    setSelectedDocumentIds((current) => current.filter((documentId) =>
      next.some((item) => item.documentId === documentId && item.hasOcrJson),
    ));
    return next;
  };

  const loadBilling = async () => {
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/billing/status", { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const json = await response.json() as { account?: BillingAccount };
    if (json.account) setBillingAccount(json.account);
  };

  const loadCollectionCandidate = async (collectionId: string, manifestDigest?: string) => {
    if (!/^collection-[a-f0-9]{32}$/.test(collectionId)) return;
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return;
    const query = manifestDigest ? `?manifest=${encodeURIComponent(manifestDigest)}` : "";
    const response = await fetch(`/api/collections/${collectionId}${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = await response.json() as {
      code?: string;
      artifactKey?: string;
      candidatePromotion?: boolean;
      artifact?: CollectionResult & {
        schemaVersion?: string;
        package?: { roots?: unknown; files?: Array<{ path?: unknown }> };
      };
    };
    const artifact = json.artifact;
    const paths = artifact?.package?.files?.map((file) => file.path).filter((path): path is string => typeof path === "string") ?? [];
    if (
      !response.ok ||
      !artifact ||
      artifact.schemaVersion !== "tavonel.collection_candidate.v1" ||
      artifact.collectionId !== collectionId ||
      artifact.candidatePromotion !== false ||
      json.candidatePromotion !== false ||
      !(
        (artifact.lifecycle === "candidate" && artifact.validation.status === "passed" && artifact.coreExecution?.status === "completed") ||
        (artifact.lifecycle === "review_required" && artifact.validation.status === "review_required" && artifact.coreExecution?.status === "review_required" && (artifact.reviewReasons?.length ?? 0) > 0)
      ) ||
      !paths.includes("ontology/knowledge.jsonld") ||
      !paths.includes("ontology/knowledge.ttl") ||
      !paths.includes("graph/nodes.csv") ||
      !paths.includes("graph/relationships.csv")
    ) {
      setNotice(`Immutable collection verification failed (${json.code ?? response.status}).`);
      return;
    }
    setCollectionResult({ ...artifact, artifactKey: json.artifactKey ?? "" });
    await loadWorldState(collectionId, token);
    setNotice(`Compiled World ${collectionId} was restored and its evidence package verified.`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setProofMode(params.get("foundation-proof") === "1");

    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      if (!data.session) {
        // Send them somewhere that can actually help. /login explains what this is and, where no
        // provider is configured, says so instead of offering a control that will fail.
        setSession("anonymous");
        window.location.replace("/login");
        return;
      }
      setSession("signed-in");
      void loadDocuments();
      void loadBilling();
      const collectionId = params.get("collection");
      if (collectionId) void loadCollectionCandidate(collectionId, params.get("manifest") ?? undefined);

      /*
        Pick up a compile that is already running.

        The URL is the fast path -- a reload or a restored tab still carries `?job=`. The list
        is the one that matters: a customer who closed the tab, or who came back on a different
        machine, has no id to carry, and the run they paid for is still theirs to watch. Asking
        the server is the only way to find it, and the only reason the answer exists is that
        the job is durable in the first place.
      */
      void (async () => {
        const fromCorpus = params.get("corpus");
        if (fromCorpus && /^corpus-[a-f0-9]{32}$/.test(fromCorpus)) {
          void followCorpus(fromCorpus);
          return;
        }
        const fromUrl = params.get("job");
        if (fromUrl && /^cjob-[a-f0-9]{32}$/.test(fromUrl)) {
          void followCompileJob(fromUrl);
          return;
        }
        const token = data.session?.access_token;
        if (!token) return;
        const response = await fetch("/api/compile-jobs", { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const json = await response.json() as { jobs?: CompileJobView[] };
        const open = json.jobs?.find((entry) => !["ready", "failed", "cancelled"].includes(entry.state));
        if (!open) return;
        // A part found on its own is still part of a run, and showing it alone would say
        // "12 sources" about a compile the customer started with 128.
        if (open.corpusId) {
          void followCorpus(open.corpusId);
          return;
        }
        setCompileJob(open);
        void followCompileJob(open.jobId);
      })();

      /*
       * R1, last half. Someone who picked a plan before signing in arrives here carrying it --
       * in the URL if they came straight through, in sessionStorage if Google's redirect ate the
       * query string. The parameter is stripped before the checkout opens, so a reload or a
       * back-navigation cannot fire a second checkout.
       */
      const resume = readOfferParam(window.location.search) ?? takeCheckoutIntent();
      if (resume) {
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        window.history.replaceState(null, "", url.toString());
        trackFunnel("checkout_opened", { offer: resume });
        void buy(resume);
      }
    })();
    // This is the mount sequence and it must run exactly once. Re-running it would re-resolve the
    // session, reload every list, and -- worse -- reopen a checkout the visitor has already been
    // taken through. `buy` and `loadCollectionCandidate` are read here, never watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keeps the live view running for anything that is being read, including after a reload.
   *
   * The batch loop watches its own upload, but a visitor who refreshes -- or who comes back to a
   * tab while CDR and OCR are still working -- was getting a static board. This effect owns that
   * case: it refreshes the document list and the progress objects while, and only while, at least
   * one document is genuinely mid-read. When nothing is being read it does nothing at all.
   */
  useEffect(() => {
    if (session !== "signed-in" || !documents) return;
    let readingNow = documents
      .filter((item) => item.sanitizedKey && !item.hasOcrJson && item.processingState !== "operator_review")
      .map((item) => item.documentId);
    if (readingNow.length === 0) return;

    let cancelled = false;
    const pollStates = new Map<string, ProgressPollState>();
    const tick = async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      const observed = await Promise.all(readingNow.map((documentId) => readProgressFor(documentId, token)));
      readingNow = readingNow.filter((documentId, index) => {
        const decision = advanceProgressPoll(pollStates.get(documentId), observed[index] ?? null);
        pollStates.set(documentId, decision.state);
        return decision.continuePolling;
      });
      if (!cancelled) await loadDocuments();
      if (readingNow.length === 0) {
        cancelled = true;
        window.clearInterval(timer);
      }
    };
    const timer = window.setInterval(() => void tick(), 1_500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // The identity of what is being read is the dependency; the handlers are read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, documents?.map((item) => `${item.documentId}:${item.hasOcrJson}:${item.processingState}`).join("|")]);

  const openBillingPortal = async () => {
    setBillingBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) {
        setNotice("Sign in with Google before managing billing.");
        return;
      }
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await response.json() as { code?: string; url?: string };
      if (!response.ok || !json.url) {
        setNotice(`Billing portal is unavailable (${json.code ?? response.status}).`);
        return;
      }
      window.location.assign(json.url);
    } finally {
      setBillingBusy(false);
    }
  };

  /**
   * Reads one document's progress object.
   *
   * Two hops on purpose: this server issues a capability, the bucket serves the bytes. A failure
   * at either hop is silent, because progress is a view and losing a frame of it must never
   * surface as an error about the document itself.
   */
  const readProgressFor = async (documentId: string, token: string): Promise<OcrProgress | null> => {
    try {
      const issued = await fetch(`/api/documents/${documentId}/progress`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!issued.ok) return null;
      const { readUrl } = await issued.json() as { readUrl?: string };
      if (!readUrl) return null;
      const object = await fetch(readUrl, { cache: "no-store" });
      if (!object.ok) return null;
      const progress = qualifyProgress(await object.json());
      if (!progress) return null;
      setReading((current) => ({ ...current, [documentId]: progress }));
      return progress;
    } catch {
      // A dropped frame of a live view is not an error about the document.
      return null;
    }
  };

  const patchUpload = (localId: string, patch: Partial<LocalUpload>) =>
    setUploads((current) => current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));

  const uploadDocument = async (file: File, manageBusy = true): Promise<string | null> => {
    const sourceLabel = (file as WorkspaceUploadFile).tavonelRelativePath || file.name;
    if (manageBusy) setBusy(true);
    // The id is local until the capability call returns one. The board needs a row immediately,
    // because issuing the capability is itself a wait the visitor should be able to see.
    const localId = `local-${file.name}-${file.size}-${uploadSeq.current++}`;
    setUploads((current) => [
      ...current,
      { localId, filename: sourceLabel, bytes: file.size, documentId: null, phase: "issuing", loaded: 0 },
    ]);
    try {
      const client = getSupabaseBrowserClient();
      if (!client) {
        patchUpload(localId, { phase: "failed", reason: "not signed in" });
        setNotice("Sign in with Google first.");
        return null;
      }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        patchUpload(localId, { phase: "failed", reason: "not signed in" });
        setNotice("Sign in with Google first.");
        return null;
      }
      const capability = await fetch("/api/uploads/capability", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          originalFilename: file.name,
          declaredMimeType: file.type || "application/pdf",
          requestedBytes: file.size,
          estimatedPages: estimateBillablePages({
            bytes: file.size,
            mimeType: file.type || "application/pdf",
          })?.pages,
        }),
      });
      const json = await capability.json() as { code?: string; documentId?: string; uploadUrl?: string; declaredMimeType?: string };
      if (!capability.ok || !json.uploadUrl) {
        patchUpload(localId, { phase: "failed", reason: `capability not issued (${json.code ?? capability.status})` });
        setNotice(json.code === "AUTH_REQUIRED" ? "Sign in with Google first." : `Upload was not issued (${json.code ?? capability.status}).`);
        return null;
      }

      /*
       * The PUT moved from `fetch` to `XMLHttpRequest` for one reason: fetch cannot report upload
       * progress, so a large scan was a frozen button for as long as it took. These are bytes the
       * transport acknowledged on the way to the quarantine bucket -- the application server is
       * not in this path, and showing the transfer did not put it there.
       */
      patchUpload(localId, { documentId: json.documentId ?? null, phase: "sending", loaded: 0 });
      // The one moment both halves exist in the same scope: the id the server just issued, and
      // the name the visitor picked the file by.
      if (json.documentId) setNames(rememberDocumentName(json.documentId, sourceLabel));
      const transfer = putWithProgress(
        json.uploadUrl,
        file,
        json.declaredMimeType ?? file.type,
        ({ loaded }) => patchUpload(localId, { loaded }),
      );
      const result = await transfer.done;
      if (!result.ok) {
        const reason = result.reason === "http"
          ? `secure upload failed (${result.status})`
          : result.reason === "aborted" ? "transfer cancelled" : "network did not complete the transfer";
        if (json.documentId) {
          const client = getSupabaseBrowserClient();
          const { data } = client ? await client.auth.getSession() : { data: { session: null } };
          const token = data.session?.access_token;
          if (token) {
            await fetch("/api/uploads/release", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
              body: JSON.stringify({ documentId: json.documentId }),
            }).catch(() => undefined);
          }
        }
        patchUpload(localId, { phase: "failed", reason });
        setNotice(`${reason}. The file never entered the app server.`);
        return null;
      }
      if (json.documentId) {
        /*
         * The digest travels with the confirmation, taken by SubtleCrypto over the very bytes the
         * transfer sent. It is what lets the server compare the stored object against the
         * capability it issued without downloading the source back onto the application server --
         * which is how free evaluation used to be fingerprinted, through a 5 MiB-capped read that
         * refused every larger trial upload with a 503 the board showed as "needs review".
         *
         * A page served without a secure context has no SubtleCrypto and reports null; the server
         * records that as absent rather than inventing one, and refuses the trial gate outright
         * instead of quietly skipping it.
         */
        const confirmed = await fetch("/api/uploads/confirm", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            documentId: json.documentId,
            ...(result.sourceSha256 ? { sourceSha256: result.sourceSha256 } : {}),
          }),
        });
        if (!confirmed.ok) {
          // "Needs review" was the wrong word for every one of these: confirmation refuses with a
          // typed code, and calling that a review invented a queue nobody is working. Say the
          // code, and say that the source stops here until it succeeds.
          const failure = await confirmed.json().catch(() => null) as { code?: string } | null;
          const code = failure?.code ?? `HTTP ${confirmed.status}`;
          patchUpload(localId, { phase: "failed", reason: `source confirmation refused (${code})` });
          setNotice(`${file.name} reached storage but was not confirmed (${code}). It is not queued for processing.`);
          await loadDocuments();
          return json.documentId;
        }
      }
      patchUpload(localId, { phase: "stored", loaded: file.size });

      /*
       * What finished is the transfer, and that is all this may claim.
       *
       * It used to announce that TAVONEL was preparing and reading the source the moment the PUT
       * returned -- before the CDR worker had seen the object, and regardless of whether it would
       * refuse it seconds later. For everything above the processing ceiling that sentence was
       * simply false, and it was the last thing the customer was told before the row went quiet.
       * The board is now the place an outcome appears, because it is the only place that reads
       * one, so this points there instead of guessing.
       */
      setNotice(activationPolicy.cdr.enabled && activationPolicy.ocrGpu.enabled
        ? `${file.name} reached quarantine storage. Preparation has started; the source pipeline shows whether it is accepted or refused.`
        : `${file.name} reached quarantine storage. This source needs operator review before reading can continue.`);
      await loadDocuments();
      return json.documentId ?? null;
    } finally {
      if (manageBusy) setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sessionToken = async () => {
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    return data.session?.access_token ?? null;
  };

  /*
    Follow a compile that is already running somewhere else.

    Everything below is a view. The job advances on the server whether this function is called
    or not; what it does is subscribe to the transition log, replay whatever was missed, and
    keep replaying across reconnects until the job reaches a state where nothing further will
    happen on its own.

    This is the half of masterplan 6.3 the customer sees. The half that matters is that
    deleting this function would not change a single outcome.
  */
  const followCompileJob = useCallback(async (jobId: string) => {
    followRef.current?.abort();
    const controller = new AbortController();
    followRef.current = controller;
    let compiled: string | null = null;

    await observeCompileJob({
      jobId,
      authToken: sessionToken,
      signal: controller.signal,
      onFrame: (frame) => {
        setCompileJob((previous) => ({
          jobId,
          state: frame.state,
          documentsTotal: frame.documentsTotal || previous?.documentsTotal || 0,
          documentsReady: frame.documentsReady,
          blocked: frame.blocked,
          blockedResolution: previous?.blockedResolution ?? null,
          errorCode: frame.errorCode,
          collectionId: frame.collectionId ?? previous?.collectionId ?? null,
        }));
        if (frame.collectionId) compiled = frame.collectionId;
        // The document board is fed by its own effect; this only has to nudge the list so a
        // source that finished reading appears without waiting for the next poll.
        if (frame.eventType === "progressed") void loadDocuments();
      },
    });

    if (controller.signal.aborted) return;
    if (!compiled) return;
    await loadCollectionCandidate(compiled);
    /*
      Say what was built, not that it was restored.

      `loadCollectionCandidate` is shared with the reload path and its notice is written for
      someone returning to a World that already existed. A compile that has just finished
      deserves its own sentence, and the counts are the part worth reading.
    */
    setCollectionResult((result) => {
      if (!result || result.collectionId !== compiled) return result;
      setNotice(result.lifecycle === "review_required"
        ? `Collection ${result.collectionId} produced a signed review package with ${result.reviewReasons?.length ?? 0} review reason(s). Download and inspect it; promotion remains blocked.`
        : `Compiled World ready from ${result.validation.counts.documents} documents: ${result.validation.counts.topics} topics, ${result.validation.counts.entities} entities, ${result.validation.counts.claims} claims and ${result.validation.counts.relations} evidence-bound relations.`);
      return result;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    Follow a corpus: the run above the parts.

    Polled rather than streamed. Each part already has an event stream and the panel subscribes
    to whichever part is in front of the customer; a second stream carrying only "part 4 also
    finished" would be a second connection per corpus for a fact that changes eleven times in
    a run. What this loop does is pick the part worth watching -- the first that has not
    settled -- and hand it to `followCompileJob`, which is the same code path a single compile
    uses. There is no corpus-specific progress logic anywhere.
  */
  const followCorpus = useCallback(async (corpusId: string) => {
    corpusFollowRef.current?.abort();
    const controller = new AbortController();
    corpusFollowRef.current = controller;
    let watching: string | null = null;

    while (!controller.signal.aborted) {
      const token = await sessionToken();
      if (!token) return;
      let payload: (CorpusProgress & { parts: CompileJobView[] }) | null = null;
      try {
        const response = await fetch(`/api/compile-jobs/corpus/${corpusId}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.ok) payload = await response.json();
      } catch {
        // A dropped poll is not a failed corpus. The next turn asks again.
      }
      if (controller.signal.aborted) return;
      if (payload?.parts?.length) {
        setCorpus({
          ...payload,
          parts: payload.parts.map((part) => ({ jobId: part.jobId, batchIndex: part.batchIndex ?? null, state: part.state })),
        });
        const open = payload.parts.find((part) => !["ready", "failed", "cancelled"].includes(part.state))
          ?? payload.parts[payload.parts.length - 1];
        if (open && open.jobId !== watching) {
          watching = open.jobId;
          setCompileJob(open);
          void followCompileJob(open.jobId);
        }
        if (payload.state !== "running") return;
      }
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
  }, [followCompileJob]);

  /*
    Start a compile and stop being responsible for it.

    The browser used to poll the document list until everything had been read and then call the
    compiler itself, which made this tab part of the pipeline: closing it abandoned a run whose
    reading had already been paid for. Now the request records the intent durably and returns a
    job id, and a scheduler on the server does the rest.

    The id goes into the URL because that is the cheapest durable handle a person has -- a
    reload, a restored tab, a link sent to themselves on another machine all land back on the
    same run. It is not the only one: the workspace also asks the server for its open jobs on
    load, so a customer who never had the URL still finds the compile waiting.
  */
  const startDurableCompile = async (documentIds: string[]) => {
    const token = await sessionToken();
    if (!token) {
      setNotice("Sign in with Google first.");
      return;
    }
    const response = await fetch("/api/compile-jobs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentIds }),
    });
    const json = await response.json() as {
      jobId?: string;
      state?: string;
      code?: string;
      message?: string;
      corpusId?: string;
      batchCount?: number;
      partsEnqueued?: number;
      /* Set when the server wrote some parts and not the rest. Reading it is the whole point. */
      incompleteReason?: string | null;
      parts?: Array<{ jobId: string; batchIndex: number }>;
    };
    /*
      Over the per-compile ceiling the server partitions the selection and answers with a
      corpus instead of a job. The browser does not decide that -- it asks for the whole
      selection and is told how it was split, so the two sides cannot disagree about the
      boundary.
    */
    if (response.ok && json.code === "COMPILE_CORPUS_ACCEPTED" && json.corpusId && json.parts?.length) {
      const url = new URL(window.location.href);
      url.searchParams.delete("job");
      url.searchParams.set("corpus", json.corpusId);
      window.history.replaceState(null, "", url);
      /*
        What started, not what was planned.

        `enqueueCorpusCompile` treats a partial enqueue as a normal outcome and returns how far
        it got; this handler printed the planned part count and dropped that, so a run in which
        seven of eleven parts were written was announced as eleven parts compiling, and the four
        that were never enqueued were never mentioned again. The sentence is built in
        `corpus-batching` so the wording is tested rather than interpolated here.
      */
      const started = describeCorpusStart({
        documentsTotal: documentIds.length,
        batchCount: json.batchCount ?? json.parts.length,
        partsEnqueued: json.partsEnqueued ?? json.parts.length,
        incompleteReason: json.incompleteReason ?? null,
      });
      setNotice(started.notice);
      /* The identical selection, so a resume lands in the same corpus and fills only the gaps. */
      setResumeCorpus(started.resume ? documentIds : null);
      void followCorpus(json.corpusId);
      return;
    }
    if (!response.ok || !json.jobId) {
      setNotice(json.message ?? `Compile could not be started (${json.code ?? response.status}).`);
      return;
    }
    setCorpus(null);
    setResumeCorpus(null);
    setCompileJob({
      jobId: json.jobId,
      state: "preflight",
      documentsTotal: documentIds.length,
      documentsReady: 0,
      blocked: [],
      blockedResolution: null,
      errorCode: null,
      collectionId: null,
    });
    const url = new URL(window.location.href);
    url.searchParams.set("job", json.jobId);
    window.history.replaceState(null, "", url);
    setNotice(`Compiling ${documentIds.length} source${documentIds.length === 1 ? "" : "s"}. This runs on our servers; you can close this page.`);
    void followCompileJob(json.jobId);
  };

  /** Answer a partial failure. The worker will not move until one of these is recorded. */
  const resolveCompileBlockers = async (resolution: BlockerResolution) => {
    if (!compileJob) return;
    const token = await sessionToken();
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/compile-jobs/${compileJob.jobId}/blockers`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ resolution }),
      });
      const json = await response.json() as { code?: string };
      if (!response.ok) {
        setNotice(json.code === "SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL"
          ? "A file was stopped by a safety check. Remove it from this compile explicitly, or cancel."
          : `That choice was not applied (${json.code ?? response.status}).`);
        return;
      }
      setCompileJob((previous) => (previous ? { ...previous, blockedResolution: resolution } : previous));
      void followCompileJob(compileJob.jobId);
    } finally {
      setBusy(false);
    }
  };

  const cancelCompileJob = async () => {
    if (!compileJob) return;
    const token = await sessionToken();
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/compile-jobs/${compileJob.jobId}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await response.json() as { code?: string; state?: string };
      if (!response.ok) {
        // A compile that finished a second before the button was pressed is not an error, and
        // the finished World is not thrown away to honour the click.
        setNotice(json.code === "COMPILE_JOB_ALREADY_SETTLED"
          ? "That compile had already finished. Nothing was discarded."
          : `Cancel failed (${json.code ?? response.status}).`);
        return;
      }
      followRef.current?.abort();
      setCompileJob((previous) => (previous ? { ...previous, state: "cancelled" } : previous));
      setNotice("Compile cancelled.");
    } finally {
      setBusy(false);
    }
  };

  const recompileWithCore = async () => {
    const documentIds = collectionResult?.sourceDocuments.map((document) => document.documentId) ?? [];
    const recompileVerdict = judgeCompileSet(documentIds.length);
    if (!recompileVerdict.ok) {
      setNotice(recompileVerdict.message);
      return;
    }
    setBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) {
        setNotice("Sign in with Google first.");
        return;
      }
      setNotice(`Compiling ${documentIds.length} prepared sources into a reviewable World...`);
      const response = await fetch("/api/collections/compile", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentIds }),
      });
      const json = await response.json() as CollectionResult & { code?: string };
      if (!response.ok || (json.coreExecution?.status !== "completed" && json.coreExecution?.status !== "review_required")) {
        setNotice(`Core compilation failed (${json.code ?? response.status}). No candidate was promoted.`);
        return;
      }
      setCollectionResult(json);
      await loadWorldState(json.collectionId, token);
      setNotice(json.coreExecution.status === "review_required"
        ? `Separate Core produced a review-required package for ${json.collectionId}; ${json.reviewReasons?.join(", ") || "manual review required"}. Signed download is available and promotion remains blocked.`
        : `Compiled World ${json.collectionId} is ready for evidence review.`);
    } finally {
      setBusy(false);
    }
  };

  const compileSelectedDocuments = async () => {
    const documentIds = [...new Set(selectedDocumentIds)];
    // The durable path, so the ceiling is the corpus one: over twelve the server partitions
    // the selection rather than refusing it.
    const verdict = judgeCorpusSet(documentIds.length);
    if (!verdict.ok) {
      setNotice(verdict.message);
      return;
    }
    setBusy(true);
    setCollectionResult(null);
    clearWorldState();
    try {
      // Same durable path as a fresh upload. Compiling a selection that has already been
      // compiled returns the run that produced it rather than paying for it twice; a
      // deliberate re-run against a newer Core is a different act and lives in
      // `recompileWithCore`, which calls the compiler directly on purpose.
      await startDurableCompile(documentIds);
    } finally {
      setBusy(false);
    }
  };

  const downloadCollection = async () => {
    if (!collectionResult) return;
    setDownloading(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) {
        setNotice("Sign in with Google before downloading this private collection.");
        return;
      }
      const response = await fetch(
        `/api/collections/${collectionResult.collectionId}/download?manifest=${encodeURIComponent(collectionResult.manifestDigest)}`,
        {
        headers: { authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok || response.headers.get("content-type") !== "application/zip") {
        const json = await response.json().catch(() => ({ code: response.status }));
        setNotice(`Signed knowledge package download failed (${json.code ?? response.status}).`);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tavonel-${collectionResult.collectionId}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded the verified knowledge package with ${collectionResult.validation.counts.packageFiles} files.`);
    } finally {
      setDownloading(false);
    }
  };

  /*
   * A batch goes up several at a time.
   *
   * It used to go one at a time, and that made the whole surface lie about the system: a batch
   * took the sum of its parts, and the board showed one document moving while the pipeline behind
   * it is perfectly capable of sanitizing and reading many at once. The ceiling exists because a
   * browser keeps roughly six connections to a host, and the capability calls and the document
   * poll have to interleave with the transfers -- past that point the extra transfers queue
   * invisibly and the panels simply stop updating.
   *
   * A file that fails no longer takes the batch with it. The old loop returned on the first
   * failure and silently abandoned the rest; the ones already in the bucket are still there and
   * still being read, so the report now names the failure and keeps going.
   */
  const uploadDocuments = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setCollectionResult(null);
    clearWorldState();
    try {
      setNotice(`Uploading ${files.length} file(s) securely, ${UPLOAD_CEILING} at a time.`);
      const settled = await runBounded(files, UPLOAD_CEILING, (file) => uploadDocument(file, false));
      const ids = settled.flatMap((result) => (result.ok && result.value ? [result.value] : []));
      const lost = files.length - ids.length;
      if (lost > 0) {
        setNotice(`${ids.length} of ${files.length} files uploaded. ${lost} did not, and nothing was retried automatically.`);
      }
      /*
        One uploaded file is a compile.

        This gate compared the uploaded count against two, the last place the old floor
        survived. The route accepts one, the compiler accepts one, and the preflight panel
        offers one -- and then a visitor who dropped a single PDF watched it upload, sanitize
        and read, and nothing happened. No error: the batch simply ended. Judging the set with
        the shared verdict means this path cannot drift from the route again.
      */
      if (judgeCorpusSet(ids.length).ok) await startDurableCompile(ids);
    } finally {
      setBusy(false);
    }
  };

  const stageWorkspaceFiles = async (files: File[]) => {
    if (files.length === 0) return;
    expanderRef.current ??= createArchiveExpander();
    stagingAbortRef.current?.abort();
    const controller = new AbortController();
    stagingAbortRef.current = controller;
    try {
      const prepared = await prepareWorkspaceSelection(files, {
        expander: expanderRef.current,
        signal: controller.signal,
        onArchiveProgress: (archive, done, total) => setStaging({ archive, done, total }),
      });
      if (controller.signal.aborted) return;
      if (prepared.files.length === 0) {
        setStagedSelection(prepared);
        setNotice("No supported files were found. Nothing was uploaded or processed.");
        return;
      }
      setStagedSelection(prepared);
      setNotice(`${prepared.files.length} supported file${prepared.files.length === 1 ? "" : "s"} ready for preflight. Nothing has been uploaded or processed yet.`);
    } catch (error) {
      setStagedSelection(null);
      const reason = error instanceof Error ? error.message : "INVALID_SELECTION";
      // Cancelling is something the visitor did, not something that went wrong.
      setNotice(reason === "ARCHIVE_CANCELLED" || reason === "SELECTION_CANCELLED"
        ? "Selection cancelled. Nothing was uploaded."
        : `Preflight blocked this selection (${reason}). Nothing was uploaded.`);
    } finally {
      setStaging(null);
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
  };

  const stagedEstimates = stagedSelection?.files.map((entry, index) => {
    const measured = stagedPageCounts?.[index];
    return estimateBillablePages({
      bytes: entry.file.size,
      mimeType: entry.file.type,
      declaredPages: measured?.pages ?? null,
      // Carried through, not flattened: a PDF page tree and a Word file's saved metadata are
      // not the same kind of fact, and only one of them may be called verified.
      declaredBasis: measured && "basis" in measured ? measured.basis : null,
    });
  }) ?? [];
  const stagedPages = stagedEstimates.reduce((sum, estimate) => sum + (estimate?.pages ?? 0), 0);
  const stagedQuote = quoteCompilePages(stagedPages);
  /*
    The set is as strong as its weakest file. One PDF without a page count drags the preflight
    back to an estimate; one Word file drags it to "declared", because the total the customer
    authorises against is then partly a number Word wrote rather than one anything counted.
  */
  const stagedConfidence: PageEstimateConfidence = weakestConfidence(
    stagedEstimates.map((estimate) => estimate?.confidence ?? "provisional"),
  );
  /*
    Spreadsheets, named rather than folded into the estimate.

    A sheet is not a page and a print area is not a page, and nobody has decided what a
    spreadsheet is billed in. Quoting one from its file size and saying nothing would make that
    undecided number the number a customer was charged, which is exactly the kind of invention
    this repository forbids. So it is disclosed, in the panel, before they press Compile.
  */
  const stagedUndecided = stagedPageCounts?.filter((entry) => entry.pages === null
    && entry.reason === "XLSX_BILLABLE_UNIT_UNDECIDED").length ?? 0;

  /*
    Read the page counts out of the files themselves.

    A quote derived from file size is an upper bound, and it was labelled as one, but a 40MB
    scan and a 40MB text-layer report are not the same purchase. This runs once per staged
    selection, off the render path, bounded so a 128-file folder does not lock the tab, and it
    abandons its result if the selection changed underneath it.

    Formats that do not state a page count -- ODF, plain text, and spreadsheets, whose billable
    unit is still the founder's to decide -- fall back to the byte bound and say so through the
    Verified/Estimated label. They are not guessed at.
  */
  useEffect(() => {
    if (!stagedSelection || stagedSelection.files.length === 0) {
      setStagedPageCounts(null);
      return;
    }
    let current = true;
    void (async () => {
      const measured = await measureSelection(stagedSelection.files.map((entry) => ({
        mimeType: entry.file.type,
        name: entry.relativePath,
        bytes: async () => new Uint8Array(await entry.file.arrayBuffer()),
      })));
      if (current) setStagedPageCounts(measured);
    })();
    return () => { current = false; };
  }, [stagedSelection]);

  /*
    The compile ceiling is enforced here, before a byte is uploaded.

    Intake structurally accepts up to 128 files so that a folder or an archive can be inspected
    whole, and the unsupported ones are filtered out before this point. But the compile ceiling
    was only checked at the end, so a visitor could drop thirteen files, authorise a quote,
    watch every one of them upload, sanitize and get read -- and be refused at the last step,
    having spent the processing. The masterplan names that exact state as forbidden.

    So the verdict is computed on the supported set and gates the Compile button. The selection
    stays on screen with the reason, because silently discarding files someone chose is its own
    kind of lie.
  */
  const stagedVerdict = judgeCorpusSet(stagedSelection?.files.length ?? 0);

  const startStagedCompile = async () => {
    if (!stagedSelection?.files.length) return;
    // The button is already disabled for this, but the guard is what makes it a contract
    // rather than a styling choice: nothing uploads a set the compile step will refuse.
    const verdict = judgeCorpusSet(stagedSelection.files.length);
    if (!verdict.ok) { setNotice(verdict.message); return; }
    const files = stagedSelection.files.map((entry) => entry.file);
    setStagedSelection(null);
    await uploadDocuments(files);
  };

  const uploadPublicProof = async () => {
    setBusy(true);
    setNotice("Loading the public Foundation OCR proof PDF in this browser…");
    try {
      const response = await fetch(FOUNDATION_PROOF_PDF_URL, { cache: "no-store" });
      if (!response.ok) {
        setNotice(`Public proof PDF fetch failed (${response.status}). Nothing entered quarantine.`);
        return;
      }
      const bytes = await response.arrayBuffer();
      const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
      if (digest !== FOUNDATION_PROOF_PDF_SHA256) {
        setNotice("Public proof PDF digest did not match. Nothing entered quarantine.");
        return;
      }
      await uploadDocument(new File([bytes], "w3c-dummy.pdf", { type: "application/pdf" }));
    } catch {
      setNotice("Public proof PDF could not be prepared. Nothing entered quarantine.");
    } finally {
      setBusy(false);
    }
  };

  const uploadPublicCollectionProof = async () => {
    setBusy(true);
    setCollectionResult(null);
    clearWorldState();
    setNotice("Preparing three digest-pinned public DART report pages in this browser…");
    try {
      const files: File[] = [];
      for (const proof of FOUNDATION_COLLECTION_PROOF) {
        const response = await fetch(proof.url, { cache: "no-store" });
        if (!response.ok) {
          setNotice(`Collection proof source failed (${response.status}). Nothing else was uploaded.`);
          return;
        }
        const bytes = await response.arrayBuffer();
        const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        if (digest !== proof.sha256) {
          setNotice(`Collection proof digest mismatch for ${proof.filename}. Nothing else was uploaded.`);
          return;
        }
        files.push(new File([bytes], proof.filename, { type: "application/pdf" }));
      }
      await uploadDocuments(files);
    } catch {
      setNotice("Public collection proof could not be prepared. Candidate promotion remains closed.");
    } finally {
      setBusy(false);
    }
  };

  const verifyLatestCandidates = async () => {
    const target = documents?.find((document) => document.hasOcrJson && document.ocrJsonKey && document.sanitizedKey);
    if (!target) {
      setNotice("No OCR candidates JSON is available yet. Refresh Documents after processing completes.");
      return;
    }
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) {
      setNotice("Sign in with Google first.");
      return;
    }
    const response = await fetch(`/api/documents/${target.documentId}/candidates`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = await response.json() as {
      code?: string;
      candidatePromotion?: boolean;
      candidates?: { status?: unknown; text?: unknown; pageCount?: unknown; inputSha256?: unknown; sourceImmutableKey?: unknown };
    };
    const candidates = json.candidates;
    if (!response.ok || candidates?.status !== "ok" || typeof candidates.text !== "string" || typeof candidates.pageCount !== "number") {
      setNotice(`OCR candidates JSON verification failed (${json.code ?? response.status}).`);
      return;
    }
    const versionKey = target.versionKey.toLowerCase();
    const digestMatches = candidates.inputSha256 === `sha256:${versionKey}`;
    const keyMatches = candidates.sourceImmutableKey === target.sanitizedKey;
    setNotice(
      `OCR JSON verified for ${target.documentId}: ${candidates.pageCount} page(s), ${candidates.text.length} text characters, digest ${digestMatches ? "matched" : "mismatched"}, immutable key ${keyMatches ? "matched" : "mismatched"}, candidatePromotion=${json.candidatePromotion === false ? "false" : "invalid"}.`,
    );
  };

  const navigateSurface = useCallback((next: WorkspaceSurface) => {
    setSurface(next);
    setTab(SURFACE_TO_TAB[next]);
    const url = new URL(window.location.href);
    url.pathname = next === "home" ? "/workspace" : `/workspace/${next}`;
    url.searchParams.delete("tab");
    window.history.pushState(null, "", url.toString());
    const anchor = ({
      sources: "workspace-sources",
      runs: "workspace-runs",
      review: "workspace-review",
      changes: "workspace-changes",
      world: "workspace-world",
      ask: "workspace-ask",
      activity: "workspace-runs",
    } as Partial<Record<WorkspaceSurface, string>>)[next];
    if (anchor) window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
    else window.scrollTo({ top: 0 });
  }, []);

  const navigateSettings = (panel: "usage" | "trust") => {
    setSurface("settings");
    setTab(panel === "trust" ? "integrity" : "billing");
    const url = new URL(window.location.href);
    url.pathname = `/workspace/settings/${panel}`;
    url.searchParams.delete("tab");
    window.history.pushState(null, "", url.toString());
  };

  /*
    What the ledger says when a reviewer accepts without writing anything.

    It used to say "Accepted after comparing the compiled result with its exact source region."
    — a specific claim about what the reviewer did, written by the button rather than by them.
    Someone who clicked Accept without opening the page had an assertion filed under their name
    saying they had compared it, which is the one thing an audit record must never do. This
    sentence describes only what is actually known: the action, and where it came from. The
    reviewer's own words go in when they choose to write them.

    Eight characters is the ledger's floor for this column, so the neutral default has to be a
    real sentence rather than an empty string.
  */
  const ACCEPTED_WITHOUT_NOTE = "Accepted in the review interface. No note was given.";

  /*
    The compiled objects this evidence supports, and which of them a reviewer may correct.

    Bound to the selected evidence rather than to the whole World: a correction is made while
    looking at the page region that justifies it, which is the only position from which someone
    can tell whether the compiled label is right.
  */
  const reviewEvidence = worldReadModel?.evidence.find((item) => item.id === reviewEvidenceId)
    ?? worldReadModel?.evidence[0]
    ?? null;
  const correctableObjects = (worldReadModel?.objects ?? []).filter((object) =>
    (object.type === "Topic" || object.type === "Entity" || object.type === "Claim")
    && reviewEvidence !== null
    && object.evidenceRefs.includes(reviewEvidence.id));
  const patchTarget = correctableObjects.find((object) => object.id === patchObjectId) ?? null;

  const recordEvidenceReview = async (
    action: "accept" | "edit" | "reject",
    reason: string,
    patch?: { objectId: string; before: string; after: string },
  ) => {
    const evidence = worldReadModel?.evidence.find((item) => item.id === reviewEvidenceId)
      ?? worldReadModel?.evidence[0];
    if (!collectionResult || !evidence || reason.trim().length < 8) return;
    setEvidenceReviewBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) { setNotice("Sign in before recording a review decision."); return; }
      const response = await fetch("/api/v1/reviews", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          collectionId: collectionResult.collectionId,
          manifestDigest: collectionResult.manifestDigest,
          evidenceId: evidence.id,
          action,
          reason: reason.trim(),
          ...(patch ? { patch } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { code?: string; resultingManifestDigest?: string };
      if (!response.ok) {
        setNotice(body.code === "PATCH_BEFORE_MISMATCH"
          ? "That value has already been corrected by someone else. Reload the World and look again."
          : `Review decision could not be recorded (${body.code ?? response.status}).`);
        return;
      }
      setEvidenceReviewAction(null);
      setEvidenceReviewReason("");
      setPatchObjectId(null);
      setPatchAfter("");
      if (body.resultingManifestDigest) {
        /*
          A correction produced a new candidate, so move to it.

          The reviewed one is untouched and still readable at its own digest -- object storage
          is immutable artifact truth, and a patch writes a second artifact rather than
          replacing the first.
        */
        await loadCollectionCandidate(collectionResult.collectionId, body.resultingManifestDigest);
        const url = new URL(window.location.href);
        url.searchParams.set("collection", collectionResult.collectionId);
        url.searchParams.set("manifest", body.resultingManifestDigest);
        window.history.replaceState(null, "", url);
        setNotice(`Corrected. A new candidate was compiled at ${body.resultingManifestDigest.slice(0, 19)}… and the change was recorded against the evidence it was reviewed under. The previous candidate is unchanged.`);
        return;
      }
      setNotice(`${action === "accept" ? "Accepted" : action === "edit" ? "Change requested" : "Rejected"}. The evidence-bound human decision was recorded.`);
    } finally {
      setEvidenceReviewBusy(false);
    }
  };

  const promoteCandidate = async () => {
    if (!collectionResult || reviewReason.trim().length < 8) return;
    if (
      collectionResult.lifecycle !== "candidate" ||
      collectionResult.validation.status !== "passed" ||
      collectionResult.coreExecution?.status !== "completed" ||
      collectionResult.coreExecution.runtime !== "tavonel-python-core-v2" ||
      !collectionResult.coreExecution.worldStateId
    ) {
      setNotice("Only a completed Python Core v2 candidate with a bound world state can be promoted.");
      return;
    }
    if (!window.confirm("Activate this exact immutable candidate as the collection's current world? This records your review reason and does not alter candidate bytes.")) return;
    setWorldBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setNotice("Sign in with Google before promoting a reviewed candidate.");
        return;
      }
      const response = await fetch(`/api/collections/${collectionResult.collectionId}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          manifestDigest: collectionResult.manifestDigest,
          expectedCurrentManifest: activeWorld?.manifestDigest ?? null,
          reason: reviewReason.trim(),
        }),
      });
      const json = await response.json() as { code?: string };
      if (!response.ok) {
        setNotice(`World promotion failed (${json.code ?? response.status}). The previous active pointer is unchanged.`);
        if (response.status === 409) await loadWorldState(collectionResult.collectionId, token);
        return;
      }
      await loadWorldState(collectionResult.collectionId, token);
      setReviewReason("");
      setNotice("Human review recorded. This revision is now the active World.");
    } finally {
      setWorldBusy(false);
    }
  };

  const rollbackWorld = async (targetManifestDigest: string) => {
    if (!collectionResult || !activeWorld || rollbackReason.trim().length < 8) return;
    if (!window.confirm(`Roll the active pointer back to ${targetManifestDigest}? No package bytes will be deleted or rewritten.`)) return;
    setWorldBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setNotice("Sign in with Google before rolling back a world.");
        return;
      }
      const response = await fetch(`/api/collections/${collectionResult.collectionId}/world/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          targetManifestDigest,
          expectedCurrentManifest: activeWorld.manifestDigest,
          reason: rollbackReason.trim(),
        }),
      });
      const json = await response.json() as { code?: string };
      if (!response.ok) {
        setNotice(`World rollback failed (${json.code ?? response.status}). The active pointer is unchanged.`);
        if (response.status === 409) await loadWorldState(collectionResult.collectionId, token);
        return;
      }
      await loadWorldState(collectionResult.collectionId, token);
      setRollbackReason("");
      setNotice(`Rollback recorded. ${targetManifestDigest} is active again; all immutable versions and the audit event remain retained.`);
    } finally {
      setWorldBusy(false);
    }
  };

  const askActiveWorld = async () => {
    if (!collectionResult || !activeWorld || askQuestion.trim().length < 3) return;
    setAskBusy(true);
    setAskResult(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setNotice("Sign in with Google before asking the active world.");
        return;
      }
      const response = await fetch(`/api/collections/${collectionResult.collectionId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: askQuestion.trim() }),
      });
      const json = await response.json() as GroundedAnswer & { code?: string };
      if (!response.ok || (json.status !== "grounded" && json.status !== "abstained")) {
        setNotice(`Grounded Ask failed (${json.code ?? response.status}). No answer was inferred.`);
        return;
      }
      setAskResult(json);
      setNotice(json.status === "grounded"
        ? `Answer returned from ${json.citations.length} exact source region(s) in active revision ${activeWorld.revision}.`
        : "The active world abstained because no region-bound evidence matched the question.");
    } finally {
      setAskBusy(false);
    }
  };

  if (session !== "signed-in") {
    // No shell, no tabs, no numbers. Anything drawn here would be describing a workspace this
    // visitor has not been shown to own.
    return (
      <main id="main" className="auth" tabIndex={-1}>
        <header>
          <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        </header>
        <div className="auth-body">
          <div className="auth-card">
            <p className="eyebrow">WORKSPACE</p>
            <h1>{session === "checking" ? "Checking your session." : "Sign-in required."}</h1>
            <p className="lead" role="status">
              {session === "checking"
                ? "Reading the session for this browser. Your workspace opens on its own if one is active."
                : "This workspace is tenant-scoped and opens only for a signed-in account. Taking you to sign-in."}
            </p>
            {session === "anonymous" ? (
              <div className="auth-actions">
                <Link className="btn" href="/login">Go to sign-in</Link>
                <Link className="btn ghost" href="/">Back to the site</Link>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const activePipelineCount = pipelineRows.filter((row) => row.stages.some((stage) => stage.state === "active")).length;
  const activityCount = activePipelineCount || (busy ? 1 : 0);
  const reviewCount = collectionResult?.reviewReasons?.length ?? 0;
  const candidateReady = Boolean(collectionResult?.coreExecution);
  const candidateNeedsDecision = Boolean(
    collectionResult?.coreExecution && activeWorld?.manifestDigest !== collectionResult.manifestDigest,
  );
  const documentCount = documents?.length ?? 0;
  const stateTitle = activityCount > 0
    ? `${activityCount} ${activityCount === 1 ? "source is" : "sources are"} becoming a world.`
    : candidateNeedsDecision
      ? "Candidate World ready for review."
      : activeWorld
        ? `World v${activeWorld.revision} is active and source-grounded.`
        : documentCount >= 2
          ? `${documentCount} sources are ready to compile.`
          : "Build your first Compiled World.";
  const stateDescription = activityCount > 0
    ? "Follow only observed pipeline transitions. TAVONEL does not estimate progress between receipts."
    : candidateNeedsDecision
      ? "Inspect the immutable candidate, evidence bindings, and review gates before any active-pointer decision."
      : activeWorld
        ? "Ask with exact citations, inspect retained versions, or download the signed portable package."
        : "Add at least two sources, confirm the processing boundary, and follow the guided compile path.";
  const nextAction: { label: string; surface?: WorkspaceSurface; run?: () => void } = activityCount > 0
    ? { label: "Inspect current run", surface: "activity" }
    : candidateNeedsDecision
      ? { label: "Review candidate", surface: "review" }
      : activeWorld
        ? { label: "Ask active World", surface: "ask" }
        : documentCount >= 2
          ? { label: "Start compile", surface: "activity" }
          : { label: "Choose sources", run: () => fileRef.current?.click() };

  return (
    <WorkspaceUltimateShell
      surface={surface}
      activeRevision={activeWorld?.revision ?? null}
      candidateReady={candidateReady}
      reviewCount={candidateReady ? reviewCount : null}
      activityCount={activityCount}
      truthGates={[]}
      stateTitle={stateTitle}
      stateDescription={stateDescription}
      nextAction={nextAction}
      onNavigate={navigateSurface}
      onUpload={() => activationPolicy.customerIntake.enabled ? fileRef.current?.click() : setNotice("Upload remains locked by the current intake policy.")}
      onRefresh={() => void loadDocuments()}
      onSignOut={() => void signOut()}
      headerAction={
        activationPolicy.customerIntake.enabled ? (
          <>
            <input ref={fileRef} type="file" multiple hidden accept={uploadAcceptAttribute} onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length > 0) void stageWorkspaceFiles(files); }} />
            <input ref={(node) => { folderRef.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length > 0) void stageWorkspaceFiles(files); }} />
            {proofMode ? (
              <div className="proof-actions">
                <button disabled={busy} onClick={() => void uploadPublicProof()}><UploadCloud size={16} /> {busy ? "Running proof…" : "Single proof"}</button>
                <button disabled={busy} onClick={() => void uploadPublicCollectionProof()}><UploadCloud size={16} /> {busy ? "Compiling…" : "3-document proof"}</button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => fileRef.current?.click()}><UploadCloud size={16} /> {busy ? "Processing…" : "Upload"}</button>
            )}
          </>
        ) : (
          <button onClick={() => setNotice("Upload remains locked by the current intake policy.")}><UploadCloud size={16} /> Upload <LockKeyhole size={14} /></button>
        )
      }
    >
          {notice ? (
            <p className="notice static" role="status">
              <strong>Activity.</strong> {notice}
              {/*
                The compensating action for a partly enqueued corpus, beside the sentence that
                reports it. It re-submits the identical document set: enqueue is idempotent and
                the corpus id is derived from the set, so the parts that exist come back
                unchanged and only the empty slots are written.
              */}
              {resumeCorpus ? (
                <> <button type="button" onClick={() => void startDurableCompile(resumeCorpus)}>Resume the missing parts</button></>
              ) : null}
            </p>
          ) : null}

          {tab === "overview" && collectionResult ? (
            /*
              A candidate is not a world yet, and the completion panel now says which one you have.

              It announced "Your Compiled World is ready" for both, including a candidate sitting
              in `review_required` with reasons attached. The Ask button was disabled underneath
              with a tooltip explaining that the candidate had to be activated first — so the
              heading claimed a finished world while the controls contradicted it. The whole
              point of the candidate stage is that automated extraction is not yet organizational
              truth; a heading that skips it undoes the guarantee.
            */
            <section className="workspace-complete" aria-labelledby="workspace-complete-title">
              <div>
                <p className="eyebrow">{activeWorld ? "ACTIVE WORLD" : "CANDIDATE READY"}</p>
                <h2 id="workspace-complete-title">
                  {activeWorld ? "Your Compiled World is ready." : "Your compiled candidate is ready for review."}
                </h2>
                <p>{collectionResult.validation.counts.documents} sources became {collectionResult.validation.counts.entities} entities, {collectionResult.validation.counts.claims} claims, and {collectionResult.validation.counts.relations} evidence-bound relations.</p>
                {activeWorld ? null : (
                  <p className="fine">
                    Nothing is active until you approve it. Review the evidence, then activate the
                    candidate to make it the world that Ask, the API and MCP read.
                  </p>
                )}
              </div>
              <div className="workspace-complete-actions">
                {activeWorld ? (
                  <>
                    <button type="button" onClick={() => navigateSurface("world")}>Open World</button>
                    <button type="button" onClick={() => navigateSurface("ask")}>Ask</button>
                    <button type="button" disabled={downloading} onClick={() => void downloadCollection()}>{downloading ? "Preparing…" : "Download signed package"}</button>
                    <button type="button" onClick={() => navigateSurface("review")}>View evidence</button>
                    <button type="button" onClick={() => navigateSettings("trust")}>Verify export</button>
                    <button type="button" onClick={() => fileRef.current?.click()}>Add sources</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => navigateSurface("review")}>Review items</button>
                    <button type="button" onClick={() => navigateSurface("world")}>Inspect candidate</button>
                    <button type="button" disabled={downloading} onClick={() => void downloadCollection()}>{downloading ? "Preparing…" : "Download candidate package"}</button>
                    <button type="button" onClick={() => fileRef.current?.click()}>Add sources</button>
                  </>
                )}
              </div>
            </section>
          ) : null}

          {tab === "overview" && surface !== "runs" && surface !== "activity" ? (
          <>
          <section
              className="workspace-intake"
              data-compact={activeWorld || candidateNeedsDecision ? 1 : 0}
              data-active={dropActive}
              onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDropActive(false);
                const items = Array.from(event.dataTransfer.items);
                void collectDroppedWorkspaceFiles(items).then(stageWorkspaceFiles).catch((error: unknown) => {
                  setNotice(error instanceof Error ? `Source selection blocked (${error.message}).` : "Source selection could not be read.");
                });
              }}
              aria-labelledby="workspace-intake-title"
            >
              <div className="workspace-intake-copy">
                <p className="eyebrow">
                  {activeWorld ? "ADD SOURCES" : candidateNeedsDecision ? "ADD SOURCES FOR THE NEXT COMPILE" : "BUILD YOUR FIRST COMPILED WORLD"}
                </p>
                <h2 id="workspace-intake-title">
                  {activeWorld || candidateNeedsDecision ? "Add files, folders or ZIP" : "Drop files, folders or ZIP here"}
                </h2>
                <p>
                  {activeWorld || candidateNeedsDecision
                    ? "Add more knowledge without losing access to the World you already have."
                    : "Upload sources or connect the system where your knowledge already lives."}
                </p>
                <div className="workspace-intake-actions">
                  <button type="button" onClick={() => fileRef.current?.click()}>Choose files</button>
                  <button type="button" onClick={() => folderRef.current?.click()}>Choose folder</button>
                  <button type="button" onClick={() => navigateSurface("connections")}>Connect a source</button>
                </div>
                {/*
                  The sixth copy of the format list, four lines under the `accept` attribute
                  derived from the manifest -- and already wrong: it said "ODF" (a label no MIME
                  row uses) and omitted GIF, which the upload route accepts. Derived now, so the
                  hint under the drop zone and the picker above it cannot disagree.
                */}
                <small>{sourceFamilyChips.join(" · ")}</small>
                {/*
                  The limits belong here, before anything is chosen.

                  Every one of these was previously discovered as an exception thrown after the
                  files were picked — or, worse, after they had been uploaded and read. Someone
                  who knows the ceiling can select within it; someone who does not finds out by
                  losing a batch.
                */}
                <small className="workspace-intake-limits">{compileLimits}</small>
                <div className="workspace-source-choices" aria-label="Available source connections">
                  {WORKSPACE_SOURCE_CHOICES.map((source) => (
                    <button type="button" key={source.name} onClick={() => navigateSurface("connections")}>
                      <span>{source.name}</span>
                      <small>{source.availability}</small>
                    </button>
                  ))}
                </div>
              </div>
              {staging ? (
                /*
                  What an archive is doing while it is being opened, and a way to stop it.

                  Neither was possible before: expansion held the main thread, so there was no
                  frame in which to draw a number and no event loop in which to hear a click.
                */
                <div className="workspace-archive-progress" role="status" aria-live="polite">
                  <p className="eyebrow">OPENING ARCHIVE</p>
                  <p>{staging.archive}</p>
                  <progress max={staging.total} value={staging.done} aria-label={`${staging.done} of ${staging.total} entries expanded`} />
                  <p className="fine">{staging.done} of {staging.total} entries. Nothing has been uploaded.</p>
                  <button type="button" onClick={() => stagingAbortRef.current?.abort()}>Cancel</button>
                </div>
              ) : null}
              {stagedSelection ? (
                <div className="workspace-preflight" role="region" aria-label="Compile preflight">
                  <p className="eyebrow">PREFLIGHT</p>
                  <p className="workspace-staged-summary">
                    <strong>{stagedSelection.files.length} file{stagedSelection.files.length === 1 ? "" : "s"} staged.</strong>{" "}
                    Nothing has been uploaded yet. Review the estimate, then upload and compile.
                  </p>
                  <dl>
                    <div><dt>Files</dt><dd>{stagedSelection.files.length}</dd></div>
                    <div><dt>{pageCountLabel(stagedConfidence)}</dt><dd>{stagedPages}</dd></div>
                    <div><dt>Archives</dt><dd>{stagedSelection.archiveCount}</dd></div>
                    <div><dt>Warnings</dt><dd>{stagedSelection.unsupported.length}</dd></div>
                    <div><dt>Estimated</dt><dd>{stagedQuote ? formatUsd(stagedQuote.estimatedUsd) : "—"}</dd></div>
                    <div><dt>Maximum</dt><dd>{stagedQuote ? formatUsd(stagedQuote.maximumUsd) : "—"}</dd></div>
                  </dl>
                  <p className="fine">
                    {stagedConfidence === "verified"
                      ? "Page counts were counted from the documents themselves. You will never be charged above the maximum shown."
                      : stagedConfidence === "declared"
                        ? "Some files state their own page count rather than being counted — Word records the number it last saved, which can be out of date. The billed page count is confirmed once the documents are processed, and never exceeds the maximum shown."
                        : "Some files do not state a page count, so this is an upper-bound estimate from file size. The billed page count is confirmed after the documents are read, and never exceeds the maximum shown."}
                  </p>
                  {stagedUndecided > 0 ? (
                    <p className="fine">
                      {stagedUndecided === 1 ? "One spreadsheet is" : `${stagedUndecided} spreadsheets are`} quoted from
                      file size. A spreadsheet has no page count, and what it is billed in is not settled — so this part
                      of the estimate is an upper bound and nothing more.
                    </p>
                  ) : null}
                  <p className="fine">{compileLimits}</p>
                  {stagedVerdict.ok ? null : (
                    <p className="fine workspace-preflight-blocked" role="alert">{stagedVerdict.message}</p>
                  )}
                  {stagedSelection.warnings.map((warning) => <p className="fine" key={warning}>{warning}</p>)}
                  <div className="workspace-intake-actions">
                    <button type="button" disabled={busy || !stagedQuote || !stagedVerdict.ok} onClick={() => void startStagedCompile()}>{busy ? "Uploading & compiling…" : "Upload & compile"}</button>
                    <button type="button" onClick={() => setStagedSelection(null)}>Clear</button>
                  </div>
                </div>
              ) : null}
            </section>
          {/*
            The compile itself, as a durable thing rather than a sentence.

            Rendered above the film because it is the panel someone comes back to the tab for:
            where the run is, what is stuck, and what they can do about it. The film and the
            board below are still the detail.
          */}
          {compileJob ? (
            <CompileJobPanel
              job={compileJob}
              corpus={corpus}
              names={names}
              busy={busy}
              onResolve={(resolution) => void resolveCompileBlockers(resolution)}
              onCancel={() => void cancelCompileJob()}
              onOpenPart={(jobId) => {
                const part = corpus?.parts.find((entry) => entry.jobId === jobId);
                setCompileJob((previous) => (previous && previous.jobId === jobId ? previous : {
                  jobId,
                  state: part?.state ?? "preflight",
                  documentsTotal: 0,
                  documentsReady: 0,
                  blocked: [],
                  blockedResolution: null,
                  errorCode: null,
                  collectionId: null,
                  batchIndex: part?.batchIndex ?? null,
                }));
                void followCompileJob(jobId);
              }}
            />
          ) : null}
          {/*
            The compile, drawn.

            The board below reports state per document and is the thing to read when something
            stops. This canvas is the thing to *watch*: the same four columns the public cuts
            use — sources, the page under the reader, the lines coming out of it, and the world
            their own documents are building. It is fed entirely from this visitor's own uploads,
            pipeline rows and streamed OCR progress. No fixture ever reaches it.
          */}
          {compileJob || pipelineRows.length > 0 ? (
            <CompileStage rows={pipelineRows} reading={reading} names={names} world={worldReadModel} state={compileJob?.state ?? null} />
          ) : null}

          <div id="workspace-runs">
            <PipelineBoard
              rows={pipelineRows}
              reading={reading}
              names={names}
              onDismiss={uploads.length > 0 ? () => { setUploads([]); setReading({}); } : undefined}
            />
          </div>
          <p className="eyebrow">SOURCE PIPELINE</p>
          <p className="lead">Build a traceable body of knowledge from your sources. Each file is prepared, read and compiled through a recorded chain you can inspect.</p>
          <div className="workspace-grid">
            <section id="workspace-sources" className="card document-card">
              <p className="eyebrow">SOURCES</p>
              <h2>{documents && documents.length > 0 ? "Sources ready for your next World" : "Bring your first source"}</h2>
              {documents && documents.length > 0 ? (
                <>
                <ul className="document-meta">
                  {documents.map((doc) => (
                    <li key={`${doc.documentId}-${doc.versionKey}`}>
                      {/*
                        The same rule as the floor above: a name a person recognises, then the
                        id underneath for the receipts to hang off.
                      */}
                      <strong>{displayName(doc.documentId, names)}</strong>
                      {doc.hasOcrJson ? (
                        <label className="compile-source-choice">
                          <input
                            type="checkbox"
                            checked={selectedDocumentIds.includes(doc.documentId)}
                            onChange={(event) => setSelectedDocumentIds((current) => event.target.checked
                              ? [...new Set([...current, doc.documentId])]
                              : current.filter((documentId) => documentId !== doc.documentId))}
                          />
                          Include in the next candidate
                        </label>
                      ) : null}
                      <small>{doc.hasOcrJson ? "Ready to compile" : doc.processingState === "operator_review" ? "Needs review" : "Preparing and reading"}</small>
                    </li>
                  ))}
                </ul>
                <div className="compile-selection-actions">
                  <small>
                    {selectedDocumentIds.length} OCR-qualified document{selectedDocumentIds.length === 1 ? "" : "s"} selected
                    {" · "}{compileLimits}
                  </small>
                  <button type="button" disabled={busy || !judgeCorpusSet(selectedDocumentIds.length).ok} onClick={() => void compileSelectedDocuments()}>
                    {busy ? "Compiling selected documents..." : "Compile selected documents"}
                  </button>
                </div>
                </>
              ) : (
                <div className="empty">
                  <FileText size={22} />
                  <strong>No sources yet</strong>
                  <p>Upload files, a folder or ZIP archive, or connect the system where your knowledge already lives.</p>
                  {activationPolicy.customerIntake.enabled ? (
                    <div className="billing-actions">
                      <button type="button" onClick={() => fileRef.current?.click()}>Upload your first document</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
            <section className="card canvas">
              <p className="eyebrow">COMPILED WORLD</p>
              <h2>{collectionResult ? "Ready for review" : "Waiting for sources"}</h2>
              {collectionResult ? (
                <div className="collection-result">
                  <strong>Your compiled result</strong>
                  <p>{collectionResult.validation.counts.documents} documents · {collectionResult.validation.counts.topics} topics · {collectionResult.validation.counts.entities} entities · {collectionResult.validation.counts.claims} claims · {collectionResult.validation.counts.relations} relations</p>
                  <small>{collectionResult.directoryPlan.length} directory entries · {collectionResult.validation.counts.packageFiles} package files</small>
                  {collectionResult.coreExecution ? (
                    <>
                      <small>{collectionResult.coreExecution.status === "completed" ? "Compilation complete" : "Review required"}</small>
                      {collectionResult.reviewReasons?.length ? (
                        <small>{collectionResult.reviewReasons.length} review item{collectionResult.reviewReasons.length === 1 ? "" : "s"} need{collectionResult.reviewReasons.length === 1 ? "s" : ""} a decision.</small>
                      ) : null}
                      <button className="download-package" disabled={downloading} onClick={() => void downloadCollection()}>
                        <Download size={15} aria-hidden="true" />
                        {downloading ? "Signing verified ZIP..." : "Download signed knowledge package"}
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => void recompileWithCore()}>{busy ? "Running Core..." : "Recompile with separate Core"}</button>
                  )}
                </div>
              ) : (
                <div className="collection-result" role="status">
                  <strong>No Compiled World yet</strong>
                  <small>Compile one or more ready sources. The graph appears only after real objects and relations exist.</small>
                </div>
              )}
              <p>Prepared sources produce a reviewable directory, ontology, graph, retrieval index and provenance package. A human review keeps activation explicit.</p>
            </section>
          </div>
          </>
          ) : null}

          {surface === "runs" ? (
            <OperationsUltimate
              mode="runs"
              rows={pipelineRows}
              documents={documents}
              names={names}
              onRefresh={() => void loadDocuments()}
              gates={[
                { label: "Intake", qualified: activationPolicy.customerIntake.enabled, detail: activationPolicy.customerIntake.reason },
                { label: "CDR", qualified: activationPolicy.cdr.enabled, detail: activationPolicy.cdr.reason },
                { label: "OCR", qualified: activationPolicy.ocrGpu.enabled, detail: activationPolicy.ocrGpu.reason },
              ]}
            />
          ) : null}

          {surface === "activity" ? (
            <OperationsUltimate mode="activity" rows={pipelineRows} documents={documents} names={names} gates={[]} />
          ) : null}

          {tab === "knowledge" ? (
            <>
              {surface === "world" ? (
              <div id="workspace-world">
                {/*
                  Rollback is offered from the Versions lens, where the diff sits directly
                  above the button. A rollback control with only a version number beside it
                  asks somebody to approve a change they cannot see; the reason box below is
                  still required and is still what goes into the ledger.
                */}
                <WorldStudioUltimate
                  model={worldReadModel}
                  onRollback={rollbackReason.trim().length >= 8 ? (digest) => void rollbackWorld(digest) : undefined}
                  rollbackBusy={worldBusy}
                />
                <WorldExplorer
                  collection={collectionResult}
                  onUpload={activationPolicy.customerIntake.enabled ? () => fileRef.current?.click() : undefined}
                />
              </div>
              ) : null}

              {surface === "changes" ? (
                <ChangeInbox
                  model={worldReadModel}
                  collectionId={collectionResult?.collectionId ?? null}
                  names={names}
                />
              ) : null}
              {/*
                This control was lost when the sidebar buttons became tabs: the handler survived
                the refactor and its button did not, so OCR candidate verification silently left
                the product. It belongs on this tab -- the JSON it checks is the raw material the
                architecture above is built from.
              */}
              {surface === "review" ? <>
              <section className="card review-comparison" aria-labelledby="review-comparison-title">
                <p className="eyebrow">REVIEW</p>
                <h2 id="review-comparison-title">Compare the compiled result with its source.</h2>
                {worldReadModel?.evidence.length ? (
                  <>
                    <WorldStudioUltimate
                      model={worldReadModel}
                      initialLens="evidence"
                      selectedEvidenceId={reviewEvidenceId ?? worldReadModel.evidence[0].id}
                      onEvidenceSelect={(selection) => setReviewEvidenceId(selection?.id ?? null)}
                    />
                    {/*
                      Two different acts, named differently, because they are.

                      "Request change" files an opinion: the compiled value stays exactly as it
                      is and a note goes into the ledger. "Correct" changes it -- the reviewer
                      types what it should say, a new candidate artifact is compiled, and the
                      receipt binds who did it, what it said before, what it says now and which
                      version resulted. The button used to be labelled Edit and did the first,
                      which set a reviewer up to believe they had corrected something.
                    */}
                    <div className="review-decision-actions" aria-label="Review decision">
                      <button type="button" disabled={evidenceReviewBusy} onClick={() => void recordEvidenceReview("accept", ACCEPTED_WITHOUT_NOTE)}>Accept</button>
                      <button type="button" disabled={evidenceReviewBusy} onClick={() => { setEvidenceReviewAction("accept"); setEvidenceReviewReason(""); }}>Accept with note</button>
                      <button
                        type="button"
                        disabled={evidenceReviewBusy || correctableObjects.length === 0}
                        onClick={() => {
                          setEvidenceReviewAction("edit");
                          setEvidenceReviewReason("");
                          const first = correctableObjects[0];
                          setPatchObjectId(first?.id ?? null);
                          setPatchAfter(first?.label ?? "");
                        }}
                      >
                        Correct
                      </button>
                      <button type="button" disabled={evidenceReviewBusy} onClick={() => { setEvidenceReviewAction("edit"); setEvidenceReviewReason(""); setPatchObjectId(null); setPatchAfter(""); }}>Request change</button>
                      <button type="button" disabled={evidenceReviewBusy} onClick={() => { setEvidenceReviewAction("reject"); setEvidenceReviewReason(""); }}>Reject</button>
                    </div>
                    {evidenceReviewAction ? (
                      <form
                        className="review-decision-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void recordEvidenceReview(
                            evidenceReviewAction,
                            evidenceReviewReason,
                            patchTarget && patchAfter.trim().length > 0 && patchAfter.trim() !== patchTarget.label
                              ? { objectId: patchTarget.id, before: patchTarget.label, after: patchAfter.trim() }
                              : undefined,
                          );
                        }}
                      >
                        {evidenceReviewAction === "edit" && patchObjectId !== null ? (
                          <>
                            {/*
                              Only Topic, Entity and Claim labels are offered.

                              A Document label is its title as read from the document, and an
                              Evidence node carries the immutable key it was read from. Letting
                              either be typed over would make the artifact say the source
                              contained something it did not.
                            */}
                            <label htmlFor="evidence-patch-target">What is wrong?</label>
                            <select
                              id="evidence-patch-target"
                              value={patchObjectId}
                              onChange={(event) => {
                                setPatchObjectId(event.target.value);
                                setPatchAfter(correctableObjects.find((object) => object.id === event.target.value)?.label ?? "");
                              }}
                            >
                              {correctableObjects.map((object) => (
                                <option key={object.id} value={object.id}>{object.type} - {object.label.slice(0, 70)}</option>
                              ))}
                            </select>
                            <label htmlFor="evidence-patch-after">What should it say?</label>
                            <input
                              id="evidence-patch-after"
                              type="text"
                              maxLength={500}
                              value={patchAfter}
                              onChange={(event) => setPatchAfter(event.target.value)}
                            />
                            {patchTarget ? <p className="fine">Before: {patchTarget.label}</p> : null}
                            <p className="fine">
                              This compiles a new candidate. The one you are reviewing is not changed, and this
                              correction does not clear a review requirement or promote anything.
                            </p>
                          </>
                        ) : null}
                        <label htmlFor="evidence-review-reason">
                          {evidenceReviewAction === "accept"
                            ? "Note for the record"
                            : evidenceReviewAction === "edit"
                              ? "What needs to change?"
                              : "Why does this not match the source?"}
                        </label>
                        <textarea id="evidence-review-reason" required minLength={8} maxLength={1000} autoFocus value={evidenceReviewReason} onChange={(event) => setEvidenceReviewReason(event.target.value)} />
                        <button type="submit" disabled={evidenceReviewBusy || evidenceReviewReason.trim().length < 8}>
                          {evidenceReviewBusy
                            ? "Recording…"
                            : evidenceReviewAction === "accept"
                              ? "Record acceptance"
                              : evidenceReviewAction === "edit"
                                ? (patchTarget && patchAfter.trim().length > 0 && patchAfter.trim() !== patchTarget.label
                                  ? "Correct and compile a new candidate"
                                  : "Record change request")
                                : "Record rejection"}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : <p className="world-empty">Compile a collection to review its page-and-bbox-bound evidence.</p>}
              </section>
              <section className="card">
                <p className="eyebrow">OCR CANDIDATES</p>
                <h2>Verify the extracted JSON</h2>
                <p>
                  Reloads the immutable OCR result for the most recently processed document and
                  checks its digest and object key against the receipt. It reads; it promotes
                  nothing.
                </p>
                <div className="billing-actions">
                  <button type="button" disabled={busy} onClick={() => void verifyLatestCandidates()}>
                    {busy ? "Working..." : "Verify latest candidates"}
                  </button>
                </div>
              </section>
              <section id="workspace-review" className="card world-studio" aria-labelledby="world-studio-title">
                <div className="world-heading">
                  <div>
                    <p className="eyebrow">ADVANCED REVIEW · WORLD LIFECYCLE</p>
                    <h2 id="world-studio-title">Candidate bytes stay immutable. Humans move the active pointer.</h2>
                  </div>
                  <output className={activeWorld ? "world-status active" : "world-status"}>
                    {activeWorld ? `ACTIVE · REVISION ${activeWorld.revision}` : "NO ACTIVE WORLD"}
                  </output>
                </div>
                {!collectionResult ? (
                  <p className="world-empty">Compile or reload a verified collection candidate to begin review.</p>
                ) : (
                  <div className="world-layout">
                    <div className="review-panel">
                      <div className="binding-list" aria-label="Candidate bindings">
                        <span><b>Sources</b>{collectionResult.validation.counts.documents}</span>
                        <span><b>Evidence</b>{collectionResult.validation.counts.claims} claims</span>
                        <span><b>Validation</b>{collectionResult.validation.status === "passed" ? "Passed" : "Needs review"}</span>
                        <span><b>Current active</b>{activeWorld ? `Revision ${activeWorld.revision}` : "None"}</span>
                      </div>
                      <label htmlFor="review-reason">Human review record</label>
                      <textarea
                        id="review-reason"
                        maxLength={500}
                        placeholder="Record what you verified in the directory, ontology, graph, evidence links and validation receipt."
                        value={reviewReason}
                        onChange={(event) => setReviewReason(event.target.value)}
                      />
                      <div className="world-actions">
                        <small>{reviewReason.trim().length}/500 · minimum 8 characters</small>
                        <button
                          disabled={worldBusy || reviewReason.trim().length < 8 || collectionResult.lifecycle !== "candidate" || collectionResult.validation.status !== "passed" || collectionResult.coreExecution?.status !== "completed" || collectionResult.coreExecution.runtime !== "tavonel-python-core-v2" || !collectionResult.coreExecution.worldStateId || activeWorld?.manifestDigest === collectionResult.manifestDigest}
                          onClick={() => void promoteCandidate()}
                        >
                          {activeWorld?.manifestDigest === collectionResult.manifestDigest ? "This candidate is active" : worldBusy ? "Recording decision..." : "Promote reviewed candidate"}
                        </button>
                      </div>
                      <p className="fine">Promotion uses compare-and-swap against the current manifest. A stale browser cannot overwrite a newer human decision.</p>
                    </div>
                    <div className="version-panel">
                      <p className="eyebrow">RETAINED VERSIONS</p>
                      {worldVersions.length === 0 ? (
                        <p>No promoted version exists for this collection.</p>
                      ) : (
                        <ol className="version-list">
                          {worldVersions.map((version) => (
                            <li key={version.manifest_digest}>
                              <div>
                                <strong>{version.lifecycle_status}</strong>
                                <small>{version.manifest_digest}</small>
                                <small>Activated {version.activation_count} time(s)</small>
                              </div>
                              {activeWorld && version.manifest_digest !== activeWorld.manifestDigest ? (
                                <button
                                  disabled={worldBusy || rollbackReason.trim().length < 8}
                                  onClick={() => void rollbackWorld(version.manifest_digest)}
                                >Rollback to this version</button>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      )}
                      {activeWorld && worldVersions.some((version) => version.manifest_digest !== activeWorld.manifestDigest) ? (
                        <>
                          <label htmlFor="rollback-reason">Rollback reason</label>
                          <textarea
                            id="rollback-reason"
                            maxLength={500}
                            placeholder="Record why the current active world must be replaced by a retained version."
                            value={rollbackReason}
                            onChange={(event) => setRollbackReason(event.target.value)}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
              </> : null}
              {surface === "ask" ? (
              <section id="workspace-ask" className="card ask-studio" aria-labelledby="ask-title">
                <div>
                  <p className="eyebrow">GROUNDED ASK</p>
                  <h2 id="ask-title">Answers return to exact source regions.</h2>
                  <p>Retrieval runs only against the active world. If no page-and-bbox evidence matches, TAVONEL abstains.</p>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void askActiveWorld(); }}>
                  <label htmlFor="ask-question">Question</label>
                  <textarea
                    id="ask-question"
                    maxLength={500}
                    disabled={!activeWorld || askBusy}
                    placeholder={activeWorld ? "Ask in Korean or English about this active collection." : "Promote a reviewed world before asking."}
                    value={askQuestion}
                    onChange={(event) => setAskQuestion(event.target.value)}
                  />
                  <button type="submit" disabled={!activeWorld || askBusy || askQuestion.trim().length < 3}>
                    {askBusy ? "Checking evidence..." : "Ask active world"}
                  </button>
                </form>
                {askResult ? (
                  <div className={`ask-result ${askResult.status}`} role="status">
                    <strong>{askResult.status === "grounded" ? "Grounded answer" : "Abstained"}</strong>
                    <p data-sensitive="content">{askResult.status === "grounded" ? askResult.answer : "No region-bound evidence matched this question."}</p>
                    {askResult.citations.length > 0 ? (
                      <ol data-sensitive="content">
                        {askResult.citations.map((citation) => (
                          <li key={`${citation.evidenceId}-${citation.pageNumber1}`}>
                            <b>{citation.evidenceId}</b>
                            <span>
                              Page {citation.pageNumber1} · bbox [{citation.bbox1000.join(", ")}] · {citation.authorityTier ?? citation.authority}
                              {citation.claimIds?.length ? ` · ${citation.claimIds.length} claim${citation.claimIds.length === 1 ? "" : "s"}` : ""}
                            </span>
                            {citation.relevanceBreakdown ? (
                              <span>
                                score {citation.relevance.toFixed(3)} · lexical {citation.relevanceBreakdown.lexical.toFixed(2)} · graph {citation.relevanceBreakdown.graph.toFixed(2)} · time {citation.relevanceBreakdown.temporal.toFixed(2)} · authority {citation.relevanceBreakdown.authority.toFixed(2)}
                              </span>
                            ) : null}
                            <q>{citation.excerpt}</q>
                            <button
                              type="button"
                              onClick={() => {
                                const evidence = worldReadModel?.evidence.find((item) => item.id === citation.evidenceId)
                                  ?? worldReadModel?.evidence.find((item) => item.sourceId === citation.sourceId && item.page === citation.pageNumber1);
                                setAskEvidenceId(evidence?.id ?? null);
                              }}
                              disabled={!worldReadModel?.evidence.some((item) => item.id === citation.evidenceId || (item.sourceId === citation.sourceId && item.page === citation.pageNumber1))}
                            >Open source region</button>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <small>Citations verified against the active World revision.</small>
                  </div>
                ) : null}
                {askEvidenceId ? (
                  <WorldStudioUltimate model={worldReadModel} initialLens="evidence" selectedEvidenceId={askEvidenceId} onEvidenceSelect={(selection) => setAskEvidenceId(selection?.id ?? null)} />
                ) : null}
              </section>
              ) : null}
            </>
          ) : null}

          {tab === "billing" || tab === "integrity" ? (
            <nav aria-label="Workspace settings" className="billing-actions">
              <button type="button" aria-current={tab === "billing" ? "page" : undefined} onClick={() => navigateSettings("usage")}>Usage &amp; billing</button>
              <button type="button" aria-current={tab === "integrity" ? "page" : undefined} onClick={() => navigateSettings("trust")}>Trust &amp; integrity</button>
            </nav>
          ) : null}

          {tab === "billing" ? (
          <section className="card billing-card">
            <div>
              <p className="eyebrow">BILLING & CAPACITY</p>
              <h2>{billingAccount?.accessPlan ? `${billingAccount.accessPlan.replace("_access", "")} access` : "Usage & billing"}</h2>
              <p>Included usage is granted only from a signed subscription transaction and settled from observed processing.</p>
            </div>
            {/*
              Never print a number this panel does not have. Falling back to 0 stated a balance
              rather than admitting one had not arrived, which is the same misreport the public
              capability grid is built to make impossible -- reproduced on the side of the product
              where the number is about someone's money.
            */}
            <dl>
              <div>
                <dt>Subscription</dt>
                <dd>
                  {!billingAccount
                    ? UNKNOWN
                    : billingAccount.subscriptionCancelAt
                      ? `active until ${formatTimestamp(billingAccount.subscriptionCancelAt) ?? UNKNOWN}`
                      : billingAccount.subscriptionStatus ?? UNKNOWN}
                </dd>
              </div>
              <div><dt>Standard pages remaining</dt><dd>{billingAccount ? formatCount(Math.floor(billingAccount.creditBalance / 4)) : UNKNOWN}</dd></div>
              <div><dt>Standard processing</dt><dd>$0.04 / page</dd></div>
              <div><dt>Maximum routed cost</dt><dd>$0.06 / page</dd></div>
            </dl>
            {!billingAccount ? (
              <p className="fine">Billing has not been read yet for this session. These are not zeroes &mdash; they are values this panel does not have.</p>
            ) : null}
            <p className="fine">
              See the estimated and maximum charge before processing. Failed or released work returns its unused reservation automatically.
            </p>
            <div className="billing-actions">
              <button disabled={billingBusy} onClick={() => void loadBilling()}>Refresh billing</button>
              <button disabled={billingBusy || !billingAccount?.paddleCustomerId} onClick={() => void openBillingPortal()}>
                {billingBusy ? "Opening..." : "Manage billing"}
              </button>
            </div>
            {billingAccount?.billingHold ? <p className="billing-hold" role="alert">Billing hold active. Refunded or disputed usage cannot be processed.</p> : null}
            {billingAccount?.subscriptionCancelAt ? (
              <p className="billing-hold" role="status">
                Cancellation is scheduled. Access remains active through the current paid period.
              </p>
            ) : null}
            {billingAccount?.updatedAt ? <small>Last persisted billing change · {formatTimestamp(billingAccount.updatedAt)}</small> : null}
          </section>
          ) : null}

          {tab === "connections" ? <ConnectionsPanel /> : null}

          {tab === "developers" ? <DeveloperPanel /> : null}

          {tab === "integrity" ? (
          <section className="card gates">
            <p className="eyebrow">PROCESSING INTEGRITY</p>
            <h2>Processing gates</h2>
            {/* Written labels, not the policy keys: "ocrGpu" split on capitals rendered as
                "ocr Gpu" in the UI. The state marker is the same pill the public capability
                grid uses, and it had the glyphs the wrong way round -- an open circle for an
                *open* gate and a filled one for a closed gate reads as the opposite.
                The heading counted the gates in words ("Four gates") and went stale the moment a
                fifth policy key was added; a heading that cannot drift is the smaller fix than a
                number nobody updates. */}
            <div className="gate-list">
              {Object.entries(activationPolicy).map(([key, value]) => (
                <article key={key}>
                  <strong>{GATE_LABELS[key as ActivationCapability]}</strong>
                  <span className="pill" data-v={value.enabled ? "current" : "held"}>{value.enabled ? "OPEN" : "CLOSED"}</span>
                  <p>{value.reason}</p>
                </article>
              ))}
            </div>
            <p className="fine"><ShieldCheck size={15} /> All capability issuance is server-authorized and tenant-scoped.</p>
          </section>
          ) : null}
    </WorkspaceUltimateShell>
  );
}
