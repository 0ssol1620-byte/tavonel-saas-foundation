"use client";

import Link from "next/link";
import { FileText, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activationPolicy } from "@/lib/activation-policy";
import type { DocumentListItem } from "@/lib/immutable-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const FOUNDATION_PROOF_PDF_URL = "/api/proof-pdf";
const FOUNDATION_PROOF_PDF_SHA256 = "3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4";

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function intakeNotice() {
  if (!activationPolicy.customerIntake.enabled) {
    return "Private pilot mode. No document bytes are accepted in this environment.";
  }
  if (activationPolicy.cdr.enabled) {
    return "Private-pilot intake is open for signed-in test users. Files go to Foundation quarantine; CDR writes an immutable sanitized PDF. GPU stays closed until a GHCR digest and a $5 one-shot exist. Candidate promotion stays closed.";
  }
  return "Private-pilot intake is open for signed-in test users. Files go to Foundation quarantine only; CDR and GPU stay closed.";
}

export default function WorkspacePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState(intakeNotice);
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [proofMode, setProofMode] = useState(false);

  const loadDocuments = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/documents", { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const json = (await response.json()) as { documents?: DocumentListItem[] };
    setDocuments(json.documents ?? []);
  };

  useEffect(() => {
    setProofMode(new URLSearchParams(window.location.search).get("foundation-proof") === "1");
    void loadDocuments();
  }, []);

  const uploadDocument = async (file: File) => {
    setBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      if (!client) {
        setNotice("Sign in with Google first.");
        return;
      }
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setNotice("Sign in with Google first.");
        return;
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
      const json = await capability.json() as { code?: string; uploadUrl?: string; declaredMimeType?: string };
      if (!capability.ok || !json.uploadUrl) {
        setNotice(json.code === "AUTH_REQUIRED" ? "Sign in with Google first." : `Upload was not issued (${json.code ?? capability.status}).`);
        return;
      }
      const put = await fetch(json.uploadUrl, {
        method: "PUT",
        headers: { "content-type": json.declaredMimeType ?? file.type },
        body: file,
      });
      if (!put.ok) {
        setNotice(`Quarantine PUT failed (${put.status}). The file never entered the app server.`);
        return;
      }
      setNotice(
        activationPolicy.cdr.enabled
          ? `${file.name} is in Foundation quarantine. CDR will sanitize it to an immutable PDF. OCR candidates JSON is Worker-side only; GPU dispatch and candidate promotion stay closed.`
          : `${file.name} is in Foundation quarantine. CDR sanitization and GPU analysis are still closed.`,
      );
      await loadDocuments();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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

  return (
    <main className="workspace">
      <aside className="side">
        <Link href="/" className="brand"><span>T</span>TAVONEL</Link>
        <p className="eyebrow">WORKSPACE</p>
        <div className="workspace-name"><strong>Private pilot</strong><small>Foundation environment</small></div>
        <nav>
          <b>Overview</b>
          <button onClick={() => void loadDocuments()}>Documents</button>
          <button onClick={() => setNotice("Candidates appear only from qualified sanitized inputs. Promotion stays a separate human decision.")}>Knowledge candidates</button>
          <button onClick={() => setNotice("Activity is retained only after a governed processing event.")}>Activity</button>
        </nav>
      </aside>
      <section className="workspace-body">
        <header>
          <span><strong>Private pilot</strong> · Overview<br /><small>Your governed knowledge space</small></span>
          {activationPolicy.customerIntake.enabled ? (
            <>
              <input ref={fileRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); }} />
              {proofMode ? (
                <button disabled={busy} onClick={() => void uploadPublicProof()}><UploadCloud size={16} /> {busy ? "Running proof…" : "Run public PDF proof"}</button>
              ) : (
                <button disabled={busy} onClick={() => fileRef.current?.click()}><UploadCloud size={16} /> {busy ? "Uploading…" : "Upload document"}</button>
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
              <div className="nodes"><i /><i /><i /><i /><i /></div>
              <p>Sanitized inputs can produce reviewable candidates JSON. No candidate is promoted to a world without a separate human decision. candidatePromotion stays closed.</p>
            </section>
          </div>
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
