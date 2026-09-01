"use client";

import Link from "next/link";
import Logomark from "@/components/logomark";
import WorldExplorer from "@/components/world-explorer";
import { Download, FileText, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { activationPolicy } from "@/lib/activation-policy";
import type { DocumentListItem } from "@/lib/immutable-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useCheckout } from "@/lib/use-checkout";
import { formatCount, formatTimestamp } from "@/lib/format";
import { readOfferParam, takeCheckoutIntent } from "@/lib/checkout-intent";
import { putWithProgress } from "@/lib/upload-transfer";
import { runBounded } from "@/lib/concurrent";
import { buildPipeline, type LocalUpload } from "@/lib/pipeline";
import { qualifyProgress, type OcrProgress } from "@/lib/ocr-progress";
import PipelineBoard from "@/components/pipeline-board";
import CompileStage from "@/components/compile-stage";
import { displayName, elideKey, recallDocumentNames, rememberDocumentName, type DocumentNames } from "@/lib/document-names";
import { trackFunnel } from "@/lib/funnel-events";
import ConnectionsPanel from "@/components/connections-panel";
import DeveloperPanel from "@/components/developer-panel";
import WorkspaceUltimateShell, { type WorkspaceSurface } from "@/components/workspace-ultimate-shell";
import WorldStudioUltimate from "@/components/world-studio-ultimate";
import OperationsUltimate from "@/components/operations-ultimate";
import type { WorldReadModel } from "@/lib/world-read-model";

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

function intakeNotice() {
  if (!activationPolicy.customerIntake.enabled) {
    return "Private pilot mode. No document bytes are accepted in this environment.";
  }
  if (activationPolicy.cdr.enabled) {
    return activationPolicy.ocrGpu.enabled
      ? "Private-pilot intake is open for signed-in test users. Files go to Foundation quarantine; CDR writes an immutable sanitized PDF and qualified RunPod OCR writes reviewable JSON. Candidate promotion stays closed."
      : "Private-pilot intake is open for signed-in test users. Files go to Foundation quarantine; CDR writes an immutable sanitized PDF. GPU OCR and candidate promotion stay closed.";
  }
  return "Private-pilot intake is open for signed-in test users. Files go to Foundation quarantine only; CDR and GPU stay closed.";
}

/** Human labels for the activation-policy keys, so no camelCase reaches the screen. */
const GATE_LABELS = {
  customerIntake: "Document intake",
  cdr: "Content disarm",
  ocrGpu: "OCR on scans",
  candidatePromotion: "Promotion to the live world",
} as const;

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

/**
 * One immutable key, drawn short and copied whole.
 *
 * Every value here is a receipt: a customer has to be able to take it, paste it into a bucket
 * listing or a support thread, and have it match byte for byte. So the string in the DOM is
 * always the complete key -- `elideKey` only decides what is painted, `title` gives it to a
 * hover, and the button puts the untouched value on the clipboard.
 */
function KeyLine({ label, value, pending }: { label: string; value?: string | null; pending?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return pending ? <small className="key-line pending">{pending}</small> : null;
  return (
    <small className="key-line">
      <span className="key-k">{label}</span>
      <code title={value}>{elideKey(value)}</code>
      <button
        type="button"
        className="key-copy"
        aria-label={`Copy the full ${label.toLowerCase()} key`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); },
            // A refused clipboard leaves the key on screen and in the title; nothing is lost.
            () => undefined,
          );
        }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </small>
  );
}

