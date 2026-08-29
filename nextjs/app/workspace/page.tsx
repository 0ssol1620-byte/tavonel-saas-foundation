"use client";

import Link from "next/link";
import { Download, FileText, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activationPolicy } from "@/lib/activation-policy";
import type { DocumentListItem } from "@/lib/immutable-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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
  candidatePromotion: false;
  sourceDocuments: Array<{ documentId: string }>;
  coreExecution?: {
    status: "completed";
    runtime: string;
    receipt: { requestId: string; outputSha256: string; candidatePromotion: false };
  };
  directoryPlan: Array<{ path: string; kind: string; sourceIds: string[] }>;
  validation: {
    status: string;
    counts: { documents: number; topics: number; entities: number; claims: number; evidence: number; relations: number; packageFiles: number };
  };
};

type BillingAccount = {
  accessPlan: string | null;
  subscriptionStatus: string;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
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

export default function WorkspacePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState(intakeNotice);
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [proofMode, setProofMode] = useState(false);
  const [collectionResult, setCollectionResult] = useState<CollectionResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [billingAccount, setBillingAccount] = useState<BillingAccount | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);

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
      artifact.validation.status !== "passed" ||
      !paths.includes("ontology/knowledge.jsonld") ||
      !paths.includes("ontology/knowledge.ttl") ||
      !paths.includes("graph/nodes.csv") ||
      !paths.includes("graph/relationships.csv")
    ) {
      setNotice(`Immutable collection verification failed (${json.code ?? response.status}).`);
      return;
    }
    setCollectionResult({ ...artifact, artifactKey: json.artifactKey ?? "" });
    setNotice(
      `Immutable collection ${collectionId} reloaded from R2 and verified: directory, ontology JSON-LD/Turtle, graph CSV, RAG, provenance and validation roots are present; manifest ${artifact.manifestDigest}; candidatePromotion=false.`,
    );
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setProofMode(params.get("foundation-proof") === "1");
    void loadDocuments();
    void loadBilling();
    const collectionId = params.get("collection");
    if (collectionId) void loadCollectionCandidate(collectionId);
  }, []);

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

  const uploadDocument = async (file: File, manageBusy = true): Promise<string | null> => {
    if (manageBusy) setBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      if (!client) {
        setNotice("Sign in with Google first.");
        return null;
      }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
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
        setNotice(json.code === "AUTH_REQUIRED" ? "Sign in with Google first." : `Upload was not issued (${json.code ?? capability.status}).`);
        return null;
      }
      const put = await fetch(json.uploadUrl, {
        method: "PUT",
        headers: { "content-type": json.declaredMimeType ?? file.type },
        body: file,
      });
      if (!put.ok) {
        setNotice(`Quarantine PUT failed (${put.status}). The file never entered the app server.`);
        return null;
      }
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
      setNotice(`Batch processing: ${ready}/${documentIds.length} document OCR outputs are immutable and ready.`);
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
        const url = new URL(window.location.href);
        url.searchParams.set("collection", json.collectionId);
        window.history.replaceState(null, "", url);
        setNotice(
          `Collection ${json.collectionId} compiled from ${json.validation.counts.documents} documents: ${json.directoryPlan.length} directory entries, ${json.validation.counts.topics} topics, ${json.validation.counts.entities} entities, ${json.validation.counts.claims} claims and ${json.validation.counts.relations} evidence-bound relations. candidatePromotion=false.`,
        );
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
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
      if (!response.ok || json.coreExecution?.status !== "completed") {
        setNotice(`Core compilation failed (${json.code ?? response.status}). No candidate was promoted.`);
        return;
      }
      setCollectionResult(json);
      setNotice(`Separate Core runtime completed ${json.collectionId}; receipt ${json.coreExecution.receipt.requestId}; output ${json.coreExecution.receipt.outputSha256}; candidatePromotion=false.`);
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
        setNotice(`Knowledge package download failed (${json.code ?? response.status}).`);
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

  const uploadDocuments = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setCollectionResult(null);
    const ids: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        setNotice(`Uploading ${index + 1}/${files.length}: ${files[index].name}`);
        const id = await uploadDocument(files[index], false);
        if (!id) return;
        ids.push(id);
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

  return (
    <main className="workspace">
      <aside className="side">
        <Link href="/" className="brand"><span>T</span>TAVONEL</Link>
        <p className="eyebrow">WORKSPACE</p>
        <div className="workspace-name"><strong>Private pilot</strong><small>Foundation environment</small></div>
        <nav>
          <b>Overview</b>
          <button onClick={() => void loadDocuments()}>Documents</button>
          <button onClick={() => void verifyLatestCandidates()}>Knowledge candidates</button>
          <button onClick={() => setNotice("Activity is retained only after a governed processing event.")}>Activity</button>
        </nav>
      </aside>
      <section className="workspace-body">
        <header>
          <span><strong>Private pilot</strong> · Overview<br /><small>Your governed knowledge space</small></span>
          {activationPolicy.customerIntake.enabled ? (
            <>
              <input ref={fileRef} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length > 0) void uploadDocuments(files); }} />
              {proofMode ? (
                <div className="proof-actions">
                  <button disabled={busy} onClick={() => void uploadPublicProof()}><UploadCloud size={16} /> {busy ? "Running proof…" : "Run single PDF proof"}</button>
                  <button disabled={busy} onClick={() => void uploadPublicCollectionProof()}><UploadCloud size={16} /> {busy ? "Compiling…" : "Run public 3-document proof"}</button>
                </div>
              ) : (
                <button disabled={busy} onClick={() => fileRef.current?.click()}><UploadCloud size={16} /> {busy ? "Processing…" : "Upload files"}</button>
              )}
            </>
          ) : (
            <button onClick={() => setNotice("Upload remains locked until synthetic R2 qualification.")}><UploadCloud size={16} /> Upload document <LockKeyhole size={14} /></button>
          )}
        </header>
        <div className="workspace-content">
          <p className="eyebrow">● FOUNDATION · SAFE MODE</p>
          <h1>A quieter place to think.</h1>
          <p className="lead">Build a traceable body of knowledge from documents that have passed the full safety chain. Quarantine is browser-direct; the application server never carries file bytes.</p>
          <p className="notice static"><strong>Guardrail active.</strong> {notice}</p>
          <div className="workspace-grid">
            <section className="card document-card">
              <p className="eyebrow">YOUR LIBRARY</p>
              <h2>{documents && documents.length > 0 ? "Immutable document metadata" : "Awaiting a qualified first document"}</h2>
              {documents && documents.length > 0 ? (
                <ul className="document-meta">
                  {documents.map((doc) => (
                    <li key={`${doc.documentId}-${doc.versionKey}`}>
                      <strong>{doc.documentId}</strong>
                      <small>{doc.sanitizedKey ?? "sanitized.pdf pending"}</small>
                      <small>{doc.hasOcrJson ? `ocr.json ${doc.ocrJsonSize ?? 0} bytes` : "ocr.json not written yet"}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">
                  <FileText size={22} />
                  <strong>No document metadata yet</strong>
                  <p>A short-lived browser-direct quarantine capability is required. The application server and database never carry file bytes. Sign in to load immutable keys after CDR.</p>
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
                      <small>Core completed · {collectionResult.coreExecution.runtime} · {collectionResult.coreExecution.receipt.requestId}</small>
                      <button className="download-package" disabled={downloading} onClick={() => void downloadCollection()}>
                        <Download size={15} aria-hidden="true" />
                        {downloading ? "Preparing verified ZIP..." : "Download knowledge package"}
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => void recompileWithCore()}>{busy ? "Running Core..." : "Recompile with separate Core"}</button>
                  )}
                </div>
              ) : <div className="nodes"><i /><i /><i /><i /><i /></div>}
              <p>Sanitized inputs can produce a reviewable directory, ontology, graph, RAG and provenance package. No candidate is promoted to a world without a separate human decision. candidatePromotion stays closed.</p>
            </section>
          </div>
          <section className="card billing-card">
            <div>
              <p className="eyebrow">BILLING & CAPACITY</p>
              <h2>{billingAccount?.accessPlan ? `${billingAccount.accessPlan.replace("_access", "")} access` : "Private-pilot billing"}</h2>
              <p>
                Paddle webhooks, not checkout redirects, own this balance. Purchased GPU credits
                never remove per-job, daily, timeout, or scale-to-zero controls.
              </p>
            </div>
            <dl>
              <div><dt>Subscription</dt><dd>{billingAccount?.subscriptionStatus ?? "loading"}</dd></div>
              <div><dt>Available credits</dt><dd>{billingAccount?.creditBalance ?? 0}</dd></div>
              <div><dt>Purchased</dt><dd>{billingAccount?.lifetimeCreditsPurchased ?? 0}</dd></div>
              <div><dt>Reversed</dt><dd>{billingAccount?.lifetimeCreditsReversed ?? 0}</dd></div>
            </dl>
            <div className="billing-actions">
              <button disabled={billingBusy} onClick={() => void loadBilling()}>Refresh billing</button>
              <button disabled={billingBusy || !billingAccount?.paddleCustomerId} onClick={() => void openBillingPortal()}>
                {billingBusy ? "Opening..." : "Manage billing"}
              </button>
            </div>
            {billingAccount?.billingHold ? <p className="billing-hold" role="alert">Billing hold active. Refunded or disputed credits cannot be used.</p> : null}
            {billingAccount?.updatedAt ? <small>Last persisted billing change · {new Date(billingAccount.updatedAt).toLocaleString()}</small> : null}
          </section>
          <section className="card gates">
            <p className="eyebrow">PROCESSING INTEGRITY</p>
            <h2>Four gates</h2>
            <div>{Object.entries(activationPolicy).map(([key, value]) => <article key={key}><span>{value.enabled ? "○" : "●"}</span><strong>{key.replace(/([A-Z])/g, " $1")}</strong><p>{value.reason}</p></article>)}</div>
            <p className="fine"><ShieldCheck size={15} /> All capability issuance is server-authorized and tenant-scoped.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