export default function WorkspacePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  /** Distinguishes two uploads of the same file in one session. */
  const uploadSeq = useRef(0);
  const [notice, setNotice] = useState(intakeNotice);
  const { start: buy, busy: buying } = useCheckout(setNotice);
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
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
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
  const [rollbackReason, setRollbackReason] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<GroundedAnswer | null>(null);
  const [askBusy, setAskBusy] = useState(false);

  const getAuthToken = async () => {
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    return data.session?.access_token ?? null;
  };

  const clearWorldState = () => {
    setActiveWorld(null);
    setWorldVersions([]);
    setAskResult(null);
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

  const loadCollectionCandidate = async (collectionId: string) => {
    if (!/^collection-[a-f0-9]{32}$/.test(collectionId)) return;
    const client = getSupabaseBrowserClient();
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch(`/api/collections/${collectionId}`, {
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
    setNotice(
      `Immutable collection ${collectionId} reloaded from R2 and verified: directory, ontology JSON-LD/Turtle, graph CSV, RAG, provenance and validation roots are present; manifest ${artifact.manifestDigest}; candidatePromotion=false.`,
    );
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
      if (collectionId) void loadCollectionCandidate(collectionId);

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
    const readingNow = documents
      .filter((item) => item.sanitizedKey && !item.hasOcrJson && item.processingState !== "operator_review")
      .map((item) => item.documentId);
    if (readingNow.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      await Promise.all(readingNow.map((documentId) => readProgressFor(documentId, token)));
      if (!cancelled) await loadDocuments();
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1_500);
    return () => { cancelled = true; window.clearInterval(timer); };
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
  const readProgressFor = async (documentId: string, token: string) => {
    try {
      const issued = await fetch(`/api/documents/${documentId}/progress`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!issued.ok) return;
      const { readUrl } = await issued.json() as { readUrl?: string };
      if (!readUrl) return;
      const object = await fetch(readUrl, { cache: "no-store" });
      if (!object.ok) return;
      const progress = qualifyProgress(await object.json());
      if (!progress) return;
      setReading((current) => ({ ...current, [documentId]: progress }));
    } catch {
      // A dropped frame of a live view is not an error about the document.
    }
  };

  const patchUpload = (localId: string, patch: Partial<LocalUpload>) =>
    setUploads((current) => current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));

  const uploadDocument = async (file: File, manageBusy = true): Promise<string | null> => {
    if (manageBusy) setBusy(true);
    // The id is local until the capability call returns one. The board needs a row immediately,
    // because issuing the capability is itself a wait the visitor should be able to see.
    const localId = `local-${file.name}-${file.size}-${uploadSeq.current++}`;
    setUploads((current) => [
      ...current,
      { localId, filename: file.name, bytes: file.size, documentId: null, phase: "issuing", loaded: 0 },
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
      if (json.documentId) setNames(rememberDocumentName(json.documentId, file.name));
      const transfer = putWithProgress(
        json.uploadUrl,
        file,
        json.declaredMimeType ?? file.type,
        ({ loaded }) => patchUpload(localId, { loaded }),
      );
      const result = await transfer.done;
      if (!result.ok) {
        const reason = result.reason === "http"
          ? `quarantine PUT failed (${result.status})`
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
      patchUpload(localId, { phase: "stored", loaded: file.size });

      setNotice(
        activationPolicy.cdr.enabled
          ? activationPolicy.ocrGpu.enabled
            ? `${file.name} is in Foundation quarantine. CDR will sanitize it to an immutable PDF, then qualified RunPod OCR will write reviewable JSON. Candidate promotion stays closed.`
            : `${file.name} is in Foundation quarantine. CDR will sanitize it to an immutable PDF. GPU OCR and candidate promotion stay closed.`
          : `${file.name} is in Foundation quarantine. CDR sanitization and GPU analysis are still closed.`,
      );
      await loadDocuments();
      return json.documentId ?? null;
    } finally {
      if (manageBusy) setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const waitForOcrAndCompile = async (documentIds: string[]) => {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const current = await loadDocuments();
      const ready = documentIds.filter((id) => current.some((item) => item.documentId === id && item.hasOcrJson)).length;
      const operatorReview = documentIds.filter((id) => {
        const versions = current.filter((item) => item.documentId === id);
        return !versions.some((item) => item.hasOcrJson) && versions.some((item) => item.processingState === "operator_review");
      });
      // Anything sanitized but not yet read is being read right now; that is what the live view
      // is for. Documents already carrying ocr.json have nothing left to watch.
      const stillReading = current
        .filter((item) => item.sanitizedKey && !item.hasOcrJson && item.processingState !== "operator_review")
        .map((item) => item.documentId)
        .filter((documentId) => documentIds.includes(documentId));
      if (stillReading.length > 0) {
        const client = getSupabaseBrowserClient();
        const { data } = client ? await client.auth.getSession() : { data: { session: null } };
        const progressToken = data.session?.access_token;
        if (progressToken) await Promise.all(stillReading.map((documentId) => readProgressFor(documentId, progressToken)));
      }
      if (operatorReview.length > 0) {
        setNotice(`Batch processing stopped safely: ${operatorReview.length} document(s) require explicit OCR operator review. No paid retry or candidate compilation was attempted.`);
        return;
      }
      // The board carries the detail now, so this line only has to say what the board cannot:
      // that the batch is still running and nothing has been compiled yet.
      setNotice(`Reading ${documentIds.length} documents. ${ready} have written immutable OCR output; no candidate is compiled until every one has.`);
      if (ready === documentIds.length) {
        const client = getSupabaseBrowserClient();
        const { data } = client ? await client.auth.getSession() : { data: { session: null } };
        const token = data.session?.access_token;
        if (!token) {
          setNotice("Sign in with Google first.");
          return;
        }
        const response = await fetch("/api/collections/compile", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ documentIds }),
        });
        const json = await response.json() as CollectionResult & { code?: string };
        if (!response.ok || !json.collectionId) {
          setNotice(`Collection compilation failed (${json.code ?? response.status}). Candidate promotion remains closed.`);
          return;
        }
        setCollectionResult(json);
        await loadWorldState(json.collectionId, token);
        const url = new URL(window.location.href);
        url.searchParams.set("collection", json.collectionId);
        window.history.replaceState(null, "", url);
        setNotice(
          json.lifecycle === "review_required"
            ? `Collection ${json.collectionId} produced a signed review package with ${json.reviewReasons?.length ?? 0} review reason(s). Download and inspect it; promotion remains blocked.`
            : `Collection ${json.collectionId} compiled from ${json.validation.counts.documents} documents: ${json.directoryPlan.length} directory entries, ${json.validation.counts.topics} topics, ${json.validation.counts.entities} entities, ${json.validation.counts.claims} claims and ${json.validation.counts.relations} evidence-bound relations. candidatePromotion=false.`,
        );
        return;
      }
      // Five seconds was invisible when the only output was a sentence. With a board on screen
      // it is the refresh rate of the thing the visitor is watching, so it tightens while work is
      // actually in flight and stays slow otherwise.
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    setNotice("Batch processing timed out before every OCR output became immutable. No collection candidate was created.");
  };

  const recompileWithCore = async () => {
    const documentIds = collectionResult?.sourceDocuments.map((document) => document.documentId) ?? [];
    if (documentIds.length < 2) {
      setNotice("The durable collection does not contain enough source bindings for Core recompilation.");
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
      setNotice(`Dispatching ${documentIds.length} immutable OCR documents to the separate Core runtime...`);
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
        : `Separate Core runtime completed ${json.collectionId}; receipt ${json.coreExecution.receipt.requestId}; output ${json.coreExecution.receipt.outputSha256}; candidatePromotion=false.`);
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
      const response = await fetch(`/api/collections/${collectionResult.collectionId}/download`, {
        headers: { authorization: `Bearer ${token}` },
      });
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
      setNotice(
        `Downloaded ${collectionResult.validation.counts.packageFiles} hash-verified package files plus the candidate manifest. candidatePromotion=false.`,
      );
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
      setNotice(`Sending ${files.length} file(s) to Foundation quarantine, ${UPLOAD_CEILING} at a time.`);
      const settled = await runBounded(files, UPLOAD_CEILING, (file) => uploadDocument(file, false));
      const ids = settled.flatMap((result) => (result.ok && result.value ? [result.value] : []));
      const lost = files.length - ids.length;
      if (lost > 0) {
        setNotice(`${ids.length} of ${files.length} reached quarantine. ${lost} did not, and nothing was retried on their behalf.`);
      }
      if (ids.length >= 2) await waitForOcrAndCompile(ids);
    } finally {
      setBusy(false);
    }
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
      setNotice(`Human review recorded. ${collectionResult.manifestDigest} is now the active world; immutable candidate bytes remain candidatePromotion=false.`);
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
          <span className="mode"><i aria-hidden="true" />PRIVATE PILOT</span>
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
    ? { label: "Inspect current run", surface: "runs" }
    : candidateNeedsDecision
      ? { label: "Review candidate", surface: "review" }
      : activeWorld
        ? { label: "Ask active World", surface: "ask" }
        : documentCount >= 2
          ? { label: "Start compile", surface: "runs" }
          : { label: "Choose sources", run: () => fileRef.current?.click() };

  return (
    <WorkspaceUltimateShell
      surface={surface}
      activeRevision={activeWorld?.revision ?? null}
      candidateReady={candidateReady}
      reviewCount={candidateReady ? reviewCount : null}
      activityCount={activityCount}
      credits={billingAccount?.creditBalance ?? null}
      truthGates={[
        { label: "Intake", qualified: activationPolicy.customerIntake.enabled, detail: activationPolicy.customerIntake.reason },
        { label: "CDR", qualified: activationPolicy.cdr.enabled, detail: activationPolicy.cdr.reason },
        { label: "OCR", qualified: activationPolicy.ocrGpu.enabled, detail: activationPolicy.ocrGpu.reason },
        { label: "Promotion", qualified: activationPolicy.candidatePromotion.enabled, detail: activationPolicy.candidatePromotion.reason },
      ]}
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
            <input ref={fileRef} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length > 0) void uploadDocuments(files); }} />
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
          {notice ? <p className="notice static" role="status"><strong>Activity.</strong> {notice}</p> : null}

          {tab === "overview" && surface !== "runs" && surface !== "activity" ? (
          <>
          {/*
            The compile, drawn.

            The board below reports state per document and is the thing to read when something
            stops. This canvas is the thing to *watch*: the same four columns the public cuts
            use — sources, the page under the reader, the lines coming out of it, and the world
            their own documents are building. It is fed entirely from this visitor's own uploads,
            pipeline rows and streamed OCR progress. No fixture ever reaches it.
          */}
          {pipelineRows.length > 0 ? (
            <CompileStage rows={pipelineRows} reading={reading} names={names} />
          ) : null}

          <div id="workspace-runs">
            <PipelineBoard
              rows={pipelineRows}
              reading={reading}
              names={names}
              onDismiss={uploads.length > 0 ? () => { setUploads([]); setReading({}); } : undefined}
            />
          </div>
          <p className="eyebrow">FOUNDATION · QUALIFIED INTAKE</p>
          <p className="lead">Build a traceable body of knowledge from documents that have passed the full safety chain. Quarantine is browser-direct; the application server never carries file bytes.</p>
          <div className="workspace-grid">
            <section id="workspace-sources" className="card document-card">
              {/* Status moved to the board above. What is left here is the part the board does
                  not carry: the immutable keys every receipt refers to. */}
              <p className="eyebrow">IMMUTABLE KEYS</p>
              <h2>{documents && documents.length > 0 ? "What each document left behind" : "Awaiting a qualified first document"}</h2>
              {documents && documents.length > 0 ? (
                <ul className="document-meta">
                  {documents.map((doc) => (
                    <li key={`${doc.documentId}-${doc.versionKey}`}>
                      {/*
                        The same rule as the floor above: a name a person recognises, then the
                        id underneath for the receipts to hang off.
                      */}
                      <strong>{displayName(doc.documentId, names)}</strong>
                      <small className="doc-id" title={doc.documentId}>{doc.documentId}</small>
                      {/*
                        A receipt key is 200 characters of bucket, tenant, document, digest and
                        artifact, and it used to be printed whole -- four of them per document,
                        wrapping across three lines each, until the panel was a wall of hex with
                        the one useful word ("sanitized.pdf") buried at the end of it.

                        Only the drawing is shortened. The value is never altered and never
                        truncated in the DOM: the full key is on the element, so it is what a
                        copy takes and what a title reveals. A receipt you cannot copy whole is
                        not a receipt.
                      */}
                      <KeyLine label="Sanitized" value={doc.sanitizedKey} pending="sanitized.pdf pending" />
                      <small>{doc.hasOcrJson ? `ocr.json ${doc.ocrJsonSize ?? 0} bytes` : doc.processingState === "operator_review" ? `OCR operator review required${doc.ocrReviewReasonCode ? ` · ${doc.ocrReviewReasonCode}` : ""} · automatic paid retry disabled` : "ocr.json pending within bounded processing"}</small>
                      {doc.cdrReceiptKey ? <KeyLine label="CDR receipt" value={doc.cdrReceiptKey} /> : null}
                      {doc.ocrReviewKey ? <KeyLine label="OCR review" value={doc.ocrReviewKey} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">
                  <FileText size={22} />
                  <strong>No document metadata yet</strong>
                  <p>A short-lived browser-direct quarantine capability is required. The application server and database never carry file bytes. Sign in to load immutable keys after CDR.</p>
                  {activationPolicy.customerIntake.enabled ? (
                    <div className="billing-actions">
                      <button type="button" onClick={() => fileRef.current?.click()}>Upload your first document</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
            <section className="card canvas">
              <p className="eyebrow">KNOWLEDGE CANVAS</p>
              <h2>Candidate-only by design</h2>
              {collectionResult ? (
                <div className="collection-result">
                  <strong>{collectionResult.collectionId}</strong>
                  <p>{collectionResult.validation.counts.documents} documents · {collectionResult.validation.counts.topics} topics · {collectionResult.validation.counts.entities} entities · {collectionResult.validation.counts.claims} claims · {collectionResult.validation.counts.relations} relations</p>
                  <small>{collectionResult.directoryPlan.length} directory entries · {collectionResult.validation.counts.packageFiles} package files</small>
                  <small>{collectionResult.artifactKey}</small>
                  <small>{collectionResult.manifestDigest}</small>
                  {collectionResult.coreExecution ? (
                    <>
                      <small>Core {collectionResult.coreExecution.status === "completed" ? "completed" : "requires review"} · {collectionResult.coreExecution.runtime} · {collectionResult.coreExecution.receipt.requestId}</small>
                      {collectionResult.coreExecution.worldStateId ? <small>{collectionResult.lifecycle === "candidate" ? "Candidate" : "Review"} world · {collectionResult.coreExecution.worldStateId}</small> : null}
                      {collectionResult.reviewReasons?.length ? <small>Review gates · {collectionResult.reviewReasons.join(", ")}</small> : null}
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
                  <strong>Compiled World not read yet</strong>
                  <small>Upload qualified sources, then inspect the resulting candidate. No topology is drawn before real objects exist.</small>
                </div>
              )}
              <p>Sanitized inputs can produce a reviewable directory, ontology, graph, RAG and provenance package. No candidate is promoted to a world without a separate human decision. Promotion to a live world stays closed.</p>
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
              <div id="workspace-world">
                <WorldStudioUltimate model={worldReadModel} />
                <WorldExplorer
                  collection={collectionResult}
                  onUpload={activationPolicy.customerIntake.enabled ? () => fileRef.current?.click() : undefined}
                />
              </div>
              {/*
                This control was lost when the sidebar buttons became tabs: the handler survived
                the refactor and its button did not, so OCR candidate verification silently left
                the product. It belongs on this tab -- the JSON it checks is the raw material the
                architecture above is built from.
              */}
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
                    <p className="eyebrow">REVIEW STUDIO · WORLD LIFECYCLE</p>
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
                        <span><b>Candidate manifest</b>{collectionResult.manifestDigest}</span>
                        <span><b>Core output</b>{collectionResult.coreExecution?.receipt.outputSha256 ?? "No separate Core receipt"}</span>
                        <span><b>World state</b>{collectionResult.coreExecution?.worldStateId ?? "Not bound by Python Core v2"}</span>
                        <span><b>Current active</b>{activeWorld?.manifestDigest ?? "None"}</span>
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
                                <small>{version.world_state_id} · activated {version.activation_count} time(s)</small>
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
                    <p>{askResult.status === "grounded" ? askResult.answer : "No region-bound evidence matched this question."}</p>
                    {askResult.citations.length > 0 ? (
                      <ol>
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
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <small>{askResult.receipt.retrieval} · {askResult.receipt.outputSha256}</small>
                  </div>
                ) : null}
              </section>
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
              <h2>{billingAccount?.accessPlan ? `${billingAccount.accessPlan.replace("_access", "")} access` : "Private-pilot billing"}</h2>
              <p>
                Paddle webhooks, not checkout redirects, own this balance. Purchased GPU credits
                never remove per-job, daily, timeout, or scale-to-zero controls.
              </p>
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
              <div><dt>Available credits</dt><dd>{billingAccount ? formatCount(billingAccount.creditBalance) : UNKNOWN}</dd></div>
              <div><dt>Purchased</dt><dd>{billingAccount ? formatCount(billingAccount.lifetimeCreditsPurchased) : UNKNOWN}</dd></div>
              <div><dt>Reversed</dt><dd>{billingAccount ? formatCount(billingAccount.lifetimeCreditsReversed) : UNKNOWN}</dd></div>
            </dl>
            {!billingAccount ? (
              <p className="fine">Billing has not been read yet for this session. These are not zeroes &mdash; they are values this panel does not have.</p>
            ) : null}
            <div className="packs workspace-packs">
              {([
                ["Starter", "$12", "100 credits", "credit_starter"],
                ["Builder", "$30", "300 credits", "credit_builder"],
                ["Scale", "$75", "800 credits", "credit_scale"],
              ] as const).map(([name, price, credits, offerCode]) => (
                <article className="pack" key={name}>
                  <span className="tag">PREPAID CAPACITY</span>
                  <h3>{name}</h3>
                  <span className="price">{price} <small>{credits}</small></span>
                  <button type="button" disabled={Boolean(buying)} onClick={() => void buy(offerCode)}>
                    {buying === offerCode ? "Opening checkout..." : "Buy credits"}
                  </button>
                </article>
              ))}
            </div>
            <p className="fine">
              Credits are reserved before a qualified job and settled against observed runtime.
              A checkout never creates them &mdash; only a signed, idempotently persisted webhook
              does &mdash; so a balance here can lag a completed payment by a moment.
            </p>
            <div className="billing-actions">
              <button disabled={billingBusy} onClick={() => void loadBilling()}>Refresh billing</button>
              <button disabled={billingBusy || !billingAccount?.paddleCustomerId} onClick={() => void openBillingPortal()}>
                {billingBusy ? "Opening..." : "Manage billing"}
              </button>
            </div>
            {billingAccount?.billingHold ? <p className="billing-hold" role="alert">Billing hold active. Refunded or disputed credits cannot be used.</p> : null}
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
            <h2>Four gates</h2>
            {/* Written labels, not the policy keys: "ocrGpu" split on capitals rendered as
                "ocr Gpu" in the UI. The state marker is the same pill the public capability
                grid uses, and it had the glyphs the wrong way round -- an open circle for an
                *open* gate and a filled one for a closed gate reads as the opposite. */}
            <div className="gate-list">
              {Object.entries(activationPolicy).map(([key, value]) => (
                <article key={key}>
                  <strong>{GATE_LABELS[key as keyof typeof GATE_LABELS] ?? key}</strong>
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
